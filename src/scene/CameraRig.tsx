import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'

const ORBIT_DISTANCE = 5
const PORTRAIT_FIT = 0.85
const AZIMUTH_SWAY = 0.45
const ELEVATION_SWAY = 0.12

/** Slow orbital sway that reveals the depth of the volume without stealing the pointer. */
export function CameraRig() {
  const elapsed = useRef(0)

  useFrame((state, delta) => {
    elapsed.current += Math.min(delta, 0.1)
    // Narrow viewports pull the camera back so the cloud keeps fitting horizontally.
    const distance = ORBIT_DISTANCE * Math.max(1, PORTRAIT_FIT / state.viewport.aspect)
    const azimuth = AZIMUTH_SWAY * Math.sin(elapsed.current * 0.07)
    const elevation = ELEVATION_SWAY * Math.sin(elapsed.current * 0.05 + 1)
    state.camera.position.set(
      distance * Math.sin(azimuth) * Math.cos(elevation),
      distance * Math.sin(elevation),
      distance * Math.cos(azimuth) * Math.cos(elevation),
    )
    state.camera.lookAt(0, 0, 0)
  }, -1)

  return null
}
