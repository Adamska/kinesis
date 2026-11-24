import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useEffect, useMemo } from 'react'
import { HalfFloatType } from 'three'
import { TrailPass } from '../post/TrailPass'
import { useSpacetime } from '../post/useSpacetime'
import { useSimulationStore } from '../store/useSimulationStore'

function useTrails(): TrailPass {
  const trails = useSimulationStore((state) => state.trails)
  const pass = useMemo(() => new TrailPass(), [])
  useEffect(() => () => pass.dispose(), [pass])
  useEffect(() => {
    pass.enabled = trails
    pass.reset()
  }, [pass, trails])
  return pass
}

/**
 * Particles write unclamped radiance into a half-float buffer. Trails accumulate first,
 * then lensing bends the result so the glow follows the bent light. Only fragments whose
 * luminance exceeds 1.0 feed the bloom, so the glow is selective: dense or energetic
 * regions bleed light while the resting cloud stays crisp.
 */
export function PostProcessingStack() {
  const trails = useTrails()
  const spacetime = useSpacetime()

  return (
    <EffectComposer multisampling={0} frameBufferType={HalfFloatType}>
      <primitive object={trails} />
      <primitive object={spacetime} />
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.15} intensity={0.55} radius={0.7} />
      <Vignette offset={0.3} darkness={0.65} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
