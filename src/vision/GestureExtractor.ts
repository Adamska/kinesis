import { MathUtils } from 'three'
import { simulationBridge } from '../store/useSimulationStore'
import { Landmark } from './handTopology'
import { OneEuroFilter } from './OneEuroFilter'

const REACH_GAIN = 1.4
const PINCH_RATE = 22
const LOST_GRACE_MS = 280

const PINCH_CLOSED = 0.22
const PINCH_OPEN = 0.6
const SPREAD_FIST = 1.2
const SPREAD_OPEN = 1.7
const NEAR_PALM = 0.3
const FAR_PALM = 0.12

const BURST_WINDOW_MS = 380
const BURST_COOLDOWN_MS = 650

/** Turns raw hand landmarks into the smoothed, distance-invariant metrics the simulation reads. */
export class GestureExtractor {
  private readonly x = new OneEuroFilter(1.2, 4)
  private readonly y = new OneEuroFilter(1.2, 4)
  private readonly depth = new OneEuroFilter(0.5, 0.5)
  private lastSampleAt = 0
  private closedAt = Number.NEGATIVE_INFINITY
  private burstAt = Number.NEGATIVE_INFINITY

  update(landmarks: Float32Array | null, aspect: number, now: number): void {
    const hand = simulationBridge.hand
    if (!landmarks) {
      // Motion blur drops detection for a frame or two during fast moves. Holding the
      // last pose briefly keeps the force field from jumping back to another source.
      if (hand.visible && now - hand.seenAt > LOST_GRACE_MS) this.release()
      return
    }

    // Landmarks are normalized per axis; scaling x by the aspect ratio makes image-plane
    // distances isotropic. Dividing by palm length makes every metric distance-invariant.
    const span = (a: number, b: number) =>
      Math.hypot((landmarks[a * 2] - landmarks[b * 2]) * aspect, landmarks[a * 2 + 1] - landmarks[b * 2 + 1])

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
    const centerX = landmarks[Landmark.WRIST * 2] + landmarks[Landmark.MIDDLE_MCP * 2]
    const centerY = landmarks[Landmark.WRIST * 2 + 1] + landmarks[Landmark.MIDDLE_MCP * 2 + 1]
    const x = MathUtils.clamp((1 - centerX) * REACH_GAIN, -1, 1)
    const y = MathUtils.clamp((1 - centerY) * REACH_GAIN, -1, 1)
    const depth = MathUtils.clamp(MathUtils.mapLinear(palm, FAR_PALM, NEAR_PALM, -1, 1), -1, 1)

    // A hand that reappears after a real loss snaps into place: dt = 0 re-primes the filters.
    const dt = hand.visible ? Math.min((now - this.lastSampleAt) / 1000, 0.1) : 0
    hand.x = this.x.filter(x, dt)
    hand.y = this.y.filter(y, dt)
    hand.depth = this.depth.filter(depth, dt)
    hand.pinch = dt > 0 ? MathUtils.lerp(hand.pinch, pinch, 1 - Math.exp(-dt * PINCH_RATE)) : pinch

    hand.landmarks.set(landmarks)
    hand.aspect = aspect
    hand.visible = true
    hand.seenAt = now
    this.lastSampleAt = now
  }

  release(): void {
    simulationBridge.hand.visible = false
    this.x.reset()
    this.y.reset()
    this.depth.reset()
  }
}
