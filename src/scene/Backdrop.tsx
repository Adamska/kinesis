import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, Mesh, ShaderMaterial, Vector3 } from 'three'
import { PALETTES, type CosinePalette } from '../config/palettes'
import { createFullscreenTriangle } from '../gpgpu/primitives'
import backdropFragment from '../shaders/backdrop.frag?raw'
import backdropVertex from '../shaders/backdrop.vert?raw'
import { useSimulationStore } from '../store/useSimulationStore'

const VOID = new Color('#050608')
// Point on the palette ramp that sets the hue of the ambience: its mid tones.
const TINT_TONE = 0.45
// Linear radiance of the glow at its center; kept just above the void so the
// background reads as a faint atmosphere rather than a lit surface.
const TINT_STRENGTH = 0.028
const BLEND_RATE = 4

const target = new Vector3()

/** Mid-tone of a cosine palette, normalized so every palette glows equally faintly. */
function ambience({ a, b, c, d }: CosinePalette, out: Vector3): Vector3 {
  out.set(
    ...([0, 1, 2].map((channel) =>
      Math.max(a[channel] + b[channel] * Math.cos(2 * Math.PI * (c[channel] * TINT_TONE + d[channel])), 0),
    ) as [number, number, number]),
  )
  const peak = Math.max(out.x, out.y, out.z, 1e-3)
  return out.multiplyScalar(TINT_STRENGTH / peak)
}

/** Faint radial glow in the palette's color behind the particles, instead of flat black. */
export function Backdrop() {
  const mesh = useMemo(() => {
    const material = new ShaderMaterial({
      vertexShader: backdropVertex,
      fragmentShader: backdropFragment,
      uniforms: {
        uVoid: { value: new Vector3(VOID.r, VOID.g, VOID.b) },
        uTint: { value: ambience(PALETTES[useSimulationStore.getState().palette], new Vector3()) },
        uAspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    })
    const backdrop = new Mesh(createFullscreenTriangle(), material)
    backdrop.frustumCulled = false
    backdrop.renderOrder = -1
    return backdrop
  }, [])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )

  useFrame((state, delta) => {
    const uniforms = mesh.material.uniforms
    uniforms.uAspect.value = state.size.width / Math.max(state.size.height, 1)
    ambience(PALETTES[useSimulationStore.getState().palette], target)
    uniforms.uTint.value.lerp(target, 1 - Math.exp(-delta * BLEND_RATE))
  })

  return <primitive object={mesh} />
}
