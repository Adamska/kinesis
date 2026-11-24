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
import { ShapeMorph } from '../gpgpu/ShapeMorph'
import { SimulationEngine, SIMULATION_SIZE } from '../gpgpu/SimulationEngine'
import { ForceDirector } from '../input/ForceDirector'
import particleFragment from '../shaders/particle.frag?raw'
import particleVertex from '../shaders/particle.vert?raw'
import { simulationBridge, useSimulationStore } from '../store/useSimulationStore'

const PARTICLE_SIZE = 0.022
const PALETTE_BLEND_RATE = 4
const FRAME_TIME_SMOOTHING = 0.05

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
  const frameTime = useRef(1 / 60)
  const director = useMemo(() => new ForceDirector(), [])
  const morph = useMemo(() => new ShapeMorph(SIMULATION_SIZE), [])

  const { geometry, material, uniforms } = useMemo(() => {
    const uniforms = createParticleUniforms(PALETTES[useSimulationStore.getState().palette])
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
      morph.dispose()
    },
    [geometry, material, morph],
  )

  useFrame((state, delta) => {
    const engine = engineRef.current
    if (!engine) return
    const { palette, turbulence, shape } = useSimulationStore.getState()

    director.update(delta, state.camera)
    morph.request(shape)
    morph.update(delta)
    engine.step(delta, { forces: simulationBridge, turbulence, targets: morph.targets, morph: morph.strength })

    uniforms.uPositions.value = engine.positionTexture
    uniforms.uVelocities.value = engine.velocityTexture
    state.gl.getDrawingBufferSize(uniforms.uResolution.value)

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
