import { useEffect } from 'react'
import { introRequested } from './urlSettings'
import { useSimulationStore } from './useSimulationStore'

const INTRO_HOLD_MS = 4200

/**
 * The page opens with the particles spelling the title, then lets them dissolve into
 * the free flow. Choosing a shape before then takes over and ends the intro.
 */
export function useIntro(): void {
  useEffect(() => {
    if (!introRequested()) return
    const timer = window.setTimeout(() => {
      if (useSimulationStore.getState().shape === 'title') useSimulationStore.getState().setShape('fluid')
    }, INTRO_HOLD_MS)
    const unsubscribe = useSimulationStore.subscribe((state, previous) => {
      if (state.shape !== previous.shape) window.clearTimeout(timer)
    })
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [])
}
