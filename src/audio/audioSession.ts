import { simulationBridge, useSimulationStore } from '../store/useSimulationStore'
import type { MicListener } from './MicListener'
import type { SoundEngine } from './SoundEngine'

const UPDATE_INTERVAL_MS = 1000 / 30

let engine: SoundEngine | null = null
let mic: MicListener | null = null
let timer = 0
let lastTick = 0

/**
 * Audio runs on its own 30 Hz timer, reading the simulation bridge like the HUD does;
 * nothing here touches the render loop. Both modules load on demand.
 */
function tick(): void {
  const now = performance.now()
  const delta = Math.min((now - lastTick) / 1000, 0.1)
  lastTick = now

  if (engine) {
    let speed = 0
    let pinch = 0
    let impulse = 0
    let pan = 0
    for (const point of simulationBridge.points) {
      const pointSpeed = point.velocity.length()
      if (pointSpeed >= speed) pan = point.position.x / 2
      speed = Math.max(speed, pointSpeed)
      pinch = Math.max(pinch, point.pinch)
      impulse = Math.max(impulse, point.impulse)
    }
    engine.update({ speed, pinch, impulse, pan, turbulence: useSimulationStore.getState().turbulence })
  }

  if (mic) {
    if (mic.sample(delta, now)) simulationBridge.burstRequested = true
    simulationBridge.audioLevel = mic.level
  } else simulationBridge.audioLevel = 0
}

function syncTimer(): void {
  const running = engine !== null || mic !== null
  if (running && !timer) {
    lastTick = performance.now()
    timer = window.setInterval(tick, UPDATE_INTERVAL_MS)
  } else if (!running && timer) {
    window.clearInterval(timer)
    timer = 0
    simulationBridge.audioLevel = 0
  }
}

export async function toggleSound(): Promise<void> {
  const { setSound } = useSimulationStore.getState()
  if (engine) {
    const closing = engine
    engine = null
    setSound(false)
    syncTimer()
    await closing.dispose()
    return
  }
  const { SoundEngine } = await import('./SoundEngine')
  engine = new SoundEngine()
  setSound(true)
  syncTimer()
}

export async function toggleMic(): Promise<void> {
  const { setMic } = useSimulationStore.getState()
  if (mic) {
    mic.dispose()
    mic = null
    setMic('off')
    syncTimer()
    return
  }
  setMic('starting')
  try {
    const { MicListener } = await import('./MicListener')
    mic = await MicListener.open()
    setMic('on')
    syncTimer()
  } catch {
    setMic('denied')
  }
}

/** Silences everything while the tab is hidden and resumes on return. */
export function bindAudioVisibility(): () => void {
  const onChange = () => {
    if (!engine) return
    if (document.hidden) void engine.context.suspend()
    else void engine.context.resume()
  }
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

export function shutdownAudio(): void {
  void engine?.dispose()
  engine = null
  mic?.dispose()
  mic = null
  syncTimer()
}
