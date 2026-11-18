import { useSimulationStore } from '../../store/useSimulationStore'
import { ControlDock } from './ControlDock'
import { HandSkeletonPreview } from './HandSkeletonPreview'
import { InteractionGuide } from './InteractionGuide'
import { TelemetryOverlay } from './TelemetryOverlay'

export function Hud() {
  const tracking = useSimulationStore((state) => state.vision === 'active')

  return (
    <div className="hud-safe-area pointer-events-none absolute inset-0 flex flex-col justify-between select-none">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <TelemetryOverlay />
        <div className="flex flex-col gap-3 sm:items-end">
          {tracking && <HandSkeletonPreview />}
          <InteractionGuide />
        </div>
      </header>
      <footer className="flex justify-center">
        <ControlDock />
      </footer>
    </div>
  )
}
