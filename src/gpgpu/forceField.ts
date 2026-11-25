import { Vector3 } from 'three'
import type { HandSurface } from './handShape'

/** Number of simultaneous force points the shaders evaluate: two hands or two fingers. */
export const FORCE_POINT_COUNT = 2

/** Spin axis of the pinch well when no hand orientation is available. */
export const DEFAULT_ORBIT_AXIS = new Vector3(0.279, 0.93, 0.239).normalize()

export interface ForcePoint {
  position: Vector3
  velocity: Vector3
  /** Unit axis the pinch well spins matter around; its sign sets the direction. */
  axis: Vector3
  pinch: number
  /** Shockwave impulse decaying from 1 to 0; 1 - impulse is the blast's age. */
  impulse: number
  /** How visibly a user is steering this point, from 0 to 1. Drives the reticle and focus. */
  presence: number
  /**
   * How the point moves matter: 0 pushes it with an acceleration along the point's
   * velocity, 1 carries it along at the point's own speed.
   */
  carry: number
  /**
   * How far particles have gathered into the shape of the hand steering this point,
   * from 0 to 1. Rises once an open hand is held still and falls when it lets go.
   */
  sculpt: number
  /** Overload of a sculpted hand closed into a fist, from 0 to 1 at its explosion. */
  charge: number
  /** Heartbeat of the overload, from 0 to 1, quickening as the charge rises. */
  pulse: number
  /** 1 while the running shockwave is a charged fist exploding, 0 otherwise. */
  blast: number
}

export interface ForceField {
  points: readonly ForcePoint[]
  /** Posed surface of each tracked hand, read while its point sculpts; null until loaded. */
  handSurface: HandSurface | null
}

export function createForcePoint(index: number): ForcePoint {
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    // The second point spins the other way, so two wells shear against each other.
    axis: DEFAULT_ORBIT_AXIS.clone().multiplyScalar(index % 2 === 0 ? 1 : -1),
    pinch: 0,
    impulse: 0,
    presence: 0,
    carry: 0,
    sculpt: 0,
    charge: 0,
    pulse: 0,
    blast: 0,
  }
}
