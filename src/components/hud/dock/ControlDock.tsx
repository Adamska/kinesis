import { GestureIndicator } from '../GestureIndicator'
import { DockCell } from './DockCell'
import { FormSwitch } from './FormSwitch'
import { PaletteSwitch, TrackingPill, TurbulenceControl } from './PrimaryControls'

const ROW = 'flex w-full flex-wrap justify-center sm:w-auto'

export function ControlDock() {
  return (
    <nav
      aria-label="Simulation controls"
      className="pointer-events-auto flex w-full max-w-sm flex-col items-center pl-px pt-px text-[10px] uppercase tracking-[0.16em] sm:w-auto sm:max-w-full"
    >
      <div className={ROW}>
        <DockCell label="Form">
          <FormSwitch />
        </DockCell>
      </div>
      <div className={ROW}>
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
      </div>
    </nav>
  )
}
