import { Vector3, type Camera } from 'three'
import { simulationBridge, type InputSource } from '../store/useSimulationStore'
import { AutonomousFlow } from './AutonomousFlow'
import { PointerField } from './PointerField'

const FOLLOW_RATE = 14
const VELOCITY_RATE = 10
const PINCH_RATE = 9
const SHOCKWAVE_DECAY = 3.2
const SHOCKWAVE_FLOOR = 0.004
const MAX_HAND_SPEED = 7
const HAND_STALE_MS = 400
const HAND_DEPTH_RANGE = 0.9
const HAND_REACH = 1.9

/**
 * Projects a normalized device coordinate onto the plane through the origin that
 * faces the camera: the ray p(t) = eye + t * dir meets the plane where
 * dot(p, forward) = 0, giving t = -dot(eye, forward) / dot(dir, forward).
 * `lift` then moves the point off the plane toward the camera.
 */
function projectToFocalPlane(camera: Camera, x: number, y: number, lift: number, out: Vector3): Vector3 {
  const eye = camera.position
  camera.getWorldDirection(forward)
  direction.set(x, y, 0.5).unproject(camera).sub(eye).normalize()
  const distance = -eye.dot(forward) / direction.dot(forward)
  return out.copy(eye).addScaledVector(direction, distance).addScaledVector(forward, -lift)
}

const forward = new Vector3()
const direction = new Vector3()

/** Picks the active input source each frame and resolves it into the shared force field. */
export class ForceDirector {
  readonly pointer = new PointerField()

  private readonly autonomous = new AutonomousFlow()
  private readonly target = new Vector3()
  private readonly previous = new Vector3()
  private readonly velocity = new Vector3()

  update(delta: number, camera: Camera): void {
    const bridge = simulationBridge
    const dt = Math.max(delta, 1e-4)
    let source: InputSource
    let pinchTarget: number
    let burst: boolean

    const now = performance.now()
    const hand = bridge.hand
    this.autonomous.advance(delta)
    if (hand.visible && now - hand.seenAt < HAND_STALE_MS) {
      source = 'tracking'
      // The focal plane spans distance / P00 by distance / P11 world units from its
      // center. Scaling by HAND_REACH over that extent keeps a fully extended hand
      // inside the cloud instead of out at the edge of a wide viewport.
      const { elements } = camera.projectionMatrix
      const distance = camera.position.length()
      const x = hand.x * Math.min(1, (HAND_REACH * elements[0]) / distance)
      const y = hand.y * Math.min(1, (HAND_REACH * elements[5]) / distance)
      projectToFocalPlane(camera, x, y, hand.depth * HAND_DEPTH_RANGE, this.target)
      pinchTarget = hand.pinch
      burst = hand.burstPending
      hand.burstPending = false
    } else if (this.pointer.isEngaged(now)) {
      source = 'pointer'
      projectToFocalPlane(camera, this.pointer.x, this.pointer.y, 0, this.target)
      pinchTarget = this.pointer.pressed ? 1 : 0
      burst = this.pointer.consumeRelease()
    } else {
      source = 'autonomous'
      this.target.copy(this.autonomous.position)
      pinchTarget = this.autonomous.pinch
      burst = this.autonomous.consumeBurst()
    }

    this.previous.copy(bridge.handPos)
    bridge.handPos.lerp(this.target, 1 - Math.exp(-dt * FOLLOW_RATE))
    this.velocity
      .subVectors(bridge.handPos, this.previous)
      .divideScalar(dt)
      .clampLength(0, MAX_HAND_SPEED)
    bridge.handVelocity.lerp(this.velocity, 1 - Math.exp(-dt * VELOCITY_RATE))

    bridge.pinchStrength += (pinchTarget - bridge.pinchStrength) * (1 - Math.exp(-dt * PINCH_RATE))
    bridge.shockwaveImpulse *= Math.exp(-dt * SHOCKWAVE_DECAY)
    if (burst) bridge.shockwaveImpulse = 1
    if (bridge.shockwaveImpulse < SHOCKWAVE_FLOOR) bridge.shockwaveImpulse = 0

    bridge.telemetry.source = source
    bridge.telemetry.gesture =
      bridge.shockwaveImpulse > 0.3 ? 'shockwave' : bridge.pinchStrength > 0.5 ? 'pinch' : 'flow'
  }
}
