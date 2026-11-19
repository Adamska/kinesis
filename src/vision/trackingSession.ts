import { useSimulationStore, type VisionStatus } from '../store/useSimulationStore'
import type { HandTracker } from './HandTracker'

let tracker: HandTracker | null = null
let generation = 0

function classifyFailure(error: unknown): VisionStatus {
  const name = error instanceof DOMException ? error.name : ''
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable'
}

/**
 * Starts webcam hand tracking. The tracker is imported on demand so the vision code
 * never weighs on the initial page load. The generation counter invalidates a start
 * that is still pending when the session is stopped or restarted.
 */
export async function enableTracking(): Promise<void> {
  const { vision, setVision, setVisionStage } = useSimulationStore.getState()
  if (vision === 'loading' || vision === 'active') return

  const token = ++generation
  const fail = (error: unknown) => {
    if (token !== generation) return
    tracker?.dispose()
    tracker = null
    setVision(classifyFailure(error))
  }

  setVision('loading')
  try {
    const { HandTracker } = await import('./HandTracker')
    const instance = new HandTracker({
      onStage: (stage) => token === generation && setVisionStage(stage),
      onFailure: fail,
    })
    await instance.start()
    if (token !== generation) {
      instance.dispose()
      return
    }
    tracker = instance
    setVision('active')
  } catch (error) {
    fail(error)
  }
}

export function disableTracking(): void {
  generation++
  tracker?.dispose()
  tracker = null
  useSimulationStore.getState().setVision('idle')
}

export function toggleTracking(): void {
  const { vision } = useSimulationStore.getState()
  if (vision === 'loading' || vision === 'active') disableTracking()
  else void enableTracking()
}
