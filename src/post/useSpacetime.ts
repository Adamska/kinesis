import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Vector3 } from 'three'
import { simulationBridge } from '../store/useSimulationStore'
import { SpacetimePass } from './SpacetimePass'

// World-space radius of the Einstein ring at full pinch.
const LENS_RADIUS = 0.34
// Must match SHOCK_REACH in velocity.frag so the ripple rides the actual blast front.
const SHOCK_REACH = 2.2
const ACTIVE_THRESHOLD = 0.01

const projected = new Vector3()
const viewSpace = new Vector3()

/**
 * Owns the spacetime pass and feeds it each force point projected to the screen.
 * A world radius r at view depth z spans r * P11 / (2 z) of the screen height.
 */
export function useSpacetime(): SpacetimePass {
  const pass = useMemo(() => new SpacetimePass(), [])
  useEffect(() => () => pass.dispose(), [pass])

  useFrame(({ camera }) => {
    const scale = camera.projectionMatrix.elements[5] / 2
    let active = false
    simulationBridge.points.forEach((point, index) => {
      projected.copy(point.position).project(camera)
      const depth = Math.max(-viewSpace.copy(point.position).applyMatrix4(camera.matrixWorldInverse).z, 0.1)
      const x = projected.x * 0.5 + 0.5
      const y = projected.y * 0.5 + 0.5
      const pixelsPerUnit = scale / depth

      pass.lens[index].set(x, y, LENS_RADIUS * point.pinch * pixelsPerUnit, point.pinch * point.pinch)
      const front = (1 - point.impulse) * SHOCK_REACH * pixelsPerUnit
      pass.ripple[index].set(x, y, front, point.impulse)
      active ||= point.pinch > ACTIVE_THRESHOLD || point.impulse > ACTIVE_THRESHOLD
    })
    pass.enabled = active
  })

  return pass
}
