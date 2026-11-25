import { MathUtils, Vector3, type Camera } from 'three'
import { DEFAULT_ORBIT_AXIS, FORCE_POINT_COUNT, type ForcePoint } from '../gpgpu/forceField'
import { simulationBridge, useSimulationStore, type InputSource } from '../store/useSimulationStore'
import { AutonomousFlow } from './AutonomousFlow'
import { projectToFocalPlane } from './focalPlane'
import { HandSculptor } from './HandSculptor'
import { PointerField } from './PointerField'
import { PROFILES, type SourceProfile } from './sourceProfiles'

const PINCH_RATE = 9
const AXIS_RATE = 6
const PRESENCE_RATE = 8
const CARRY_RATE = 6
const SHOCKWAVE_DECAY = 3.2
const SHOCKWAVE_FLOOR = 0.004
const MAX_SPEED = 9
const HAND_STALE_MS = 400
// After the last hand leaves, its force points stay put this long before the
// attractor takes over, so a brief loss of tracking never sweeps across the cloud.
const HAND_HOLD_MS = 2500
// The attractor only gathers and bursts once nobody has steered for this long; while
// a user is around it just circulates, so nothing ever explodes away from their hand.
const ATTRACT_DELAY_MS = 30_000
const HAND_DEPTH_RANGE = 0.5
const HAND_REACH = 2.2
// Seconds for particles to gather into a still, open hand, and to let go of it.
const SCULPT_GATHER_S = 1.8
const SCULPT_RELEASE_S = 1
// A charging fist opens a gravity well this strong, so the fluid around it is drawn
// into a tightening vortex, and beats faster as the charge builds.
const CHARGE_PULL = 0.3
const CHARGE_RISE_RATE = 14
const CHARGE_FALL_RATE = 5
const PULSE_FROM_HZ = 1.5
const PULSE_TO_HZ = 8

interface ForceInput {
  active: boolean
  target: Vector3
  pinch: number
  burst: boolean
  /** 1 while the hand behind this input holds the sculpt pose. */
  sculpt: number
  /** Overload of the sculpting hand's fist, from 0 to 1. */
  charge: number
  /** True on the frame a charged fist explodes. */
  explode: boolean
  /** Spin axis requested by the input, or null to fall back to the default. */
  axis: Vector3 | null
}

const previous = new Vector3()
const velocity = new Vector3()
const fallbackAxis = new Vector3()
const palm: [number, number] = [0, 0]

/** Picks the active input source each frame and resolves it into the shared force points. */
export class ForceDirector {
  readonly pointer = new PointerField()

  private readonly autonomous = new AutonomousFlow()
  private readonly inputs: ForceInput[] = Array.from({ length: FORCE_POINT_COUNT }, () => ({
    active: false,
    target: new Vector3(),
    pinch: 0,
    burst: false,
    sculpt: 0,
    charge: 0,
    explode: false,
    axis: null,
  }))
  private readonly beats: number[] = Array.from({ length: FORCE_POINT_COUNT }, () => 0)
  private readonly sculptor = new HandSculptor()
  private readonly axes = Array.from({ length: FORCE_POINT_COUNT }, () => new Vector3())
  private readonly wasActive: boolean[] = Array.from({ length: FORCE_POINT_COUNT }, () => false)
  private source: InputSource = 'autonomous'
  private lastHandAt = Number.NEGATIVE_INFINITY
  private lastUserAt = Number.NEGATIVE_INFINITY
  private attracting = true

