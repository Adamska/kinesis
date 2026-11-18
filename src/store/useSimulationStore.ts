import { Vector3 } from 'three'
import { create } from 'zustand'
import { DEFAULT_PALETTE, type PaletteId } from '../config/palettes'
import type { ForceField } from '../gpgpu/SimulationEngine'

export type InputSource = 'autonomous' | 'pointer'
export type Gesture = 'flow' | 'pinch' | 'shockwave'

export interface Telemetry {
  fps: number
  source: InputSource
  gesture: Gesture
}

export interface SimulationBridge extends ForceField {
  telemetry: Telemetry
}

/**
 * Mutable per-frame state shared between the input sources, the render loop and the
 * HUD. It lives outside React on purpose: writers mutate it in place and readers poll
 * it, so nothing on the hot path ever schedules a render.
 */
export const simulationBridge: SimulationBridge = {
  handPos: new Vector3(),
  handVelocity: new Vector3(),
  pinchStrength: 0,
  shockwaveImpulse: 0,
  telemetry: { fps: 0, source: 'autonomous', gesture: 'flow' },
}

export const TURBULENCE_RANGE = { min: 0.2, max: 2.5, step: 0.05 } as const

interface SimulationStore {
  palette: PaletteId
  turbulence: number
  setPalette: (palette: PaletteId) => void
  setTurbulence: (turbulence: number) => void
}

export const useSimulationStore = create<SimulationStore>()((set) => ({
  palette: DEFAULT_PALETTE,
  turbulence: 1,
  setPalette: (palette) => set({ palette }),
  setTurbulence: (turbulence) => set({ turbulence }),
}))
