import { useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { EffectPass, ToneMappingMode, type EffectComposer as Composer } from 'postprocessing'
import { useEffect, useMemo, useRef } from 'react'
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
  const composer = useRef<Composer>(null)

  // The dark, palette-tinted backdrop is a very shallow gradient that bands at 8 bits.
  // Dithering after the final color conversion breaks the bands up. The composer
  // rebuilds its effect passes when its children change, so this is checked each frame.
  useFrame(() => {
    for (const pass of composer.current?.passes ?? []) {
      if (pass instanceof EffectPass && !pass.dithering) pass.dithering = true
    }
  })

  return (
    <EffectComposer ref={composer} multisampling={0} frameBufferType={HalfFloatType}>
      <primitive object={trails} />
      <primitive object={spacetime} />
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.15} intensity={0.55} radius={0.7} />
      <Vignette offset={0.3} darkness={0.65} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
