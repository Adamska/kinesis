import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { REDUCED_MOTION } from '../config/motion'
import { DeviceTilt } from '../input/DeviceTilt'

const ORBIT_DISTANCE = 5
const PORTRAIT_FIT = 0.85
const SWAY = REDUCED_MOTION ? 0 : 1
const AZIMUTH_SWAY = 0.45 * SWAY
const ELEVATION_SWAY = 0.12 * SWAY
const TILT_AZIMUTH = 0.5
const TILT_ELEVATION = 0.3

/**
 * Slow orbital sway that reveals the depth of the volume without stealing the pointer.
 * On handheld devices, tilting the screen adds parallax on top of the sway.
 */
export function CameraRig() {
  const elapsed = useRef(0)
  const tilt = useMemo(() => new DeviceTilt(), [])

  useEffect(() => {
    const handheld = window.matchMedia('(pointer: coarse)').matches
    if (!handheld || REDUCED_MOTION) return
    return tilt.attach()
  }, [tilt])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    elapsed.current += dt
    tilt.update(dt)
    // Narrow viewports pull the camera back so the cloud keeps fitting horizontally.
    const distance = ORBIT_DISTANCE * Math.max(1, PORTRAIT_FIT / state.viewport.aspect)
    const azimuth = AZIMUTH_SWAY * Math.sin(elapsed.current * 0.07) + TILT_AZIMUTH * tilt.x
    const elevation = ELEVATION_SWAY * Math.sin(elapsed.current * 0.05 + 1) + TILT_ELEVATION * tilt.y
    state.camera.position.set(
      distance * Math.sin(azimuth) * Math.cos(elevation),
      distance * Math.sin(elevation),
      distance * Math.cos(azimuth) * Math.cos(elevation),
    )
    state.camera.lookAt(0, 0, 0)
  }, -1)

  return null
}
