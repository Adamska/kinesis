import { simulationBridge } from '../store/useSimulationStore'
import type { LoadStage, WorkerRequest, WorkerResponse } from './landmarkProtocol'

export type ResultListener = (hands: Float32Array[], inferenceMs: number) => void

/**
 * Main-thread handle on the landmark worker. Loading is decoupled from the camera, so
 * the runtime and model can be fetched and compiled ahead of time, before the user
 * ever asks for tracking, and survive tracking being switched off and on again.
 */
export class LandmarkWorker {
  stage: LoadStage = 'download'
  readonly ready: Promise<void>

  private readonly worker = new Worker(new URL('./landmark.worker.ts', import.meta.url), { type: 'module' })
  private readonly stageListeners = new Set<(stage: LoadStage) => void>()
  private resultListener: ResultListener | null = null
  private failureListener: ((error: unknown) => void) | null = null

  constructor() {
    this.ready = new Promise((resolve, reject) => {
      this.worker.onerror = (event) => {
        const error = event.error ?? new Error(event.message)
        reject(error)
        this.failureListener?.(error)
      }
      this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type === 'stage') {
          this.stage = data.stage
          this.stageListeners.forEach((listener) => listener(data.stage))
        } else if (data.type === 'progress') simulationBridge.telemetry.downloadedBytes = data.bytes
        else if (data.type === 'ready') resolve()
        else if (data.type === 'error') reject(new Error(data.message))
        else this.resultListener?.(data.hands, data.inferenceMs)
      }
    })
    // Rejections are delivered to whoever awaits `ready`; an unobserved preload
    // failure must not surface as an unhandled rejection.
    this.ready.catch(() => undefined)
    this.send({ type: 'init' })
  }

  onStage(listener: (stage: LoadStage) => void): () => void {
    this.stageListeners.add(listener)
    return () => this.stageListeners.delete(listener)
  }

  /** Routes detection results and runtime failures to the single active consumer. */
  attach(onResult: ResultListener | null, onFailure: ((error: unknown) => void) | null = null): void {
    this.resultListener = onResult
    this.failureListener = onFailure
  }

  detect(bitmap: ImageBitmap): void {
    this.send({ type: 'frame', bitmap }, [bitmap])
  }

  terminate(): void {
    this.worker.terminate()
    this.stageListeners.clear()
    this.attach(null)
  }

  private send(request: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(request, transfer)
  }
}
