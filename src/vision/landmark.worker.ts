import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { LANDMARK_COUNT, LANDMARK_STRIDE, MAX_HANDS } from './handTopology'
import type { WorkerRequest, WorkerResponse } from './landmarkProtocol'
import { SilhouetteSegmenter, type VisionFileset } from './silhouetteSegmenter'

// The WASM runtime must match the installed @mediapipe/tasks-vision version exactly.
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const PROGRESS_INTERVAL_MS = 100
const WARMUP_SIZE = 128

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

const scope = self as unknown as WorkerScope

let landmarker: HandLandmarker | null = null
let runtime: VisionFileset | null = null
let segmenter: SilhouetteSegmenter | null = null
let segmenterLoading: Promise<void> | null = null
let frameCount = 0

// The body moves slowly next to the hands, so it is segmented on every other frame,
// which keeps the hand latency close to what it is without segmentation.
const SEGMENTATION_STRIDE = 2
let receivedBytes = 0
let lastProgressAt = 0

/** Streams a download so the main thread can show how much has arrived. */
async function download(url: string, type: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Request for ${url} failed with ${response.status}`)

  const reader = response.body.getReader()
  const chunks: BlobPart[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    receivedBytes += value.byteLength
    const now = performance.now()
    if (now - lastProgressAt > PROGRESS_INTERVAL_MS) {
      lastProgressAt = now
      scope.postMessage({ type: 'progress', bytes: receivedBytes })
    }
  }
  scope.postMessage({ type: 'progress', bytes: receivedBytes })
  return new Blob(chunks, { type })
}

async function initialize(): Promise<void> {
  scope.postMessage({ type: 'stage', stage: 'download' })
  const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT, true)
  const [runtimeBytes, model] = await Promise.all([
    download(fileset.wasmBinaryPath, 'application/wasm'),
    download(MODEL_URL, 'application/octet-stream'),
  ])

  scope.postMessage({ type: 'stage', stage: 'compile' })
  // MediaPipe is handed the bytes that were just downloaded, so nothing is fetched twice.
  // The object URL stays alive for tasks created later, such as the segmenter.
  const tasks = { ...fileset, wasmBinaryPath: URL.createObjectURL(runtimeBytes) }
  runtime = tasks
  const modelAssetBuffer = new Uint8Array(await model.arrayBuffer())
  const create = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(
      tasks,
      {
        baseOptions: { modelAssetBuffer, delegate },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO',
        numHands: MAX_HANDS,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      },
    )
  landmarker = await create('GPU').catch(() => create('CPU'))

  // The first inference compiles the delegate's shaders; paying for it here keeps
  // the first real camera frame fast.
  scope.postMessage({ type: 'stage', stage: 'warmup' })
  landmarker.detectForVideo(new ImageData(WARMUP_SIZE, WARMUP_SIZE), performance.now())
  scope.postMessage({ type: 'ready' })
}

function setSegmentation(enabled: boolean): void {
  if (!enabled) {
    segmenter?.close()
    segmenter = null
    return
  }
  if (segmenter || segmenterLoading || !runtime) return
  segmenterLoading = SilhouetteSegmenter.create(runtime).then(
    (instance) => {
      segmenter = instance
      segmenterLoading = null
      scope.postMessage({ type: 'segmentation', available: true })
    },
    () => {
      segmenterLoading = null
      scope.postMessage({ type: 'segmentation', available: false })
    },
  )
}

function detect(bitmap: ImageBitmap): void {
  const startedAt = performance.now()
  const hands: Float32Array[] = []
  let mask: Uint8Array | null
  try {
    const result = landmarker?.detectForVideo(bitmap, startedAt)
    for (const hand of result?.landmarks ?? []) {
      if (hand.length < LANDMARK_COUNT) continue
      const packed = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE)
      for (let index = 0; index < LANDMARK_COUNT; index++) {
        packed[index * LANDMARK_STRIDE] = hand[index].x
        packed[index * LANDMARK_STRIDE + 1] = hand[index].y
        packed[index * LANDMARK_STRIDE + 2] = hand[index].z
      }
      hands.push(packed)
    }
    mask = segmenter && frameCount++ % SEGMENTATION_STRIDE === 0 ? segmenter.segment(bitmap, startedAt) : null
  } finally {
    bitmap.close()
  }
  const inferenceMs = performance.now() - startedAt
  const transfer: Transferable[] = hands.map((hand) => hand.buffer)
  if (mask) transfer.push(mask.buffer)
  scope.postMessage({ type: 'result', hands, mask, inferenceMs }, transfer)
}

scope.addEventListener('message', ({ data }) => {
  if (data.type === 'frame') {
    detect(data.bitmap)
    return
  }
  if (data.type === 'segmentation') {
    setSegmentation(data.enabled)
    return
  }
  initialize().catch((error: unknown) => {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  })
})
