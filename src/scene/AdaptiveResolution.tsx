import { PerformanceMonitor } from '@react-three/drei'
import { useThree } from '@react-three/fiber'

const MIN_PIXEL_RATIO = 0.75
export const MAX_PIXEL_RATIO = 2

/** Trades resolution for frame rate on fill-rate-bound GPUs; the particle count never drops. */
export function AdaptiveResolution() {
  const setDpr = useThree((state) => state.setDpr)
  const ceiling = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)

  return (
    <PerformanceMonitor
      factor={1}
      onChange={({ factor }) => {
        const ratio = MIN_PIXEL_RATIO + (ceiling - MIN_PIXEL_RATIO) * factor
        setDpr(Math.round(ratio * 4) / 4)
      }}
    />
  )
}
