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

// Sculpt: every finger out, the thumb spread away from the index, held still. It
// engages only from a clearly open, steady hand; from then on the hand can move and
// relax freely. Closing it into a fist charges an overload that explodes after
// OVERLOAD_MS; opening it again before then cancels the charge and keeps the hand.
// Closed and open have separate thresholds, and a reopening must last REOPEN_MS, so
// a frame folded by motion blur neither starts nor cancels a charge on its own.
const OPEN_SPREAD_FROM = 1.42
const OPEN_SPREAD_TO = 1.58
const THUMB_OUT_FROM = 0.45
const THUMB_OUT_TO = 0.65
const SCULPT_ENGAGE_POSE = 0.8
const SCULPT_ENGAGE_SPEED = 0.35
const SCULPT_HOLD_MS = 450
const FIST_SPREAD = 1.3
const REOPEN_SPREAD = 1.45
const OVERLOAD_MS = 2000
const REOPEN_MS = 150
// MediaPipe's handedness flickers on ambiguous frames; a hand only changes sides
// after this many consecutive frames agree.
const HANDEDNESS_FRAMES = 6
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
  private stillSince = Number.NEGATIVE_INFINITY
  private fistSince = Number.NEGATIVE_INFINITY
  private reopenSince = Number.NEGATIVE_INFINITY
  private handednessVotes = 0

  constructor(hand: TrackedHand) {
    this.hand = hand
  }

  update(landmarks: Float32Array | null, world: Float32Array | null, left: boolean, aspect: number, now: number): void {
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
    const thumbOut = span(Landmark.THUMB_TIP, Landmark.INDEX_MCP) / palm
    const openPose =
      MathUtils.smoothstep(spread, OPEN_SPREAD_FROM, OPEN_SPREAD_TO) *
      MathUtils.smoothstep(thumbOut, THUMB_OUT_FROM, THUMB_OUT_TO) *
      (1 - pinch)

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
    const speed = dt > 0 ? Math.hypot(hand.vx, hand.vy) : 0
    this.detectRelease(pinch, openness, speed, dt === 0, now)
    this.detectSculpt(openPose, spread, speed, dt === 0, now)

    this.updateHandedness(left, dt === 0)
    this.updatePalmNormal(at, aspect, dt)
    hand.landmarks.set(landmarks)
    if (world) hand.world.set(world)
    else hand.world.fill(0)
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
   * MediaPipe labels handedness assuming a mirrored, selfie-style image. The frames it
   * sees are not mirrored but the view is, so its label names the hand as it appears
   * on screen, which is the chirality the hand model must take.
   */
  private updateHandedness(left: boolean, reacquired: boolean): void {
    const hand = this.hand
    // The label is most reliable on an open palm facing the camera, which is how a
    // sculpt starts. Turned edge-on or to its back it can flip, and a flipped model
    // would show the palm where the back should be, so it is locked while sculpting.
    if (hand.sculpting && !reacquired) {
      this.handednessVotes = 0
      return
    }
    if (reacquired || left === hand.left) {
      if (reacquired) hand.left = left
      this.handednessVotes = 0
      return
    }
    if (++this.handednessVotes >= HANDEDNESS_FRAMES) {
      hand.left = left
      this.handednessVotes = 0
    }
  }

  /**
   * Engages once an open hand has stayed still briefly. While engaged, a fist charges
   * an overload and a fist held for OVERLOAD_MS explodes, ending the sculpt.
   */
  private detectSculpt(openPose: number, spread: number, speed: number, reacquired: boolean, now: number): void {
    const hand = this.hand
    if (hand.sculpting) {
      if (spread < FIST_SPREAD) {
        this.reopenSince = Number.NEGATIVE_INFINITY
        if (!Number.isFinite(this.fistSince)) this.fistSince = now
      } else if (spread > REOPEN_SPREAD && Number.isFinite(this.fistSince)) {
        if (!Number.isFinite(this.reopenSince)) this.reopenSince = now
        if (now - this.reopenSince >= REOPEN_MS) this.endCharge()
      }
      hand.charge = Number.isFinite(this.fistSince) ? Math.min((now - this.fistSince) / OVERLOAD_MS, 1) : 0
      if (hand.charge < 1) return
      hand.explodePending = true
      hand.sculpting = false
      this.endCharge()
      this.stillSince = Number.NEGATIVE_INFINITY
      return
    }
    if (reacquired || openPose < SCULPT_ENGAGE_POSE || speed > SCULPT_ENGAGE_SPEED) {
      this.stillSince = Number.NEGATIVE_INFINITY
      return
    }
    if (!Number.isFinite(this.stillSince)) this.stillSince = now
    hand.sculpting = now - this.stillSince >= SCULPT_HOLD_MS
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

  private endCharge(): void {
    this.hand.charge = 0
    this.fistSince = Number.NEGATIVE_INFINITY
    this.reopenSince = Number.NEGATIVE_INFINITY
  }

  release(): void {
    this.hand.visible = false
    // A hand that leaves lets its particles go quietly; only a held fist explodes.
    this.hand.sculpting = false
    this.stillSince = Number.NEGATIVE_INFINITY
    this.endCharge()
    this.hand.path.reset()
    this.x.reset()
    this.y.reset()
    this.depth.reset()
  }
}
