import { MathUtils, Vector3, type Camera } from 'three'
import { DEFAULT_ORBIT_AXIS, FORCE_POINT_COUNT, type ForcePoint } from '../gpgpu/forceField'
import { simulationBridge, useSimulationStore, type InputSource } from '../store/useSimulationStore'
import { AutonomousFlow } from './AutonomousFlow'
import { projectToFocalPlane } from './focalPlane'
import { PointerField } from './PointerField'

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
const HAND_DEPTH_RANGE = 0.5
const HAND_REACH = 2.2

interface SourceProfile {
  /** Rate at which the force point follows its input, per second. */
  follow: number
  /** Rate at which the measured velocity is smoothed, per second. */
  velocity: number
  /** 1 when matter is carried along at the input's own velocity, 0 when it is pushed. */
  carry: number
}

// A tracked hand is already filtered and played back along a smooth path, so it is
// followed almost directly; the pointer and attractor keep their softer response.
const PROFILES: Record<InputSource, SourceProfile> = {
  autonomous: { follow: 14, velocity: 10, carry: 0 },
  pointer: { follow: 14, velocity: 10, carry: 0 },
  tracking: { follow: 60, velocity: 22, carry: 1 },
}

interface ForceInput {
  active: boolean
  target: Vector3
  pinch: number
  burst: boolean
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
    axis: null,
  }))
  private readonly axes = Array.from({ length: FORCE_POINT_COUNT }, () => new Vector3())
  private readonly wasActive: boolean[] = Array.from({ length: FORCE_POINT_COUNT }, () => false)
  private source: InputSource = 'autonomous'
  private lastHandAt = Number.NEGATIVE_INFINITY

  update(delta: number, camera: Camera): void {
    const dt = Math.max(delta, 1e-4)
    const tracking = useSimulationStore.getState().vision === 'active'
    this.autonomous.advance(delta, tracking)
    for (const input of this.inputs) {
      input.active = false
      input.burst = false
      input.axis = null
    }

    const source = this.gather(performance.now(), camera, tracking)
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
    points.forEach((point, index) => {
      this.resolve(point, index, dt, profile)
      const steered = source !== 'autonomous' && this.inputs[index].active ? 1 : 0
      point.presence += (steered - point.presence) * (1 - Math.exp(-dt * PRESENCE_RATE))
      point.carry += (profile.carry - point.carry) * (1 - Math.exp(-dt * CARRY_RATE))
      pinch = Math.max(pinch, point.pinch)
      impulse = Math.max(impulse, point.impulse)
    })

    telemetry.source = source
    telemetry.gesture = impulse > 0.3 ? 'shockwave' : pinch > 0.5 ? 'pinch' : 'flow'
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
        input.pinch = hand.pinch
        input.burst = hand.burstPending
        hand.burstPending = false
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
    if (input.burst) point.impulse = 1
    if (point.impulse < SHOCKWAVE_FLOOR) point.impulse = 0

    const spin = index % 2 === 0 ? 1 : -1
    const axisTarget = input.axis ?? fallbackAxis.copy(DEFAULT_ORBIT_AXIS).multiplyScalar(spin)
    point.axis.lerp(axisTarget, 1 - Math.exp(-dt * AXIS_RATE))
    // Blending toward the opposite axis passes through zero; take the target there.
    if (point.axis.lengthSq() < 1e-4) point.axis.copy(axisTarget)
    point.axis.normalize()
  }
}
