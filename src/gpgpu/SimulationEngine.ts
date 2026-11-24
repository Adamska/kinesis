import {
  Mesh,
  NoBlending,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  type BufferGeometry,
  type IUniform,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three'
import curlNoise from '../shaders/curlNoise.glsl?raw'
import positionFragment from '../shaders/position.frag?raw'
import seedFragment from '../shaders/seed.frag?raw'
import simulationVertex from '../shaders/simulation.vert?raw'
import velocityFragment from '../shaders/velocity.frag?raw'
import { FORCE_POINT_COUNT, type ForceField } from './forceField'
import { createFullscreenTriangle, createStateTarget } from './primitives'
import { createSeedState } from './seedState'

export const SIMULATION_SIZE = 320
export const PARTICLE_COUNT = SIMULATION_SIZE * SIMULATION_SIZE

const MAX_TIME_STEP = 1 / 30

interface PingPong {
  read: WebGLRenderTarget
  write: WebGLRenderTarget
}

const vectors = <T>(create: () => T): T[] => Array.from({ length: FORCE_POINT_COUNT }, create)

const createForceUniforms = () => ({
  uPosition: { value: null as Texture | null },
  uVelocity: { value: null as Texture | null },
  uDelta: { value: 0 },
  uForcePosition: { value: vectors(() => new Vector3()) },
  uForceDrive: { value: vectors(() => new Vector2()) },
})

const FORCE_DEFINES = { FORCE_COUNT: FORCE_POINT_COUNT }

/*
 * State layout, one texel per particle on a size x size grid:
 *
 *   position target   rgb = world position        a = kinetic energy
 *   velocity target   rgb = velocity (units / s)  a = turbulence phase in [0, 1)
 *
 * Both are RGBA16F. Half floats are color-renderable on every WebGL2 device,
 * whereas RGBA32F render targets are still missing on a large share of mobile GPUs.
 * Each quantity owns a read/write pair because a pass cannot sample the target it
 * is rendering into; the pair is swapped after every pass.
 */
export class SimulationEngine {
  readonly size: number

  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly geometry = createFullscreenTriangle()
  private readonly quad: Mesh<BufferGeometry, ShaderMaterial>
  private readonly position: PingPong
  private readonly velocity: PingPong
  private readonly positionUniforms = createForceUniforms()
  private readonly velocityUniforms = {
    ...createForceUniforms(),
    uTime: { value: 0 },
    uTurbulence: { value: 1 },
    uForceVelocity: { value: vectors(() => new Vector3()) },
    uForceAxis: { value: vectors(() => new Vector3()) },
  }
  private readonly positionPass: ShaderMaterial
  private readonly velocityPass: ShaderMaterial
  private elapsed = 0

  constructor(renderer: WebGLRenderer, size = SIMULATION_SIZE) {
    this.renderer = renderer
    this.size = size

    this.position = { read: createStateTarget(size), write: createStateTarget(size) }
    this.velocity = { read: createStateTarget(size), write: createStateTarget(size) }
    this.positionPass = this.createPass(positionFragment, this.positionUniforms)
    this.velocityPass = this.createPass(`${curlNoise}\n${velocityFragment}`, this.velocityUniforms)

    this.quad = new Mesh(this.geometry, this.velocityPass)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)

    this.seed()
  }

  get positionTexture(): Texture {
    return this.position.read.texture
  }

  get velocityTexture(): Texture {
    return this.velocity.read.texture
  }

  step(delta: number, forces: ForceField, turbulence: number): void {
    const dt = Math.min(delta, MAX_TIME_STEP)
    this.elapsed += dt
    const previousTarget = this.renderer.getRenderTarget()

    const velocity = this.velocityUniforms
    this.bindState(velocity, dt, forces)
    velocity.uTime.value = this.elapsed
    velocity.uTurbulence.value = turbulence
    forces.points.forEach((point, index) => {
      velocity.uForceVelocity.value[index].copy(point.velocity)
      velocity.uForceAxis.value[index].copy(point.axis)
    })
    this.render(this.velocityPass, this.velocity)

    // Semi-implicit Euler: positions integrate the velocity computed this frame,
    // which keeps the tight pinch orbits stable at large time steps.
    this.bindState(this.positionUniforms, dt, forces)
    this.render(this.positionPass, this.position)

    this.renderer.setRenderTarget(previousTarget)
  }

  dispose(): void {
    for (const pair of [this.position, this.velocity]) {
      pair.read.dispose()
      pair.write.dispose()
    }
    this.velocityPass.dispose()
    this.positionPass.dispose()
    this.geometry.dispose()
    this.scene.clear()
  }

  private bindState(
    uniforms: ReturnType<typeof createForceUniforms>,
    dt: number,
    forces: ForceField,
  ): void {
    uniforms.uPosition.value = this.position.read.texture
    uniforms.uVelocity.value = this.velocity.read.texture
    uniforms.uDelta.value = dt
    forces.points.forEach((point, index) => {
      uniforms.uForcePosition.value[index].copy(point.position)
      uniforms.uForceDrive.value[index].set(point.pinch, point.impulse)
    })
  }

  private createPass(fragmentShader: string, uniforms: Record<string, IUniform>): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: simulationVertex,
      fragmentShader,
      uniforms,
      defines: FORCE_DEFINES,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    })
  }

  private render(pass: ShaderMaterial, target: PingPong): void {
    this.quad.material = pass
    this.renderer.setRenderTarget(target.write)
    this.renderer.render(this.scene, this.camera)
    const written = target.write
    target.write = target.read
    target.read = written
  }

  private seed(): void {
    const seedState = createSeedState(this.size)
    const seedUniforms = { uSeed: { value: null as Texture | null } }
    const seedPass = this.createPass(seedFragment, seedUniforms)
    const previousTarget = this.renderer.getRenderTarget()

    for (const [texture, pair] of [
      [seedState.position, this.position],
      [seedState.velocity, this.velocity],
    ] as const) {
      seedUniforms.uSeed.value = texture
      this.render(seedPass, pair)
      texture.dispose()
    }

    this.renderer.setRenderTarget(previousTarget)
    seedPass.dispose()
  }
}
