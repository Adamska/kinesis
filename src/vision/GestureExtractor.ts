import { MathUtils, Vector3 } from 'three'
import type { TrackedHand } from '../store/useSimulationStore'
import { Landmark, LANDMARK_STRIDE } from './handTopology'
import { OneEuroFilter } from './OneEuroFilter'

const REACH_GAIN = 1.4
const PINCH_RATE = 16
const LOST_GRACE_MS = 280

const PINCH_CLOSED = 0.22
const PINCH_OPEN = 0.6
const SPREAD_FIST = 1.2
const SPREAD_OPEN = 1.7
// In a pinch the middle, ring and little fingers stay out; in a fist they curl in.
const OTHERS_CURLED = 1.25
const OTHERS_OUT = 1.45
const NEAR_PALM = 0.3
const FAR_PALM = 0.12

// A shockwave is the release of a pinch that was clearly held, never a single noisy
// frame: the pinch must stay closed this long, while the hand is not sweeping fast.
const PINCH_DEAD_ZONE = 0.3
const PINCH_FULL = 0.9
const PINCH_ARMED = 0.75
const PINCH_RELEASED = 0.25
const PINCH_HOLD_MS = 150
const ARMING_MAX_SPEED = 2.5
const BURST_WINDOW_MS = 400
const BURST_COOLDOWN_MS = 650
const NORMAL_RATE = 10
const VELOCITY_RATE = 25

const wristToIndex = new Vector3()
const wristToPinky = new Vector3()
const normal = new Vector3()

/** Turns raw hand landmarks into the smoothed, distance-invariant metrics the simulation reads. */
export class GestureExtractor {
  private readonly hand: TrackedHand
  private readonly x = new OneEuroFilter(1.5, 10, 3)
  private readonly y = new OneEuroFilter(1.5, 10, 3)
  private readonly depth = new OneEuroFilter(0.5, 0.5)
  private lastSampleAt = 0
  private pinchedSince = Number.NEGATIVE_INFINITY
  private armedUntil = Number.NEGATIVE_INFINITY
  private burstAt = Number.NEGATIVE_INFINITY

  constructor(hand: TrackedHand) {
    this.hand = hand
  }

  update(landmarks: Float32Array | null, aspect: number, now: number): void {
    const hand = this.hand
    if (!landmarks) {
      // Motion blur drops detection for a frame or two during fast moves. Holding the
      // last pose briefly keeps the force field from jumping back to another source.
      if (hand.visible && now - hand.seenAt > LOST_GRACE_MS) this.release()
      return
    }

    // Landmarks are normalized per axis; scaling x by the aspect ratio makes image-plane
    // distances isotropic. Dividing by palm length makes every metric distance-invariant.
    const at = (index: number, axis: number) => landmarks[index * LANDMARK_STRIDE + axis]
    const span = (a: number, b: number) => Math.hypot((at(a, 0) - at(b, 0)) * aspect, at(a, 1) - at(b, 1))

    const palm = Math.max(span(Landmark.WRIST, Landmark.MIDDLE_MCP), 1e-4)
    const pinchGap = span(Landmark.THUMB_TIP, Landmark.INDEX_TIP) / palm
    // A fist also brings the thumb onto the index; only a hand whose other fingers are
    // still extended counts as pinching.
    const othersSpread =
      (span(Landmark.WRIST, Landmark.MIDDLE_TIP) +
        span(Landmark.WRIST, Landmark.RING_TIP) +
        span(Landmark.WRIST, Landmark.PINKY_TIP)) /
      (3 * palm)
    const othersOut = MathUtils.smoothstep(othersSpread, OTHERS_CURLED, OTHERS_OUT)
    const pinch = (1 - MathUtils.smoothstep(pinchGap, PINCH_CLOSED, PINCH_OPEN)) * othersOut
    const spread =
      (span(Landmark.WRIST, Landmark.INDEX_TIP) +
        span(Landmark.WRIST, Landmark.MIDDLE_TIP) +
        span(Landmark.WRIST, Landmark.RING_TIP) +
        span(Landmark.WRIST, Landmark.PINKY_TIP)) /
      (4 * palm)
    const openness = MathUtils.smoothstep(spread, SPREAD_FIST, SPREAD_OPEN)

    // Mirror x so the cloud follows the hand like a reflection, and amplify reach so the
    // edges of the volume are comfortable to hit without leaving the camera frame.
    const centerX = at(Landmark.WRIST, 0) + at(Landmark.MIDDLE_MCP, 0)
    const centerY = at(Landmark.WRIST, 1) + at(Landmark.MIDDLE_MCP, 1)
    const x = MathUtils.clamp((1 - centerX) * REACH_GAIN, -1, 1)
    const y = MathUtils.clamp((1 - centerY) * REACH_GAIN, -1, 1)
    const depth = MathUtils.clamp(MathUtils.mapLinear(palm, FAR_PALM, NEAR_PALM, -1, 1), -1, 1)

    // A hand that reappears after a real loss snaps into place: dt = 0 re-primes the filters.
    const dt = hand.visible ? Math.min((now - this.lastSampleAt) / 1000, 0.1) : 0
    const previousX = hand.x
    const previousY = hand.y
    hand.x = this.x.filter(x, dt)
    hand.y = this.y.filter(y, dt)
    // Velocity of the filtered path with its own light smoothing: responsive enough
    // that extrapolation stops when the hand does, without amplifying jitter.
    const blend = dt > 0 ? 1 - Math.exp(-dt * VELOCITY_RATE) : 0
    hand.vx = dt > 0 ? hand.vx + ((hand.x - previousX) / dt - hand.vx) * blend : 0
    hand.vy = dt > 0 ? hand.vy + ((hand.y - previousY) / dt - hand.vy) * blend : 0
    if (dt === 0) hand.path.reset()
    hand.path.push(now, hand.x, hand.y)
    hand.depth = this.depth.filter(depth, dt)
    // Relaxed fingers often sit partly closed; a dead zone keeps them from opening a
    // weak gravity well the user never asked for.
    const strength = MathUtils.smoothstep(pinch, PINCH_DEAD_ZONE, PINCH_FULL)
    hand.pinch = dt > 0 ? MathUtils.lerp(hand.pinch, strength, 1 - Math.exp(-dt * PINCH_RATE)) : strength
    this.detectRelease(pinch, openness, dt > 0 ? Math.hypot(hand.vx, hand.vy) : 0, dt === 0, now)

    this.updatePalmNormal(at, aspect, dt)
    hand.landmarks.set(landmarks)
    hand.aspect = aspect
    hand.visible = true
    hand.seenAt = now
    this.lastSampleAt = now
  }

