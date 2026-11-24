import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three'
import reticleFragment from '../shaders/reticle.frag?raw'
import reticleVertex from '../shaders/reticle.vert?raw'
import { simulationBridge } from '../store/useSimulationStore'

const EXTENT = 0.95
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
 * shockwave. It stays dim enough to fall under the bloom threshold.
 */
export function ForceReticles() {
  const { geometry, reticles } = useMemo(() => {
    const geometry = new PlaneGeometry(2, 2)
    return { geometry, reticles: simulationBridge.points.map(() => createReticle(geometry)) }
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      reticles.forEach((reticle) => reticle.material.dispose())
    },
    [geometry, reticles],
  )

  useFrame((_, delta) => {
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
  })

  return (
    <>
      {reticles.map((reticle, index) => (
        <primitive key={index} object={reticle} />
      ))}
    </>
  )
}
