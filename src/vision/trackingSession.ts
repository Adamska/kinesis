import { useSimulationStore, type VisionStatus } from '../store/useSimulationStore'
import type { HandTracker } from './HandTracker'
import type { LandmarkWorker } from './LandmarkWorker'

const IDLE_PRELOAD_DELAY_MS = 4000

interface NetworkInformation {
  saveData?: boolean
  effectiveType?: string
}

let tracker: HandTracker | null = null
let worker: Promise<LandmarkWorker> | null = null
let generation = 0

function classifyFailure(error: unknown): VisionStatus {
  const name = error instanceof DOMException ? error.name : ''
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable'
}

/**
 * Starts fetching and compiling the hand landmark model without touching the camera.
 * The vision code is imported on demand so it never weighs on the initial page load.
 * A failed load is forgotten, so the next attempt starts from scratch.
 */
export function preloadTracking(): Promise<LandmarkWorker> {
  worker ??= import('./LandmarkWorker').then(({ LandmarkWorker }) => {
    const instance = new LandmarkWorker()
    instance.ready.catch(() => {
      instance.terminate()
      worker = null
    })
    return instance
  })
  return worker
}

/**
 * Preloads during idle time, but only on connections that can absorb a 22 MB download
 * the visitor did not ask for. Browsers that do not report their connection are left
 * to the intent-based preload on the tracking control.
 */
export function schedulePreload(): () => void {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection
  if (!connection || connection.saveData || connection.effectiveType !== '4g') return () => undefined
  const timer = window.setTimeout(() => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => void preloadTracking())
    else void preloadTracking()
  }, IDLE_PRELOAD_DELAY_MS)
  return () => window.clearTimeout(timer)
}

/**
 * Starts webcam hand tracking. The generation counter invalidates a start that is
 * still pending when the session is stopped or restarted.
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
    const [{ HandTracker }, landmarks] = await Promise.all([import('./HandTracker'), preloadTracking()])
    const instance = new HandTracker(landmarks, {
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

/** Stops the camera. The loaded model stays warm so tracking restarts instantly. */
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

/**
 * Turns the body silhouette on or off. Segmentation loads its small model on first use
 * and only runs on frames the tracker sends, so it costs nothing without the camera.
 */
export async function toggleSilhouette(): Promise<void> {
  const { silhouette, setSilhouette } = useSimulationStore.getState()
  const landmarks = await preloadTracking()
  if (silhouette === 'on' || silhouette === 'loading') {
    landmarks.setSegmentation(false)
    setSilhouette('off')
    return
  }
  setSilhouette('loading')
  try {
    await landmarks.ready
  } catch {
    setSilhouette('unavailable')
    return
  }
  landmarks.setSegmentation(true, (available) => {
    if (useSimulationStore.getState().silhouette === 'loading') setSilhouette(available ? 'on' : 'unavailable')
  })
}

/** The live camera element while tracking runs, for previews. */
export function trackingVideo(): HTMLVideoElement | null {
  return tracker?.video ?? null
}

/** Releases the camera and the worker entirely, on application teardown. */
export function shutdownTracking(): void {
  disableTracking()
  void worker?.then((instance) => instance.terminate())
  worker = null
}
