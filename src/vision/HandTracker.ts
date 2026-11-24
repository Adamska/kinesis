import { simulationBridge } from '../store/useSimulationStore'
import { GestureExtractor } from './GestureExtractor'
import { assignHandSlots } from './handSlots'
import type { LoadStage } from './landmarkProtocol'
import type { LandmarkWorker } from './LandmarkWorker'

export type TrackerStage = 'permission' | LoadStage

export interface TrackerEvents {
  onStage: (stage: TrackerStage) => void
  onFailure: (error: unknown) => void
}

const POLL_INTERVAL_MS = 1000 / 30
const DEFAULT_ASPECT = 4 / 3

function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
  })
}

/**
 * Owns the camera stream for one tracking session. Camera frames are taken from an
 * offscreen video as they are decoded and transferred to the landmark worker, where
 * MediaPipe runs. Neither startup nor inference ever occupies the main thread, and
 * results go straight into the simulation bridge without touching React.
 */
export class HandTracker {
  readonly video = document.createElement('video')

  private readonly worker: LandmarkWorker
  private readonly gestures = simulationBridge.hands.map((hand) => new GestureExtractor(hand))
  private readonly events: TrackerEvents
  private stream: MediaStream | null = null
  private cameraOpen = false
  private detachStage: () => void
  private timer = 0
  private disposed = false
  private awaitingResult = false
  private frameCallbacksSeen = false
  private frameReady = false
  private lastVideoTime = -1

  constructor(worker: LandmarkWorker, events: TrackerEvents) {
    this.worker = worker
    this.events = events
    this.detachStage = worker.onStage((stage) => this.cameraOpen && events.onStage(stage))
  }

  async start(): Promise<void> {
    this.events.onStage('permission')
    // The permission prompt and the model, which may already be preloaded, are
    // independent, so they are awaited together.
    const [camera, model] = await Promise.allSettled([
      openCamera().then((stream) => {
        this.stream = stream
        this.cameraOpen = true
        this.events.onStage(this.worker.stage)
      }),
      this.worker.ready,
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
    this.worker.attach(
      (hands, inferenceMs) => this.receive(hands, inferenceMs),
      (error) => this.events.onFailure(error),
    )
    this.startSampling()
  }

  dispose(): void {
    this.disposed = true
    window.clearTimeout(this.timer)
    this.detachStage()
    this.worker.attach(null)
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.video.srcObject = null
    this.gestures.forEach((gesture) => gesture.release())
    simulationBridge.telemetry.inferenceMs = 0
    simulationBridge.telemetry.downloadedBytes = 0
  }

  /**
   * Video frame callbacks fire as each camera frame is decoded, which removes up to a
   * full polling interval of latency. A timer poll covers browsers without them and
   * stands down as soon as the first callback arrives.
   */
  private startSampling(): void {
    const { video } = this
    if ('requestVideoFrameCallback' in video) {
      const onFrame = () => {
        if (this.disposed) return
        this.frameCallbacksSeen = true
        this.frameReady = true
        video.requestVideoFrameCallback(onFrame)
        this.capture()
      }
      video.requestVideoFrameCallback(onFrame)
    }
    this.poll()
  }

  // Without frame callbacks the best available signal is the playback clock. On a live
  // stream it advances continuously, so this path may resend a frame occasionally.
  private readonly poll = (): void => {
    if (this.disposed || this.frameCallbacksSeen) return
    this.timer = window.setTimeout(this.poll, POLL_INTERVAL_MS)
    if (this.video.currentTime === this.lastVideoTime) return
    this.lastVideoTime = this.video.currentTime
    this.frameReady = true
    this.capture()
  }

  /** Sends the pending camera frame once the worker is idle and the page is visible. */
  private capture(): void {
    const { video } = this
    const decoded = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    if (document.hidden || this.awaitingResult || !this.frameReady || !decoded) return
    this.frameReady = false
    this.awaitingResult = true

    createImageBitmap(video).then(
      (bitmap) => {
        if (this.disposed) bitmap.close()
        else this.worker.detect(bitmap)
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
    // A frame that was decoded while the worker was busy is sent right away.
    this.capture()
  }
}
