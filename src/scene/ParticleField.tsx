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
import { DEFAULT_PALETTE, PALETTES, type CosinePalette } from '../config/palettes'
import { SimulationEngine, SIMULATION_SIZE } from '../gpgpu/SimulationEngine'
import { ForceDirector } from '../input/ForceDirector'
import particleFragment from '../shaders/particle.frag?raw'
import particleVertex from '../shaders/particle.vert?raw'
import { simulationBridge, useSimulationStore } from '../store/useSimulationStore'

const PARTICLE_SIZE = 0.022
const PALETTE_BLEND_RATE = 4
const FPS_SMOOTHING = 0.05

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

function createParticleUniforms(palette: CosinePalette) {
  return {
    uPositions: { value: null as Texture | null },
    uVelocities: { value: null as Texture | null },
    uResolution: { value: new Vector2(1, 1) },
    uParticleSize: { value: PARTICLE_SIZE },
    uPaletteA: { value: new Vector3(...palette.a) },
    uPaletteB: { value: new Vector3(...palette.b) },
    uPaletteC: { value: new Vector3(...palette.c) },
    uPaletteD: { value: new Vector3(...palette.d) },
  }
}

export function ParticleField() {
  const gl = useThree((state) => state.gl)
  const engineRef = useRef<SimulationEngine | null>(null)
  const director = useMemo(() => new ForceDirector(), [])

  const { geometry, material, uniforms } = useMemo(() => {
    const uniforms = createParticleUniforms(PALETTES[DEFAULT_PALETTE])
    const material = new ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms,
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    return { geometry: createParticleGeometry(SIMULATION_SIZE), material, uniforms }
  }, [])

  useEffect(() => {
    const engine = new SimulationEngine(gl)
    engineRef.current = engine
    return () => {
      engineRef.current = null
      engine.dispose()
    }
  }, [gl])

  useEffect(() => director.pointer.attach(gl.domElement), [director, gl])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((state, delta) => {
    const engine = engineRef.current
    if (!engine) return
    const { palette, turbulence } = useSimulationStore.getState()

    director.update(delta, state.camera)
    engine.step(delta, simulationBridge, turbulence)

    uniforms.uPositions.value = engine.positionTexture
    uniforms.uVelocities.value = engine.velocityTexture
    state.gl.getDrawingBufferSize(uniforms.uResolution.value)

    const blend = 1 - Math.exp(-delta * PALETTE_BLEND_RATE)
    const target = PALETTES[palette]
    uniforms.uPaletteA.value.lerp(scratch.fromArray(target.a), blend)
    uniforms.uPaletteB.value.lerp(scratch.fromArray(target.b), blend)
    uniforms.uPaletteC.value.lerp(scratch.fromArray(target.c), blend)
    uniforms.uPaletteD.value.lerp(scratch.fromArray(target.d), blend)

    const telemetry = simulationBridge.telemetry
    telemetry.fps += (1 / Math.max(delta, 1e-4) - telemetry.fps) * FPS_SMOOTHING
  })

  return <points geometry={geometry} material={material} frustumCulled={false} />
}
