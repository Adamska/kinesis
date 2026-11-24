import { useState } from 'react'
import { GestureIndicator } from '../GestureIndicator'
import { AudioControls } from './AudioControls'
import { DensitySwitch } from './DensitySwitch'
import { DockCell, DockToggle } from './DockCell'
import { LookControls } from './LookControls'
import { PaletteSwitch, TrackingPill, TurbulenceControl } from './PrimaryControls'
import { RecordToggle } from './RecordToggle'

const ROW = 'w-full flex-wrap justify-center sm:w-auto'

/**
 * Two rows: the controls used most sit on the bottom edge, the studio controls above
 * them. On narrow screens the studio row folds away behind a toggle so the dock does
 * not cover the cloud.
 */
export function ControlDock() {
  const [expanded, setExpanded] = useState(false)

  return (
    <nav
      aria-label="Simulation controls"
      className="pointer-events-auto flex w-full max-w-sm flex-col items-center pl-px pt-px text-[10px] uppercase tracking-[0.16em] sm:w-auto sm:max-w-full"
    >
      <div className={`${ROW} ${expanded ? 'flex' : 'hidden'} sm:flex`}>
        <DockCell>
          <LookControls />
        </DockCell>
        <DockCell label="Particles">
          <DensitySwitch />
        </DockCell>
        <DockCell label="Audio">
          <AudioControls />
        </DockCell>
        <DockCell label="Capture">
          <RecordToggle />
        </DockCell>
      </div>
      <div className={`${ROW} flex`}>
        <DockCell>
          <GestureIndicator />
        </DockCell>
        <DockCell>
          <PaletteSwitch />
        </DockCell>
        <DockCell>
          <TurbulenceControl />
        </DockCell>
        <DockCell>
          <TrackingPill />
        </DockCell>
        <DockCell className="sm:hidden">
          <DockToggle
            label={expanded ? 'Fewer controls' : 'More controls'}
            pressed={expanded}
            onToggle={() => setExpanded((open) => !open)}
          />
        </DockCell>
      </div>
    </nav>
  )
}
