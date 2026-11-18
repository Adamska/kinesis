import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { HalfFloatType } from 'three'

/**
 * Particles write unclamped radiance into a half-float buffer. Only fragments whose
 * accumulated luminance exceeds 1.0 feed the bloom, so the glow is selective: dense or
 * energetic regions bleed light while the resting cloud stays crisp.
 */
export function PostProcessingStack() {
  return (
    <EffectComposer multisampling={0} frameBufferType={HalfFloatType}>
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.15} intensity={0.55} radius={0.7} />
      <Vignette offset={0.3} darkness={0.65} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
