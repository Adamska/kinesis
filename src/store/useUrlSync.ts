import { useEffect } from 'react'
import { writeUrlSettings } from './urlSettings'
import { useSimulationStore } from './useSimulationStore'

const WRITE_DELAY_MS = 250

/** Mirrors shared settings into the address bar, debounced so slider drags stay cheap. */
export function useUrlSync(): void {
  useEffect(() => {
    let timer = 0
    const unsubscribe = useSimulationStore.subscribe((state, previous) => {
      if (state.palette === previous.palette && state.turbulence === previous.turbulence) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => writeUrlSettings(state), WRITE_DELAY_MS)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])
}
