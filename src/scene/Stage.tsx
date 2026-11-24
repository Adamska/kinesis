import { Canvas } from '@react-three/fiber'
import { registerCaptureCanvas } from '../capture/clipRecorder'
import { DENSITIES } from '../config/density'
import { useSimulationStore } from '../store/useSimulationStore'
import { AdaptiveResolution, MAX_PIXEL_RATIO } from './AdaptiveResolution'
import { CameraRig } from './CameraRig'
import { ForceReticles } from './ForceReticles'
import { ParticleField } from './ParticleField'
import { PostProcessingStack } from './PostProcessingStack'

const VOID_COLOR = '#050608'

export function Stage() {
  const { size } = DENSITIES[useSimulationStore((state) => state.density)]

  return (
    <Canvas
      role="img"
      aria-label="Particle fluid simulation. Move the pointer to stir it, hold to gather it, release to scatter it."
      flat
      dpr={[1, MAX_PIXEL_RATIO]}
      camera={{ position: [0, 0, 5], fov: 45, near: 0.1, far: 50 }}
      onCreated={({ gl }) => registerCaptureCanvas(gl.domElement)}
      gl={{ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={[VOID_COLOR]} />
      <CameraRig />
      {/* A new budget rebuilds the simulation from scratch, so the field is keyed by it. */}
      <ParticleField key={size} size={size} />
      <ForceReticles />
      <PostProcessingStack />
      <AdaptiveResolution />
    </Canvas>
  )
}
