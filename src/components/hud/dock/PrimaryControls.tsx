import { PALETTE_IDS, PALETTES, paletteGradient } from '../../../config/palettes'
import { TURBULENCE_RANGE } from '../../../config/settings'
import { useSimulationStore, type VisionStatus } from '../../../store/useSimulationStore'
import { preloadTracking, toggleTracking } from '../../../vision/trackingSession'
import { OptionGroup } from './DockCell'

const VISION_LABELS: Record<VisionStatus, string> = {
  idle: 'Enable webcam tracking',
  loading: 'Initializing vision',
  active: 'Disable webcam tracking',
  denied: 'Camera access denied',
  unavailable: 'Tracking unavailable',
}

const PALETTE_OPTIONS = PALETTE_IDS.map((id) => ({
  id,
  label: PALETTES[id].shortLabel,
  title: PALETTES[id].label,
  accent: paletteGradient(PALETTES[id]),
}))

export function PaletteSwitch() {
  const palette = useSimulationStore((state) => state.palette)
  const setPalette = useSimulationStore((state) => state.setPalette)
  return <OptionGroup label="Color palette" options={PALETTE_OPTIONS} value={palette} onChange={setPalette} />
}

export function TurbulenceControl() {
  const turbulence = useSimulationStore((state) => state.turbulence)
  const setTurbulence = useSimulationStore((state) => state.setTurbulence)

  return (
    <label className="flex items-center gap-3">
      <span className="text-white/40">Turbulence</span>
      <input
        type="range"
        className="hud-slider w-24"
        min={TURBULENCE_RANGE.min}
        max={TURBULENCE_RANGE.max}
        step={TURBULENCE_RANGE.step}
        value={turbulence}
        onChange={(event) => setTurbulence(event.target.valueAsNumber)}
      />
      <span className="w-8 text-right text-white/85 tabular-nums">{turbulence.toFixed(2)}</span>
    </label>
  )
}

export function TrackingPill() {
  const vision = useSimulationStore((state) => state.vision)
  const engaged = vision === 'active' || vision === 'loading'

  return (
    <button
      type="button"
      aria-pressed={vision === 'active'}
      onClick={toggleTracking}
      // Intent to click is a good moment to start the model download.
      onPointerEnter={() => void preloadTracking()}
      onFocus={() => void preloadTracking()}
      className={`flex h-7 cursor-pointer items-center gap-2 rounded-full border px-3.5 uppercase transition-colors duration-200 ${
        engaged
          ? 'border-signal/60 text-signal hover:border-signal'
          : 'border-white/25 text-white/75 hover:border-white/60 hover:text-white'
      }`}
    >
      {engaged && <span className={`size-1 rounded-full bg-signal ${vision === 'loading' ? 'animate-pulse' : ''}`} />}
      <span className="text-white/35">[</span>
      {VISION_LABELS[vision]}
      <span className="text-white/35">]</span>
    </button>
  )
}