  /** Arms on a held pinch and fires a shockwave when the hand opens shortly after. */
  private detectRelease(pinch: number, openness: number, speed: number, reacquired: boolean, now: number): void {
    if (reacquired) {
      this.pinchedSince = Number.NEGATIVE_INFINITY
      this.armedUntil = Number.NEGATIVE_INFINITY
      return
    }
    if (pinch >= PINCH_ARMED && speed < ARMING_MAX_SPEED) {
      if (!Number.isFinite(this.pinchedSince)) this.pinchedSince = now
      if (now - this.pinchedSince >= PINCH_HOLD_MS) this.armedUntil = now + BURST_WINDOW_MS
      return
    }
    this.pinchedSince = Number.NEGATIVE_INFINITY
    const released = pinch < PINCH_RELEASED && openness > 0.5
    if (released && now < this.armedUntil && now - this.burstAt > BURST_COOLDOWN_MS) {
      this.hand.burstPending = true
      this.burstAt = now
      this.armedUntil = Number.NEGATIVE_INFINITY
    }
  }

  /**
   * Palm normal from the wrist and the index and pinky knuckles. Image x and the
   * relative depth z are both normalized by frame width, y by frame height; scaling x
   * and z by the aspect ratio makes the axes isotropic. Negating all three converts
   * mirrored image space (y down, z away) into view space (y up, z toward the viewer).
   */
  private updatePalmNormal(at: (index: number, axis: number) => number, aspect: number, dt: number): void {
    const toView = (index: number, out: Vector3) =>
      out.set(
        (at(Landmark.WRIST, 0) - at(index, 0)) * aspect,
        at(Landmark.WRIST, 1) - at(index, 1),
        (at(Landmark.WRIST, 2) - at(index, 2)) * aspect,
      )
    toView(Landmark.INDEX_MCP, wristToIndex)
    toView(Landmark.PINKY_MCP, wristToPinky)
    normal.crossVectors(wristToIndex, wristToPinky)
    if (normal.lengthSq() < 1e-10) return
    normal.normalize()
    const palm = this.hand.palmNormal
    if (dt > 0) palm.lerp(normal, 1 - Math.exp(-dt * NORMAL_RATE))
    if (dt <= 0 || palm.lengthSq() < 1e-4) palm.copy(normal)
    palm.normalize()
  }

  release(): void {
    this.hand.visible = false
    this.hand.path.reset()
    this.x.reset()
    this.y.reset()
    this.depth.reset()
  }
}
