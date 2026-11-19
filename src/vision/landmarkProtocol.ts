export type LoadStage = 'download' | 'compile' | 'warmup'

export type WorkerRequest = { type: 'init' } | { type: 'frame'; bitmap: ImageBitmap }

export type WorkerResponse =
  | { type: 'stage'; stage: LoadStage }
  | { type: 'progress'; bytes: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  /** Interleaved xy image coordinates of the 21 landmarks, or null when no hand is found. */
  | { type: 'result'; landmarks: Float32Array | null; inferenceMs: number }
