import { useEffect, useState } from 'react'
import { useSimulationStore } from '../../store/useSimulationStore'
import { ControlDock } from './dock/ControlDock'
import { HandSkeletonPreview } from './HandSkeletonPreview'
import { InteractionGuide } from './InteractionGuide'
import { ShortcutSheet } from './ShortcutSheet'
import { TelemetryOverlay } from './TelemetryOverlay'
import { VisionStatusPanel } from './VisionStatusPanel'

const ZEN_HINT_MS = 2400

/** Brief reminder of the way back, shown when the interface is hidden. */
function ZenHint({ zen }: { zen: boolean }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!zen) return
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), ZEN_HINT_MS)
    return () => {
      window.clearTimeout(timer)
      setVisible(false)
    }
  }, [zen])

  return (
    <p
      aria-live="polite"
      className={`absolute bottom-6 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.16em] text-white/50 transition-opacity duration-700 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      Press H to show the interface
    </p>
  )
}

export function Hud() {
  const tracking = useSimulationStore((state) => state.vision === 'active')
  const zen = useSimulationStore((state) => state.zen)
  const chrome = `transition-[opacity,visibility] duration-500 ${zen ? 'invisible opacity-0' : 'visible opacity-100'}`

  return (
    <div className="hud-safe-area pointer-events-none absolute inset-0 flex flex-col justify-between select-none">
      <header className={`flex flex-col items-start gap-3 sm:flex-row sm:justify-between ${chrome}`}>
        <TelemetryOverlay />
        <div className="flex flex-col gap-3 sm:items-end">
          {tracking && <HandSkeletonPreview />}
          <InteractionGuide />
        </div>
      </header>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <VisionStatusPanel />
        <ShortcutSheet />
      </div>
      <footer className={`flex justify-center ${chrome}`}>
        <ControlDock />
      </footer>
      <ZenHint zen={zen} />
    </div>
  )
}
