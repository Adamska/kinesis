export type LoadStage = 'download' | 'compile' | 'warmup'

export type WorkerRequest = { type: 'init' } | { type: 'frame'; bitmap: ImageBitmap }

export type WorkerResponse =
  | { type: 'stage'; stage: LoadStage }
  | { type: 'progress'; bytes: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  /** One array per detected hand: interleaved xyz of the 21 landmarks in image space. */
  | { type: 'result'; hands: Float32Array[]; inferenceMs: number }
