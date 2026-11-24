import { Vector3 } from 'three'

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
}

export interface ForceField {
  points: readonly ForcePoint[]
}

export function createForcePoint(index: number): ForcePoint {
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    // The second point spins the other way, so two wells shear against each other.
    axis: DEFAULT_ORBIT_AXIS.clone().multiplyScalar(index % 2 === 0 ? 1 : -1),
    pinch: 0,
    impulse: 0,
  }
}
