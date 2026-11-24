import { Vector3, type Texture } from 'three'
import { FORCE_POINT_COUNT, type ForceField } from './forceField'

const vectors = (): Vector3[] => Array.from({ length: FORCE_POINT_COUNT }, () => new Vector3())

export const FORCE_DEFINES = { FORCE_COUNT: FORCE_POINT_COUNT }

export function createForceUniforms() {
  return {
    uPosition: { value: null as Texture | null },
    uVelocity: { value: null as Texture | null },
    uDelta: { value: 0 },
    uForcePosition: { value: vectors() },
    uForceDrive: { value: vectors() },
  }
}

export function createVelocityUniforms() {
  return {
    ...createForceUniforms(),
    uTime: { value: 0 },
    uTurbulence: { value: 1 },
    uForceVelocity: { value: vectors() },
    uForceAxis: { value: vectors() },
  }
}

export type ForceUniforms = ReturnType<typeof createForceUniforms>
export type VelocityUniforms = ReturnType<typeof createVelocityUniforms>

export function bindForces(uniforms: ForceUniforms, forces: ForceField): void {
  forces.points.forEach((point, index) => {
    uniforms.uForcePosition.value[index].copy(point.position)
    uniforms.uForceDrive.value[index].set(point.pinch, point.impulse, point.carry)
  })
}

export function bindForceMotion(uniforms: VelocityUniforms, forces: ForceField): void {
  forces.points.forEach((point, index) => {
    uniforms.uForceVelocity.value[index].copy(point.velocity)
    uniforms.uForceAxis.value[index].copy(point.axis)
  })
}
