import { Vector3, Vector4, type Texture } from 'three'
import { FORCE_POINT_COUNT, type ForceField } from './forceField'
import { HAND_SAMPLE_SIZE, HAND_VERTEX_WIDTH } from './handShape'

const vectors = (): Vector3[] => Array.from({ length: FORCE_POINT_COUNT }, () => new Vector3())
const drives = (): Vector4[] => Array.from({ length: FORCE_POINT_COUNT }, () => new Vector4())

export const FORCE_DEFINES = {
  FORCE_COUNT: FORCE_POINT_COUNT,
  HAND_VERTEX_WIDTH,
  HAND_SAMPLE_SIZE,
}

export function createForceUniforms() {
  return {
    uPosition: { value: null as Texture | null },
    uVelocity: { value: null as Texture | null },
    uDelta: { value: 0 },
    uForcePosition: { value: vectors() },
    uForceDrive: { value: drives() },
    uForceCharge: { value: vectors() },
  }
}

export function createVelocityUniforms() {
  return {
    ...createForceUniforms(),
    uTime: { value: 0 },
    uTurbulence: { value: 1 },
    uForceVelocity: { value: vectors() },
    uForceAxis: { value: vectors() },
    uHandVertices: { value: null as Texture | null },
    uHandVelocities: { value: null as Texture | null },
    uHandSamples: { value: null as Texture | null },
    uHandRows: { value: 0 },
  }
}

export type ForceUniforms = ReturnType<typeof createForceUniforms>
export type VelocityUniforms = ReturnType<typeof createVelocityUniforms>

/** Writes each point's drive (pinch, impulse, carry, sculpt) into a uniform array. */
export function bindForceDrive(drive: Vector4[], forces: ForceField): void {
  forces.points.forEach((point, index) => drive[index].set(point.pinch, point.impulse, point.carry, point.sculpt))
}

/** Writes each point's overload (charge, pulse, blast) into a uniform array. */
export function bindForceCharge(charge: Vector3[], forces: ForceField): void {
  forces.points.forEach((point, index) => charge[index].set(point.charge, point.pulse, point.blast))
}

export function bindForces(uniforms: ForceUniforms, forces: ForceField): void {
  bindForceDrive(uniforms.uForceDrive.value, forces)
  bindForceCharge(uniforms.uForceCharge.value, forces)
  forces.points.forEach((point, index) => uniforms.uForcePosition.value[index].copy(point.position))
}

export function bindForceMotion(uniforms: VelocityUniforms, forces: ForceField): void {
  forces.points.forEach((point, index) => {
    uniforms.uForceVelocity.value[index].copy(point.velocity)
    uniforms.uForceAxis.value[index].copy(point.axis)
  })
  const surface = forces.handSurface
  uniforms.uHandVertices.value = surface?.vertices ?? null
  uniforms.uHandVelocities.value = surface?.velocities ?? null
  uniforms.uHandSamples.value = surface?.samples ?? null
  uniforms.uHandRows.value = surface?.rows ?? 0
}
