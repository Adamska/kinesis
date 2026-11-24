import { Canvas } from '@react-three/fiber'
import { AdaptiveResolution, MAX_PIXEL_RATIO } from './AdaptiveResolution'
import { CameraRig } from './CameraRig'
import { ForceReticles } from './ForceReticles'
import { ParticleField } from './ParticleField'
import { PostProcessingStack } from './PostProcessingStack'

const VOID_COLOR = '#050608'

export function Stage() {
  return (
    <Canvas
      role="img"
      aria-label="Particle fluid simulation. Move the pointer to stir it, hold to gather it, release to scatter it."
      flat
      dpr={[1, MAX_PIXEL_RATIO]}
      camera={{ position: [0, 0, 5], fov: 45, near: 0.1, far: 50 }}
      gl={{ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={[VOID_COLOR]} />
      <CameraRig />
      <ParticleField />
      <ForceReticles />
      <PostProcessingStack />
      <AdaptiveResolution />
    </Canvas>
  )
}
