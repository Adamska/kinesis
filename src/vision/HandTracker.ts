import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { MathUtils } from 'three'
import { simulationBridge } from '../store/useSimulationStore'
import { Landmark, LANDMARK_COUNT } from './handTopology'

// The WASM runtime must match the installed @mediapipe/tasks-vision version exactly.
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const INFERENCE_INTERVAL_MS = 1000 / 30
const POSITION_RATE = 16
const PINCH_RATE = 22
const REACH_GAIN = 1.3

const PINCH_CLOSED = 0.22
const PINCH_OPEN = 0.6
const SPREAD_FIST = 1.2
const SPREAD_OPEN = 1.7
const NEAR_PALM = 0.3
const FAR_PALM = 0.12
const DEFAULT_ASPECT = 4 / 3

const BURST_WINDOW_MS = 380
const BURST_COOLDOWN_MS = 650

async function createLandmarker(): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT)
  const create = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    })
  return create('GPU').catch(() => create('CPU'))
}

function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  })
}

/**
 * Owns the camera stream, the MediaPipe HandLandmarker and a timer-driven inference
 * loop that is independent of the render loop. Results are written straight into the
 * simulation bridge; nothing here touches React.
 */
export class HandTracker {
  private readonly video = document.createElement('video')
  private landmarker: HandLandmarker | null = null
  private stream: MediaStream | null = null
  private timer = 0
  private disposed = false
  private lastVideoTime = -1
  private lastSampleAt = 0
  private closedAt = Number.NEGATIVE_INFINITY
  private burstAt = Number.NEGATIVE_INFINITY

  async start(): Promise<void> {
    // Permission prompt and model download are independent, so they run concurrently.
    const [camera, model] = await Promise.allSettled([openCamera(), createLandmarker()])
    if (camera.status === 'fulfilled') this.stream = camera.value
    if (model.status === 'fulfilled') this.landmarker = model.value
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
    this.tick()
  }

  dispose(): void {
    this.disposed = true
    window.clearTimeout(this.timer)
    this.landmarker?.close()
    this.landmarker = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.video.srcObject = null
    simulationBridge.hand.visible = false
    simulationBridge.telemetry.inferenceMs = 0
  }

  private readonly tick = (): void => {
    if (this.disposed) return
    this.timer = window.setTimeout(this.tick, INFERENCE_INTERVAL_MS)

    const { video, landmarker } = this
    const hasNewFrame =
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== this.lastVideoTime
    if (!landmarker || !hasNewFrame) return
    this.lastVideoTime = video.currentTime

    const startedAt = performance.now()
    const result = landmarker.detectForVideo(video, startedAt)
    const finishedAt = performance.now()

    const telemetry = simulationBridge.telemetry
    telemetry.inferenceMs += (finishedAt - startedAt - telemetry.inferenceMs) * 0.2
    this.extractGesture(result.landmarks[0], finishedAt)
  }

  private extractGesture(landmarks: NormalizedLandmark[] | undefined, now: number): void {
    const hand = simulationBridge.hand
    if (!landmarks || landmarks.length < LANDMARK_COUNT) {
      hand.visible = false
      return
    }

    // Landmarks are normalized per axis; scaling x by the aspect ratio makes image-plane
    // distances isotropic. Dividing by palm length makes every metric distance-invariant.
    const aspect = this.video.videoWidth / this.video.videoHeight || DEFAULT_ASPECT
    const span = (a: number, b: number) =>
      Math.hypot((landmarks[a].x - landmarks[b].x) * aspect, landmarks[a].y - landmarks[b].y)

    const palm = Math.max(span(Landmark.WRIST, Landmark.MIDDLE_MCP), 1e-4)
    const pinchGap = span(Landmark.THUMB_TIP, Landmark.INDEX_TIP) / palm
    const pinch = 1 - MathUtils.smoothstep(pinchGap, PINCH_CLOSED, PINCH_OPEN)
    const spread =
      (span(Landmark.WRIST, Landmark.INDEX_TIP) +
        span(Landmark.WRIST, Landmark.MIDDLE_TIP) +
        span(Landmark.WRIST, Landmark.RING_TIP) +
        span(Landmark.WRIST, Landmark.PINKY_TIP)) /
      (4 * palm)
    const openness = MathUtils.smoothstep(spread, SPREAD_FIST, SPREAD_OPEN)

    // A shockwave is a closed or pinched hand snapping wide open within a short window.
    if (Math.max(pinch, 1 - openness) > 0.7) this.closedAt = now
    const snappedOpen = openness > 0.75 && pinch < 0.25 && now - this.closedAt < BURST_WINDOW_MS
    if (snappedOpen && now - this.burstAt > BURST_COOLDOWN_MS) {
      hand.burstPending = true
      this.burstAt = now
      this.closedAt = Number.NEGATIVE_INFINITY
    }

    // Mirror x so the cloud follows the hand like a reflection, and amplify reach so the
    // edges of the volume are comfortable to hit without leaving the camera frame.
    const wrist = landmarks[Landmark.WRIST]
    const knuckle = landmarks[Landmark.MIDDLE_MCP]
    const x = MathUtils.clamp((1 - (wrist.x + knuckle.x)) * REACH_GAIN, -1, 1)
    const y = MathUtils.clamp((1 - (wrist.y + knuckle.y)) * REACH_GAIN, -1, 1)
    const depth = MathUtils.clamp(MathUtils.mapLinear(palm, FAR_PALM, NEAR_PALM, -1, 1), -1, 1)

    // Exponential smoothing, frame-rate independent; a reappearing hand snaps into place.
    const dt = hand.visible ? Math.min((now - this.lastSampleAt) / 1000, 0.1) : Infinity
    const follow = 1 - Math.exp(-dt * POSITION_RATE)
    hand.x = MathUtils.lerp(hand.x, x, follow)
    hand.y = MathUtils.lerp(hand.y, y, follow)
    hand.depth = MathUtils.lerp(hand.depth, depth, follow)
    hand.pinch = MathUtils.lerp(hand.pinch, pinch, 1 - Math.exp(-dt * PINCH_RATE))

    for (let index = 0; index < LANDMARK_COUNT; index++) {
      hand.landmarks[index * 2] = landmarks[index].x
      hand.landmarks[index * 2 + 1] = landmarks[index].y
    }
    hand.aspect = aspect
    hand.visible = true
    hand.seenAt = now
    this.lastSampleAt = now
  }
}
