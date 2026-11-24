import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Texture,
} from 'three'
import { PALETTES, type CosinePalette } from '../config/palettes'
import { BodyObstacle } from '../gpgpu/BodyObstacle'
import { REFERENCE_COUNT } from '../config/density'
import { SimulationEngine } from '../gpgpu/SimulationEngine'
import { ForceDirector } from '../input/ForceDirector'
import particleFragment from '../shaders/particle.frag?raw'
import particleVertex from '../shaders/particle.vert?raw'
import { simulationBridge, useSimulationStore } from '../store/useSimulationStore'

const PARTICLE_SIZE = 0.022
const PALETTE_BLEND_RATE = 4
const FRAME_TIME_SMOOTHING = 0.05
// Loud passages from the microphone stir the field harder.
const AUDIO_TURBULENCE_GAIN = 1.6
// Blur radius per world unit of distance from the focal plane.
const APERTURE = 0.024
const FOCUS_RATE = 3

const scratch = new Vector3()

function createParticleGeometry(size: number): BufferGeometry {
  const count = size * size
  const references = new Float32Array(count * 3)
  for (let index = 0; index < count; index++) {
    references[index * 3] = ((index % size) + 0.5) / size
    references[index * 3 + 1] = (Math.floor(index / size) + 0.5) / size
    references[index * 3 + 2] = Math.random()
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(references, 3))
  return geometry
}

function createParticleUniforms(palette: CosinePalette, size: number) {
  // Additive blending sums every sprite, so denser grids draw each particle dimmer
  // and slightly smaller to keep the cloud's overall exposure close to the reference.
  const ratio = REFERENCE_COUNT / (size * size)
  return {
    uDensityGain: { value: Math.min(ratio ** 0.6, 1.4) },
    uPositions: { value: null as Texture | null },
    uVelocities: { value: null as Texture | null },
    uResolution: { value: new Vector2(1, 1) },
    uParticleSize: { value: PARTICLE_SIZE * Math.min(ratio ** 0.2, 1.1) },
    uFocusDistance: { value: 5 },
    uAperture: { value: APERTURE },
    uPaletteA: { value: new Vector3(...palette.a) },
    uPaletteB: { value: new Vector3(...palette.b) },
    uPaletteC: { value: new Vector3(...palette.c) },
    uPaletteD: { value: new Vector3(...palette.d) },
  }
}

export function ParticleField({ size }: { size: number }) {
  const gl = useThree((state) => state.gl)
  const engineRef = useRef<SimulationEngine | null>(null)
  const frameTime = useRef(1 / 60)
  const director = useMemo(() => new ForceDirector(), [])
  const obstacle = useMemo(() => new BodyObstacle(), [])

  const { geometry, material, uniforms } = useMemo(() => {
    const uniforms = createParticleUniforms(PALETTES[useSimulationStore.getState().palette], size)
    const material = new ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms,
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    return { geometry: createParticleGeometry(size), material, uniforms }
  }, [size])

  useEffect(() => {
    const engine = new SimulationEngine(gl, size)
    engineRef.current = engine
    return () => {
      engineRef.current = null
      engine.dispose()
    }
  }, [gl, size])

  useEffect(() => director.pointer.attach(gl.domElement), [director, gl])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
      obstacle.dispose()
    },
    [geometry, material, obstacle],
  )

  useFrame((state, delta) => {
    const engine = engineRef.current
    if (!engine) return
    const { palette, turbulence, silhouette } = useSimulationStore.getState()

    director.update(delta, state.camera)
    obstacle.update(simulationBridge.silhouette, silhouette === 'on', state.camera, state.size.width / state.size.height, delta)
    engine.step(delta, {
      forces: simulationBridge,
      turbulence: turbulence * (1 + AUDIO_TURBULENCE_GAIN * simulationBridge.audioLevel),
      obstacle,
    })

    uniforms.uPositions.value = engine.positionTexture
    uniforms.uVelocities.value = engine.velocityTexture
    state.gl.getDrawingBufferSize(uniforms.uResolution.value)

    // Focus rests on the center of the cloud and racks to the force point a user steers.
    const lead = simulationBridge.points[0]
    const center = state.camera.position.length()
    const focus = center + (state.camera.position.distanceTo(lead.position) - center) * lead.presence
    uniforms.uFocusDistance.value += (focus - uniforms.uFocusDistance.value) * (1 - Math.exp(-delta * FOCUS_RATE))

    const blend = 1 - Math.exp(-delta * PALETTE_BLEND_RATE)
    const target = PALETTES[palette]
    uniforms.uPaletteA.value.lerp(scratch.fromArray(target.a), blend)
    uniforms.uPaletteB.value.lerp(scratch.fromArray(target.b), blend)
    uniforms.uPaletteC.value.lerp(scratch.fromArray(target.c), blend)
    uniforms.uPaletteD.value.lerp(scratch.fromArray(target.d), blend)

    // Average the frame time and invert it: averaging 1 / delta would overstate the
    // rate whenever short frames bunch up behind a long one.
    frameTime.current += (delta - frameTime.current) * FRAME_TIME_SMOOTHING
    simulationBridge.telemetry.fps = 1 / Math.max(frameTime.current, 1e-4)
  })

  return <points geometry={geometry} material={material} frustumCulled={false} />
}
