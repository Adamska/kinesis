import { useEffect, useRef } from 'react'

/**
 * Runs a callback on a fixed interval, outside React's render cycle. HUD readouts use
 * it to poll the simulation bridge and write straight to the DOM.
 */
export function useTicker(tick: () => void, intervalMs: number): void {
  const latest = useRef(tick)

  useEffect(() => {
    latest.current = tick
  })

  useEffect(() => {
    latest.current()
    const id = window.setInterval(() => latest.current(), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
}
