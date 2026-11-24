import { Pass } from 'postprocessing'
import { NoBlending, ShaderMaterial, Vector4, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import { FORCE_POINT_COUNT } from '../gpgpu/forceField'
import fullscreenVertex from '../shaders/fullscreen.vert?raw'
import spacetimeFragment from '../shaders/spacetime.frag?raw'

const vectors = () => Array.from({ length: FORCE_POINT_COUNT }, () => new Vector4())

/**
 * Screen-space gravitational lensing around each pinch well and refraction along each
 * shockwave front. It runs before the bloom, so the glow follows the bent light. The
 * pass disables itself while nothing is pinched or blasting.
 */
export class SpacetimePass extends Pass {
  readonly lens = vectors()
  readonly ripple = vectors()

  private readonly material: ShaderMaterial

  constructor() {
    super('SpacetimePass')
    this.material = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: spacetimeFragment,
      defines: { FORCE_COUNT: FORCE_POINT_COUNT },
      uniforms: {
        inputBuffer: { value: null as Texture | null },
        uLens: { value: this.lens },
        uRipple: { value: this.ripple },
        uAspect: { value: 1 },
      },
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    })
    this.fullscreenMaterial = this.material
  }

  override setSize(width: number, height: number): void {
    this.material.uniforms.uAspect.value = width / Math.max(height, 1)
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, outputBuffer: WebGLRenderTarget): void {
    this.material.uniforms.inputBuffer.value = inputBuffer.texture
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)
  }

  override dispose(): void {
    this.material.dispose()
    super.dispose()
  }
}
