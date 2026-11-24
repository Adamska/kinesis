import { MathUtils, Vector3, type Camera } from 'three'
import { DEFAULT_ORBIT_AXIS, FORCE_POINT_COUNT, type ForcePoint } from '../gpgpu/forceField'
import { simulationBridge, type InputSource } from '../store/useSimulationStore'
import { AutonomousFlow } from './AutonomousFlow'
import { PointerField } from './PointerField'

const FOLLOW_RATE = 14
const VELOCITY_RATE = 10
const PINCH_RATE = 9
const AXIS_RATE = 6
const PRESENCE_RATE = 8
const SHOCKWAVE_DECAY = 3.2
const SHOCKWAVE_FLOOR = 0.004
const MAX_HAND_SPEED = 7
const HAND_STALE_MS = 400
const HAND_DEPTH_RANGE = 1.1
const HAND_REACH = 2.2
// Camera exposure and frame delivery add latency that inference timing does not see.
const CAPTURE_LATENCY_S = 0.03
const MAX_PREDICTION_S = 0.12

// A hand sweeps a much shorter world distance than a pointer flick for the same
// intent, so tracked motion is amplified to stir the fluid just as hard.
const VELOCITY_GAIN: Record<InputSource, number> = { autonomous: 1, pointer: 1, tracking: 2.4 }

interface ForceInput {
  active: boolean
  target: Vector3
  pinch: number
  burst: boolean
  /** Spin axis requested by the input, or null to fall back to the default. */
  axis: Vector3 | null
}

/**
 * Projects a normalized device coordinate onto the plane through the origin that
 * faces the camera: the ray p(t) = eye + t * dir meets the plane where
 * dot(p, forward) = 0, giving t = -dot(eye, forward) / dot(dir, forward).
 * `lift` then moves the point off the plane toward the camera.
 */
export function projectToFocalPlane(camera: Camera, x: number, y: number, lift: number, out: Vector3): Vector3 {
  const eye = camera.position
  camera.getWorldDirection(forward)
  direction.set(x, y, 0.5).unproject(camera).sub(eye).normalize()
  const distance = -eye.dot(forward) / direction.dot(forward)
  return out.copy(eye).addScaledVector(direction, distance).addScaledVector(forward, -lift)
}

const forward = new Vector3()
const direction = new Vector3()
const previous = new Vector3()
const velocity = new Vector3()
const fallbackAxis = new Vector3()

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

  update(delta: number, camera: Camera): void {
    const dt = Math.max(delta, 1e-4)
    this.autonomous.advance(delta)
    for (const input of this.inputs) {
      input.active = false
      input.burst = false
      input.axis = null
    }

    const source = this.gather(performance.now(), camera)
    const { points, telemetry } = simulationBridge
    let pinch = 0
    let impulse = 0
    points.forEach((point, index) => {
      this.resolve(point, index, dt, VELOCITY_GAIN[source])
      const steered = source !== 'autonomous' && this.inputs[index].active ? 1 : 0
      point.presence += (steered - point.presence) * (1 - Math.exp(-dt * PRESENCE_RATE))
      pinch = Math.max(pinch, point.pinch)
      impulse = Math.max(impulse, point.impulse)
    })

    telemetry.source = source
    telemetry.gesture = impulse > 0.3 ? 'shockwave' : pinch > 0.5 ? 'pinch' : 'flow'
  }

  /** Fills the per-point inputs from the highest-priority live source. */
  private gather(now: number, camera: Camera): InputSource {
    const hands = simulationBridge.hands
    const live = (index: number) => hands[index].visible && now - hands[index].seenAt < HAND_STALE_MS
    if (hands.some((_, index) => live(index))) {
      // The focal plane spans distance / P00 by distance / P11 world units from its
      // center. Scaling by HAND_REACH over that extent keeps a fully extended hand
      // inside the cloud instead of out at the edge of a wide viewport.
      const { elements } = camera.projectionMatrix
      const distance = camera.position.length()
      const reachX = Math.min(1, (HAND_REACH * elements[0]) / distance)
      const reachY = Math.min(1, (HAND_REACH * elements[5]) / distance)
      const latency = simulationBridge.telemetry.inferenceMs / 1000 + CAPTURE_LATENCY_S
      hands.forEach((hand, index) => {
        if (!live(index)) return
        const input = this.inputs[index]
        // Dead reckoning: the pose is already stale by the capture and inference delay
        // plus the time since it arrived, so the hand is extrapolated along its filtered
        // velocity. This hides most of the vision latency during a sweep.
        const lead = Math.min((now - hand.seenAt) / 1000 + latency, MAX_PREDICTION_S)
        const x = MathUtils.clamp(hand.x + hand.vx * lead, -1, 1) * reachX
        const y = MathUtils.clamp(hand.y + hand.vy * lead, -1, 1) * reachY
        projectToFocalPlane(camera, x, y, hand.depth * HAND_DEPTH_RANGE, input.target)
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

  private resolve(point: ForcePoint, index: number, dt: number, gain: number): void {
    const input = this.inputs[index]
    // A point that was idle snaps to its new input, so a second finger touching down
    // does not sweep across the cloud from wherever its point was last left.
    if (input.active && !this.wasActive[index]) point.position.copy(input.target)
    this.wasActive[index] = input.active

    previous.copy(point.position)
    if (input.active) point.position.lerp(input.target, 1 - Math.exp(-dt * FOLLOW_RATE))
    velocity.subVectors(point.position, previous).divideScalar(dt).multiplyScalar(gain).clampLength(0, MAX_HAND_SPEED)
    point.velocity.lerp(velocity, 1 - Math.exp(-dt * VELOCITY_RATE))

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