  update(delta: number, camera: Camera): void {
    const dt = Math.max(delta, 1e-4)
    const now = performance.now()
    const tracking = useSimulationStore.getState().vision === 'active'
    const attracting = !tracking && now - this.lastUserAt >= ATTRACT_DELAY_MS
    if (attracting && !this.attracting) this.autonomous.restartCycle()
    this.attracting = attracting
    this.autonomous.advance(delta, !attracting)
    for (const input of this.inputs) {
      input.active = false
      input.burst = false
      input.sculpt = 0
      input.charge = 0
      input.explode = false
      input.axis = null
    }

    // The hand model is only needed once a webcam session starts.
    if (tracking) this.sculptor.prepare((surface) => (simulationBridge.handSurface = surface))
    const source = this.gather(now, camera, tracking)
    if (source !== 'autonomous') this.lastUserAt = now
    // A new source starts where it is, instead of dragging its points across the cloud.
    if (source !== this.source) this.wasActive.fill(false)
    this.source = source
    if (simulationBridge.burstRequested) {
      simulationBridge.burstRequested = false
      for (const input of this.inputs) input.burst ||= input.active
    }

    const { points, telemetry } = simulationBridge
    const profile = PROFILES[source]
    let pinch = 0
    let impulse = 0
    let sculpt = 0
    let charge = 0
    points.forEach((point, index) => {
      this.resolve(point, index, dt, profile)
      this.sculpt(point, index, dt, source, camera)
      sculpt = Math.max(sculpt, point.sculpt)
      charge = Math.max(charge, point.charge)
      const steered = source !== 'autonomous' && this.inputs[index].active ? 1 : 0
      point.presence += (steered - point.presence) * (1 - Math.exp(-dt * PRESENCE_RATE))
      point.carry += (profile.carry - point.carry) * (1 - Math.exp(-dt * CARRY_RATE))
      pinch = Math.max(pinch, point.pinch)
      impulse = Math.max(impulse, point.impulse)
    })

    telemetry.source = source
    telemetry.gesture =
      impulse > 0.3
        ? 'shockwave'
        : charge > 0.05
          ? 'overload'
          : pinch > 0.5
            ? 'pinch'
            : sculpt > 0.3
              ? 'sculpt'
              : 'flow'
  }

  /**
   * Ramps the point's sculpt progress toward its hand's pose and keeps the hand's
   * surface in step with the point. A hand that leaves keeps its last surface while
   * its particles let go, and snaps to its new pose the next time it sculpts. An
   * exploding fist lets go of every particle at once, so the blast throws them all.
   */
  private sculpt(point: ForcePoint, index: number, dt: number, source: InputSource, camera: Camera): void {
    const input = this.inputs[index]
    const holding = input.sculpt > 0
    const rate = holding ? 1 / SCULPT_GATHER_S : -1 / SCULPT_RELEASE_S
    point.sculpt = input.explode ? 0 : MathUtils.clamp(point.sculpt + rate * dt, 0, 1)

    const chargeRate = input.charge > point.charge ? CHARGE_RISE_RATE : CHARGE_FALL_RATE
    point.charge += (input.charge - point.charge) * (1 - Math.exp(-dt * chargeRate))
    if (input.explode || point.charge < 1e-3) point.charge = 0
    const hz = MathUtils.lerp(PULSE_FROM_HZ, PULSE_TO_HZ, point.charge * point.charge)
    this.beats[index] = point.charge > 0 ? (this.beats[index] + dt * hz) % 1 : 0
    point.pulse = point.charge > 0 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * this.beats[index]) : 0

