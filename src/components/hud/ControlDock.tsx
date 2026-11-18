import type { ReactNode } from 'react'
import { PALETTE_IDS, PALETTES, paletteGradient } from '../../config/palettes'
import { TURBULENCE_RANGE, useSimulationStore, type VisionStatus } from '../../store/useSimulationStore'
import { toggleTracking } from '../../vision/trackingSession'
import { GestureIndicator } from './GestureIndicator'

const VISION_LABELS: Record<VisionStatus, string> = {
  idle: 'Enable webcam tracking',
  loading: 'Initializing vision',
  active: 'Disable webcam tracking',
  denied: 'Camera access denied',
  unavailable: 'Tracking unavailable',
}

function Cell({ children }: { children: ReactNode }) {
  return (
    <div className="-ml-px -mt-px flex h-11 w-full items-center justify-center gap-3 border border-hairline bg-void/65 px-4 backdrop-blur-md sm:w-auto">
      {children}
    </div>
  )
}

function PaletteSwitch() {
  const palette = useSimulationStore((state) => state.palette)
  const setPalette = useSimulationStore((state) => state.setPalette)

  return (
    <div role="radiogroup" aria-label="Color palette" className="flex items-center gap-4">
      {PALETTE_IDS.map((id) => {
        const selected = id === palette
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={PALETTES[id].label}
            onClick={() => setPalette(id)}
            className={`flex cursor-pointer flex-col gap-1 uppercase transition-colors duration-200 ${
              selected ? 'text-white' : 'text-white/40 hover:text-white/75'
            }`}
          >
            {PALETTES[id].shortLabel}
            <span
              className={`h-px w-full transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-35'}`}
              style={{ background: paletteGradient(PALETTES[id]) }}
            />
          </button>
        )
      })}
    </div>
  )
}

function TurbulenceControl() {
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

function TrackingPill() {
  const vision = useSimulationStore((state) => state.vision)
  const engaged = vision === 'active' || vision === 'loading'

  return (
    <button
      type="button"
      aria-pressed={vision === 'active'}
      onClick={toggleTracking}
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

export function ControlDock() {
  return (
    <nav
      aria-label="Simulation controls"
      className="pointer-events-auto flex w-full max-w-sm flex-wrap justify-center pl-px pt-px text-[10px] uppercase tracking-[0.16em] sm:w-auto sm:max-w-full"
    >
      <Cell>
        <GestureIndicator />
      </Cell>
      <Cell>
        <PaletteSwitch />
      </Cell>
      <Cell>
        <TurbulenceControl />
      </Cell>
      <Cell>
        <TrackingPill />
      </Cell>
    </nav>
  )
}
