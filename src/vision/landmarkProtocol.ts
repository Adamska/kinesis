export type LoadStage = 'download' | 'compile' | 'warmup'

export type WorkerRequest = { type: 'init' } | { type: 'frame'; bitmap: ImageBitmap }

export type WorkerResponse =
  | { type: 'stage'; stage: LoadStage }
  | { type: 'progress'; bytes: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  /**
   * One array per detected hand: interleaved xyz of the 21 landmarks in image space,
   * the same landmarks in metric 3D around the hand's center, and whether MediaPipe
   * classifies it as a left hand.
   */
  | { type: 'result'; hands: Float32Array[]; world: Float32Array[]; left: boolean[]; inferenceMs: number }
