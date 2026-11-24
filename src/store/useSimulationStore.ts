import { Vector3 } from 'three'
import { create } from 'zustand'
import { DEFAULT_PALETTE, type PaletteId } from '../config/palettes'
import { createForcePoint, FORCE_POINT_COUNT, type ForceField } from '../gpgpu/forceField'
import { LANDMARK_COUNT, LANDMARK_STRIDE, MAX_HANDS } from '../vision/handTopology'
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
  /** Filtered velocity of x and y in units per second, used to extrapolate past latency. */
  vx: number
  vy: number
  /** Apparent hand size mapped to [-1, 1]; positive means closer to the camera. */
  depth: number
  pinch: number
  burstPending: boolean
  /** Palm normal in view space (x right, y up, z toward the viewer), mirrored like x. */
  palmNormal: Vector3
  /** Interleaved xyz of the 21 landmarks: x and y in [0, 1] image space, z relative depth. */
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
  hands: TrackedHand[]
  telemetry: Telemetry
}

/**
 * Mutable per-frame state shared between the vision loop, the render loop and the HUD.
 * It lives outside React on purpose: writers mutate it in place and readers poll it,
 * so nothing on the hot path ever schedules a render.
 */
export const simulationBridge: SimulationBridge = {
  points: Array.from({ length: FORCE_POINT_COUNT }, (_, index) => createForcePoint(index)),
  hands: Array.from({ length: MAX_HANDS }, () => ({
    visible: false,
    seenAt: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    depth: 0,
    pinch: 0,
    burstPending: false,
    palmNormal: new Vector3(0, 0, 1),
    landmarks: new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE),
    aspect: 4 / 3,
  })),
  telemetry: { fps: 0, inferenceMs: 0, downloadedBytes: 0, source: 'autonomous', gesture: 'flow' },
}

export const TURBULENCE_RANGE = { min: 0.2, max: 2.5, step: 0.05 } as const

interface SimulationStore {
  palette: PaletteId
  turbulence: number
  vision: VisionStatus
  visionStage: TrackerStage
  showFeed: boolean
  setPalette: (palette: PaletteId) => void
  setTurbulence: (turbulence: number) => void
  setVision: (vision: VisionStatus) => void
  setVisionStage: (visionStage: TrackerStage) => void
  toggleFeed: () => void
}

export const useSimulationStore = create<SimulationStore>()((set) => ({
  palette: DEFAULT_PALETTE,
  turbulence: 1,
  vision: 'idle',
  visionStage: 'permission',
  showFeed: true,
  setPalette: (palette) => set({ palette }),
  setTurbulence: (turbulence) => set({ turbulence }),
  setVision: (vision) => set({ vision }),
  setVisionStage: (visionStage) => set({ visionStage }),
  toggleFeed: () => set((state) => ({ showFeed: !state.showFeed })),
}))
