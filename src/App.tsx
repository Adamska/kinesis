import { Canvas } from '@react-three/fiber'

const VOID_COLOR = '#050608'

export function App() {
  return (
    <main className="relative h-full w-full bg-void">
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ position: [0, 0, 6], fov: 45, near: 0.1, far: 50 }}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={[VOID_COLOR]} />
      </Canvas>
    </main>
  )
}
