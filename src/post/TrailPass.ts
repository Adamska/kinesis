import { CopyMaterial, Pass } from 'postprocessing'
import {
  HalfFloatType,
  NoBlending,
  ShaderMaterial,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three'
import fullscreenVertex from '../shaders/fullscreen.vert?raw'
import trailFragment from '../shaders/trail.frag?raw'

// Time for an afterglow to fade to 1/e of its brightness.
const AFTERGLOW_SECONDS = 0.07

const createHistory = () => new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })

/**
 * Feedback pass: each frame is the brighter of the new frame and a decayed copy of the
 * previous output. Decay is derived from the frame time so trails last as long at
 * 120 Hz as at 60 Hz.
 */
export class TrailPass extends Pass {
  private readonly blend: ShaderMaterial
  private readonly copy = new CopyMaterial()
  private history = createHistory()
  private output = createHistory()
  private primed = false

  constructor() {
    super('TrailPass')
    this.blend = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: trailFragment,
      uniforms: {
        inputBuffer: { value: null as Texture | null },
        uHistory: { value: null as Texture | null },
        uPersistence: { value: 0 },
      },
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    })
    this.fullscreenMaterial = this.blend
  }

  override setSize(width: number, height: number): void {
    this.history.setSize(width, height)
    this.output.setSize(width, height)
    this.primed = false
  }

  override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget,
    outputBuffer: WebGLRenderTarget,
    deltaTime = 1 / 60,
  ): void {
    const uniforms = this.blend.uniforms
    uniforms.inputBuffer.value = inputBuffer.texture
    uniforms.uHistory.value = this.history.texture
    uniforms.uPersistence.value = this.primed ? Math.exp(-Math.min(deltaTime, 0.1) / AFTERGLOW_SECONDS) : 0
    this.fullscreenMaterial = this.blend
    renderer.setRenderTarget(this.output)
    renderer.render(this.scene, this.camera)

    this.copy.inputBuffer = this.output.texture
    this.fullscreenMaterial = this.copy
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)

    const written = this.output
    this.output = this.history
    this.history = written
    this.primed = true
  }

  /** Forgets the accumulated trails, for instance after being re-enabled. */
  reset(): void {
    this.primed = false
  }

  override dispose(): void {
    this.blend.dispose()
    this.copy.dispose()
    this.history.dispose()
    this.output.dispose()
    super.dispose()
  }
}
