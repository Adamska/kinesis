import { create } from 'zustand'
import { DEFAULT_PALETTE, type PaletteId } from '../config/palettes'
import { createForcePoint, FORCE_POINT_COUNT, type ForceField } from '../gpgpu/forceField'
import { LANDMARK_COUNT } from '../vision/handTopology'
import type { TrackerStage } from '../vision/HandTracker'

export type InputSource = 'autonomous' | 'pointer' | 'tracking'
export type Gesture = 'flow' | 'pinch' | 'shockwave'
export type VisionStatus = 'idle' | 'loading' | 'active' | 'denied' | 'unavailable'

export interface TrackedHand {
  visible: boolean
  seenAt: number
  /** Mirrored normalized device coordinates of the palm center, each in [-1, 1]. */
  x: number
  y: number
  /** Apparent hand size mapped to [-1, 1]; positive means closer to the camera. */
  depth: number
  pinch: number
  burstPending: boolean
  /** Interleaved xy image coordinates of the 21 landmarks, each in [0, 1]. */
  landmarks: Float32Array
  /** Width over height of the camera frame the landmarks refer to. */
  aspect: number
}

export interface Telemetry {
  fps: number
  inferenceMs: number
  downloadedBytes: number
  source: InputSource
  gesture: Gesture
}

export interface SimulationBridge extends ForceField {
  hand: TrackedHand
  telemetry: Telemetry
}

/**
 * Mutable per-frame state shared between the vision loop, the render loop and the HUD.
 * It lives outside React on purpose: writers mutate it in place and readers poll it,
 * so nothing on the hot path ever schedules a render.
 */
export const simulationBridge: SimulationBridge = {
  points: Array.from({ length: FORCE_POINT_COUNT }, (_, index) => createForcePoint(index)),
  hand: {
    visible: false,
    seenAt: 0,
    x: 0,
    y: 0,
    depth: 0,
    pinch: 0,
    burstPending: false,
    landmarks: new Float32Array(LANDMARK_COUNT * 2),
    aspect: 4 / 3,
  },
  telemetry: { fps: 0, inferenceMs: 0, downloadedBytes: 0, source: 'autonomous', gesture: 'flow' },
}

export const TURBULENCE_RANGE = { min: 0.2, max: 2.5, step: 0.05 } as const

interface SimulationStore {
  palette: PaletteId
  turbulence: number
  vision: VisionStatus
  visionStage: TrackerStage
  setPalette: (palette: PaletteId) => void
  setTurbulence: (turbulence: number) => void
  setVision: (vision: VisionStatus) => void
  setVisionStage: (visionStage: TrackerStage) => void
}

export const useSimulationStore = create<SimulationStore>()((set) => ({
  palette: DEFAULT_PALETTE,
  turbulence: 1,
  vision: 'idle',
  visionStage: 'permission',
  setPalette: (palette) => set({ palette }),
  setTurbulence: (turbulence) => set({ turbulence }),
  setVision: (vision) => set({ vision }),
  setVisionStage: (visionStage) => set({ visionStage }),
}))
