import { simulationBridge } from '../store/useSimulationStore'
import { GestureExtractor } from './GestureExtractor'
import { assignHandSlots } from './handSlots'
import type { LoadStage, WorkerRequest, WorkerResponse } from './landmarkProtocol'

export type TrackerStage = 'permission' | LoadStage

export interface TrackerEvents {
  onStage: (stage: TrackerStage) => void
  onFailure: (error: unknown) => void
}

const INFERENCE_INTERVAL_MS = 1000 / 30
const DEFAULT_ASPECT = 4 / 3

function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  })
}

/**
 * Owns the camera stream and the landmark worker. Camera frames are sampled from an
 * offscreen video on a 30 Hz timer and transferred to the worker, where MediaPipe
 * loads, compiles and runs. Neither startup nor inference ever occupies the main
 * thread, and results go straight into the simulation bridge without touching React.
 */
export class HandTracker {
  private readonly video = document.createElement('video')
  private readonly worker = new Worker(new URL('./landmark.worker.ts', import.meta.url), { type: 'module' })
  private readonly gestures = simulationBridge.hands.map((hand) => new GestureExtractor(hand))
  private readonly events: TrackerEvents
  private stream: MediaStream | null = null
  private loadStage: LoadStage = 'download'
  private timer = 0
  private disposed = false
  private awaitingResult = false
  private lastVideoTime = -1

  constructor(events: TrackerEvents) {
    this.events = events
  }

  async start(): Promise<void> {
    this.events.onStage('permission')
    // Permission prompt and model startup are independent, so they run concurrently.
    const [camera, model] = await Promise.allSettled([
      openCamera().then((stream) => {
        this.stream = stream
        this.events.onStage(this.loadStage)
      }),
      this.loadModel(),
    ])
    const failure = [camera, model].find((result) => result.status === 'rejected')
    if (failure || this.disposed) {
      this.dispose()
      if (failure) throw failure.reason
      return
    }

    this.video.muted = true
    this.video.playsInline = true
    this.video.srcObject = this.stream
    await this.video.play()
    this.worker.onerror = (event) => this.events.onFailure(event.error ?? event.message)
    this.pump()
  }

  dispose(): void {
    this.disposed = true
    window.clearTimeout(this.timer)
    this.worker.terminate()
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.video.srcObject = null
    this.gestures.forEach((gesture) => gesture.release())
    simulationBridge.telemetry.inferenceMs = 0
    simulationBridge.telemetry.downloadedBytes = 0
  }

  private loadModel(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker.onerror = (event) => reject(event.error ?? new Error(event.message))
      this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type === 'stage') {
          this.loadStage = data.stage
          if (this.stream) this.events.onStage(data.stage)
        } else if (data.type === 'progress') simulationBridge.telemetry.downloadedBytes = data.bytes
        else if (data.type === 'ready') resolve()
        else if (data.type === 'error') reject(new Error(data.message))
        else this.receive(data.hands, data.inferenceMs)
      }
      this.send({ type: 'init' })
    })
  }

  private send(request: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(request, transfer)
  }

  /** Samples the camera at most once per interval and only when the worker is idle. */
  private readonly pump = (): void => {
    if (this.disposed) return
    this.timer = window.setTimeout(this.pump, INFERENCE_INTERVAL_MS)

    const { video } = this
    const hasNewFrame =
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== this.lastVideoTime
    if (this.awaitingResult || !hasNewFrame) return
    this.lastVideoTime = video.currentTime
    this.awaitingResult = true

    createImageBitmap(video).then(
      (bitmap) => {
        if (this.disposed) bitmap.close()
        else this.send({ type: 'frame', bitmap }, [bitmap])
      },
      () => {
        this.awaitingResult = false
      },
    )
  }

  private receive(hands: Float32Array[], inferenceMs: number): void {
    this.awaitingResult = false
    if (this.disposed) return
    const telemetry = simulationBridge.telemetry
    telemetry.inferenceMs += (inferenceMs - telemetry.inferenceMs) * 0.2
    const aspect = this.video.videoWidth / this.video.videoHeight || DEFAULT_ASPECT
    const now = performance.now()
    assignHandSlots(hands, simulationBridge.hands).forEach((landmarks, slot) => {
      this.gestures[slot].update(landmarks, aspect, now)
    })
  }
}
