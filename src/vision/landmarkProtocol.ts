export type LoadStage = 'download' | 'compile' | 'warmup'

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'frame'; bitmap: ImageBitmap }
  | { type: 'segmentation'; enabled: boolean }

export type WorkerResponse =
  | { type: 'stage'; stage: LoadStage }
  | { type: 'progress'; bytes: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'segmentation'; available: boolean }
  /**
   * One array per detected hand: interleaved xyz of the 21 landmarks in image space.
   * The person mask is present only while segmentation is on.
   */
  | { type: 'result'; hands: Float32Array[]; mask: Uint8Array | null; inferenceMs: number }
