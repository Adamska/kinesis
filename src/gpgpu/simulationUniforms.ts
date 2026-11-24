import { DataTexture, FloatType, Matrix4, RGBAFormat, Vector2, Vector3, type Texture } from 'three'
import type { BodyObstacle } from './BodyObstacle'
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
    uMask: { value: null as Texture | null },
    uMaskStrength: { value: 0 },
    uMaskScale: { value: new Vector2(1, 1) },
    uBodyCenter: { value: new Vector2(0.5, 0.5) },
    uViewProjection: { value: new Matrix4() },
    uCameraRight: { value: new Vector3(1, 0, 0) },
    uCameraUp: { value: new Vector3(0, 1, 0) },
    uScreenAspect: { value: 1 },
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

export function bindObstacle(uniforms: VelocityUniforms, obstacle: BodyObstacle | null, fallback: Texture): void {
  const strength = obstacle?.strength ?? 0
  uniforms.uMaskStrength.value = strength
  uniforms.uMask.value = obstacle && strength > 1e-3 ? obstacle.texture : fallback
  if (!obstacle || strength <= 1e-3) return
  uniforms.uMaskScale.value.copy(obstacle.maskScale)
  uniforms.uBodyCenter.value.copy(obstacle.center)
  uniforms.uViewProjection.value.copy(obstacle.viewProjection)
  uniforms.uCameraRight.value.copy(obstacle.right)
  uniforms.uCameraUp.value.copy(obstacle.up)
  uniforms.uScreenAspect.value = obstacle.screenAspect
}

/** A single black texel, bound wherever a sampler has nothing to read. */
export function createEmptyTexture(): DataTexture {
  const texture = new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType)
  texture.needsUpdate = true
  return texture
}
