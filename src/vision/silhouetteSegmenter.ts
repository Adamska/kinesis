import { ImageSegmenter, type FilesetResolver } from '@mediapipe/tasks-vision'
import { MASK_HEIGHT, MASK_WIDTH } from './silhouetteMask'

// Pinned model version: about 250 KB, small enough to load the moment it is asked for.
const SEGMENTER_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite'
const BLUR_PASSES = 4

export type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>

/** In-place 3 x 3 box blur with clamped edges, applied to the downsampled mask. */
function blur(mask: Float32Array, scratch: Float32Array): void {
  for (let y = 0; y < MASK_HEIGHT; y++) {
    for (let x = 0; x < MASK_WIDTH; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        const row = Math.min(Math.max(y + dy, 0), MASK_HEIGHT - 1) * MASK_WIDTH
        for (let dx = -1; dx <= 1; dx++) sum += mask[row + Math.min(Math.max(x + dx, 0), MASK_WIDTH - 1)]
      }
      scratch[y * MASK_WIDTH + x] = sum / 9
    }
  }
  mask.set(scratch)
}

/**
 * Person segmentation running beside the hand landmarker in the worker. The confidence
 * mask is box-filtered down to a coarse grid and blurred, which turns the hard edge of
 * the body into a ramp: the simulation reads its gradient as the direction to push.
 */
export class SilhouetteSegmenter {
  private readonly segmenter: ImageSegmenter
  private readonly grid = new Float32Array(MASK_WIDTH * MASK_HEIGHT)
  private readonly scratch = new Float32Array(MASK_WIDTH * MASK_HEIGHT)

  private constructor(segmenter: ImageSegmenter) {
    this.segmenter = segmenter
  }

  static async create(fileset: VisionFileset): Promise<SilhouetteSegmenter> {
    const response = await fetch(SEGMENTER_URL)
    if (!response.ok) throw new Error(`Request for ${SEGMENTER_URL} failed with ${response.status}`)
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer())
    // A module worker loads MediaPipe's loader script with import(), which runs a URL
    // only once, and the first task consumes the factory it defines. A distinct URL
    // makes the loader run again for this second task.
    const tasks = { ...fileset, wasmLoaderPath: `${fileset.wasmLoaderPath}?task=segmenter` }
    const create = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(tasks, {
        baseOptions: { modelAssetBuffer, delegate },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      })
    return new SilhouetteSegmenter(await create('GPU').catch(() => create('CPU')))
  }

  /** Returns the person mask on the coarse grid as bytes, or null if none was produced. */
  segment(bitmap: ImageBitmap, timestamp: number): Uint8Array | null {
    let mask: Uint8Array | null = null
    // Masks are only valid inside the callback, which avoids leaking GPU textures.
    this.segmenter.segmentForVideo(bitmap, timestamp, (result) => {
      const confidence = result.confidenceMasks?.[0]
      if (!confidence) return
      const { width, height } = confidence
      const values = confidence.getAsFloat32Array()
      this.grid.fill(0)
      for (let y = 0; y < height; y++) {
        const row = Math.floor((y * MASK_HEIGHT) / height) * MASK_WIDTH
        for (let x = 0; x < width; x++) this.grid[row + Math.floor((x * MASK_WIDTH) / width)] += values[y * width + x]
      }
      const cell = (width / MASK_WIDTH) * (height / MASK_HEIGHT)
      for (let index = 0; index < this.grid.length; index++) this.grid[index] /= cell
      for (let pass = 0; pass < BLUR_PASSES; pass++) blur(this.grid, this.scratch)
      mask = Uint8Array.from(this.grid, (value) => Math.round(Math.min(Math.max(value, 0), 1) * 255))
    })
    return mask
  }

  close(): void {
    this.segmenter.close()
  }
}
