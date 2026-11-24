import { useEffect } from 'react'
import { toggleMic, toggleSound } from '../audio/audioSession'
import { toggleRecording } from '../capture/clipRecorder'
import { PALETTE_IDS } from '../config/palettes'
import { clampTurbulence } from '../config/settings'
import { simulationBridge, useSimulationStore } from '../store/useSimulationStore'
import { toggleSilhouette, toggleTracking } from '../vision/trackingSession'

export interface Shortcut {
  keys: readonly string[]
  /** How the keys are printed on the shortcut sheet. */
  label: string
  action: string
  run: (key: string) => void
}

const TURBULENCE_STEP = 0.1

function nudgeTurbulence(direction: number): void {
  const { turbulence, setTurbulence } = useSimulationStore.getState()
  setTurbulence(Math.round(clampTurbulence(turbulence + direction * TURBULENCE_STEP) * 100) / 100)
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.().catch(() => undefined)
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    keys: PALETTE_IDS.map((_, index) => String(index + 1)),
    label: `1 - ${PALETTE_IDS.length}`,
    action: 'Palette',
    run: (key) => useSimulationStore.getState().setPalette(PALETTE_IDS[Number(key) - 1]),
  },
  { keys: [' '], label: 'Space', action: 'Shockwave', run: () => (simulationBridge.burstRequested = true) },
  { keys: ['[', ']'], label: '[ ]', action: 'Turbulence', run: (key) => nudgeTurbulence(key === ']' ? 1 : -1) },
  { keys: ['t'], label: 'T', action: 'Light trails', run: () => useSimulationStore.getState().toggleTrails() },
  { keys: ['a'], label: 'A', action: 'Sound', run: () => void toggleSound() },
  { keys: ['m'], label: 'M', action: 'Microphone', run: () => void toggleMic() },
  { keys: ['r'], label: 'R', action: 'Record clip', run: toggleRecording },
  { keys: ['w'], label: 'W', action: 'Webcam tracking', run: toggleTracking },
  { keys: ['b'], label: 'B', action: 'Body silhouette', run: () => void toggleSilhouette() },
  { keys: ['h'], label: 'H', action: 'Hide interface', run: () => useSimulationStore.getState().toggleZen() },
  { keys: ['f'], label: 'F', action: 'Fullscreen', run: toggleFullscreen },
  {
    keys: ['?'],
    label: '?',
    action: 'Shortcuts',
    run: () => {
      const { shortcutsOpen, setShortcutsOpen } = useSimulationStore.getState()
      setShortcutsOpen(!shortcutsOpen)
    },
  },
]

const bindings = new Map(SHORTCUTS.flatMap((shortcut) => shortcut.keys.map((key) => [key, shortcut] as const)))

/** Global keyboard bindings. Typing in a form control or pressing a chord is left alone. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select')) return
      // Space on a focused button already means "press this button".
      if (event.key === ' ' && target?.closest('button')) return

      if (event.key === 'Escape') {
        useSimulationStore.getState().setShortcutsOpen(false)
        return
      }
      const shortcut = bindings.get(event.key.toLowerCase())
      if (!shortcut) return
      event.preventDefault()
      shortcut.run(event.key.toLowerCase())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
