import { DataTexture, FloatType, RGBAFormat, Vector3, type Texture } from 'three'
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
    uTargets: { value: null as Texture | null },
    uMorph: { value: 0 },
  }
}

export type ForceUniforms = ReturnType<typeof createForceUniforms>
export type VelocityUniforms = ReturnType<typeof createVelocityUniforms>

export function bindForces(uniforms: ForceUniforms, forces: ForceField): void {
  forces.points.forEach((point, index) => {
    uniforms.uForcePosition.value[index].copy(point.position)
    uniforms.uForceDrive.value[index].set(point.pinch, point.impulse, point.presence)
  })
}

export function bindForceMotion(uniforms: VelocityUniforms, forces: ForceField): void {
  forces.points.forEach((point, index) => {
    uniforms.uForceVelocity.value[index].copy(point.velocity)
    uniforms.uForceAxis.value[index].copy(point.axis)
  })
}

/** A single texel with w = 0: no particle is held by any shape. */
export function createEmptyTargets(): DataTexture {
  const texture = new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType)
  texture.needsUpdate = true
  return texture
}