    const live = source === 'tracking' && input.active
    if (live && (holding || point.sculpt > 0)) {
      this.sculptor.update(index, simulationBridge.hands[index], point.position, camera, dt)
    } else if (point.sculpt === 0) this.sculptor.reset(index)
  }

  /** Fills the per-point inputs from the highest-priority live source. */
  private gather(now: number, camera: Camera, tracking: boolean): InputSource {
    const hands = simulationBridge.hands
    const live = (index: number) => hands[index].visible && now - hands[index].seenAt < HAND_STALE_MS
    if (hands.some((_, index) => live(index))) {
      this.lastHandAt = now
      // The focal plane spans distance / P00 by distance / P11 world units from its
      // center. Scaling by HAND_REACH over that extent keeps a fully extended hand
      // inside the cloud instead of out at the edge of a wide viewport.
      const { elements } = camera.projectionMatrix
      const distance = camera.position.length()
      const reachX = Math.min(1, (HAND_REACH * elements[0]) / distance)
      const reachY = Math.min(1, (HAND_REACH * elements[5]) / distance)
      hands.forEach((hand, index) => {
        if (!live(index)) return
        const input = this.inputs[index]
        const [x, y] = hand.path.sample(now, palm)
        projectToFocalPlane(
          camera,
          MathUtils.clamp(x, -1, 1) * reachX,
          MathUtils.clamp(y, -1, 1) * reachY,
          hand.depth * HAND_DEPTH_RANGE,
          input.target,
        )
        input.active = true
        input.burst = hand.burstPending
        input.sculpt = hand.sculpting && this.sculptor.ready ? 1 : 0
        input.charge = input.sculpt * hand.charge
        input.pinch = Math.max(hand.pinch, input.charge * CHARGE_PULL)
        input.explode = hand.explodePending && this.sculptor.ready
        input.burst ||= input.explode
        hand.burstPending = false
        hand.explodePending = false
        // The palm normal is measured in view space; the camera's rotation carries it
        // into the world, so tilting the hand tilts the singularity's disc.
        input.axis = this.axes[index].copy(hand.palmNormal).applyQuaternion(camera.quaternion)
      })
      return 'tracking'
    }
    if (tracking && now - this.lastHandAt < HAND_HOLD_MS) return 'tracking'

    const contacts = this.pointer.contacts
    if (contacts.some((contact) => this.pointer.isEngaged(contact, now))) {
      contacts.forEach((contact, index) => {
        const input = this.inputs[index]
        input.burst = this.pointer.consumeRelease(contact)
        if (!this.pointer.isEngaged(contact, now)) return
        projectToFocalPlane(camera, contact.x, contact.y, 0, input.target)
        input.active = true
        input.pinch = contact.pressed ? 1 : 0
      })
      return 'pointer'
    }

    const input = this.inputs[0]
    input.active = true
    input.target.copy(this.autonomous.position)
    input.pinch = this.autonomous.pinch
    input.burst = this.autonomous.consumeBurst()
    return 'autonomous'
  }

  private resolve(point: ForcePoint, index: number, dt: number, profile: SourceProfile): void {
    const input = this.inputs[index]
    // A point that was idle snaps to its new input, so a hand or finger arriving does
    // not sweep across the cloud from wherever its point was last left.
    const arriving = input.active && !this.wasActive[index]
    if (arriving) point.position.copy(input.target)
    this.wasActive[index] = input.active

    previous.copy(point.position)
    if (input.active) point.position.lerp(input.target, 1 - Math.exp(-dt * profile.follow))
    velocity.subVectors(point.position, previous).divideScalar(dt).clampLength(0, MAX_SPEED)
    if (arriving) point.velocity.set(0, 0, 0)
    else point.velocity.lerp(velocity, 1 - Math.exp(-dt * profile.velocity))

    const pinchTarget = input.active ? input.pinch : 0
    point.pinch += (pinchTarget - point.pinch) * (1 - Math.exp(-dt * PINCH_RATE))

    point.impulse *= Math.exp(-dt * SHOCKWAVE_DECAY)
    if (input.burst) {
      point.impulse = 1
      point.blast = input.explode ? 1 : 0
    }
    if (point.impulse < SHOCKWAVE_FLOOR) {
      point.impulse = 0
      point.blast = 0
    }

    const spin = index % 2 === 0 ? 1 : -1
    const axisTarget = input.axis ?? fallbackAxis.copy(DEFAULT_ORBIT_AXIS).multiplyScalar(spin)
    point.axis.lerp(axisTarget, 1 - Math.exp(-dt * AXIS_RATE))
    // Blending toward the opposite axis passes through zero; take the target there.
    if (point.axis.lengthSq() < 1e-4) point.axis.copy(axisTarget)
    point.axis.normalize()
  }
}
