import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { LANDMARK_COUNT, LANDMARK_STRIDE, MAX_HANDS } from './handTopology'
import type { WorkerRequest, WorkerResponse } from './landmarkProtocol'

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
  const [runtime, model] = await Promise.all([
    download(fileset.wasmBinaryPath, 'application/wasm'),
    download(MODEL_URL, 'application/octet-stream'),
  ])

  scope.postMessage({ type: 'stage', stage: 'compile' })
  // MediaPipe is handed the bytes that were just downloaded, so nothing is fetched twice.
  const wasmBinaryPath = URL.createObjectURL(runtime)
  const modelAssetBuffer = new Uint8Array(await model.arrayBuffer())
  const create = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(
      { ...fileset, wasmBinaryPath },
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
  URL.revokeObjectURL(wasmBinaryPath)

  // The first inference compiles the delegate's shaders; paying for it here keeps
  // the first real camera frame fast.
  scope.postMessage({ type: 'stage', stage: 'warmup' })
  landmarker.detectForVideo(new ImageData(WARMUP_SIZE, WARMUP_SIZE), performance.now())
  scope.postMessage({ type: 'ready' })
}

function detect(bitmap: ImageBitmap): void {
  const startedAt = performance.now()
  const hands: Float32Array[] = []
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
  } finally {
    bitmap.close()
  }
  const inferenceMs = performance.now() - startedAt
  scope.postMessage({ type: 'result', hands, inferenceMs }, hands.map((hand) => hand.buffer))
}

scope.addEventListener('message', ({ data }) => {
  if (data.type === 'frame') {
    detect(data.bitmap)
    return
  }
  initialize().catch((error: unknown) => {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  })
})
