import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, Color, Mesh, PlaneGeometry, Scene, ShaderMaterial } from 'three'
import reticleFragment from '../shaders/reticle.frag?raw'
import reticleVertex from '../shaders/reticle.vert?raw'
import { simulationBridge } from '../store/useSimulationStore'

const EXTENT = 0.95
// Runs after the post-processing composer (priority 1), drawing on top of its output.
const OVERLAY_PRIORITY = 2
const SPIN_RATE = 0.6
const SIGNAL = new Color('#d7f4ff')

function createReticle(geometry: PlaneGeometry): Mesh<PlaneGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    vertexShader: reticleVertex,
    fragmentShader: reticleFragment,
    uniforms: {
      uExtent: { value: EXTENT },
      uPresence: { value: 0 },
      uPinch: { value: 0 },
      uImpulse: { value: 0 },
      uSpin: { value: 0 },
      uColor: { value: SIGNAL },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  return mesh
}

/**
 * Hairline reticle at every steered force point: it shows where a hand or finger
 * lands in the volume, tightens as the pinch closes and sends a ring out with each
 * shockwave. As interface rather than matter, it is drawn in its own scene after
 * post-processing, so trails, lensing and bloom leave it untouched.
 */
export function ForceReticles() {
  const { geometry, reticles, overlay } = useMemo(() => {
    const geometry = new PlaneGeometry(2, 2)
    const reticles = simulationBridge.points.map(() => createReticle(geometry))
    const overlay = new Scene()
    overlay.add(...reticles)
    return { geometry, reticles, overlay }
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      reticles.forEach((reticle) => reticle.material.dispose())
    },
    [geometry, reticles],
  )

  useFrame(({ gl, camera }, delta) => {
    simulationBridge.points.forEach((point, index) => {
      const reticle = reticles[index]
      const uniforms = reticle.material.uniforms
      reticle.position.copy(point.position)
      reticle.visible = point.presence > 0.01
      uniforms.uPresence.value = point.presence
      uniforms.uPinch.value = point.pinch
      uniforms.uImpulse.value = point.impulse
      // Ticks turn faster while the well is closed, in the direction the matter spins.
      const direction = Math.sign(point.axis.z) || 1
      uniforms.uSpin.value += delta * SPIN_RATE * direction * (1 + 4 * point.pinch)
    })

    const autoClear = gl.autoClear
    gl.autoClear = false
    gl.setRenderTarget(null)
    gl.render(overlay, camera)
    gl.autoClear = autoClear
  }, OVERLAY_PRIORITY)

  return null
}
