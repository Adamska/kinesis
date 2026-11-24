import { Vector3 } from 'three'
import { create } from 'zustand'
import type { DensityId } from '../config/density'
import { REDUCED_MOTION } from '../config/motion'
import type { PaletteId } from '../config/palettes'
import { createForcePoint, FORCE_POINT_COUNT, type ForceField } from '../gpgpu/forceField'
import type { ShapeId } from '../gpgpu/shapeTargets'
import { LANDMARK_COUNT, LANDMARK_STRIDE, MAX_HANDS } from '../vision/handTopology'
import type { TrackerStage } from '../vision/HandTracker'
import { readUrlSettings } from './urlSettings'

export type InputSource = 'autonomous' | 'pointer' | 'tracking'
export type Gesture = 'flow' | 'pinch' | 'shockwave'
export type VisionStatus = 'idle' | 'loading' | 'active' | 'denied' | 'unavailable'
export type MicStatus = 'off' | 'starting' | 'on' | 'denied'

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
  /** Set by the keyboard or a sound onset to fire a shockwave from every active point. */
  burstRequested: boolean
  /** Microphone envelope in [0, 1], 0 while the microphone is off. */
  audioLevel: number
  telemetry: Telemetry
}

/**
 * Mutable per-frame state shared between the vision loop, the render loop and the HUD.
 * It lives outside React on purpose: writers mutate it in place and readers poll it,
 * so nothing on the hot path ever schedules a render.
 */
export const simulationBridge: SimulationBridge = {
  points: Array.from({ length: FORCE_POINT_COUNT }, (_, index) => createForcePoint(index)),
  burstRequested: false,
  audioLevel: 0,
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

interface SimulationStore {
  palette: PaletteId
  turbulence: number
  shape: ShapeId
  density: DensityId
  vision: VisionStatus
  visionStage: TrackerStage
  showFeed: boolean
  zen: boolean
  shortcutsOpen: boolean
  sound: boolean
  mic: MicStatus
  trails: boolean
  setPalette: (palette: PaletteId) => void
  setTurbulence: (turbulence: number) => void
  setShape: (shape: ShapeId) => void
  setDensity: (density: DensityId) => void
  setVision: (vision: VisionStatus) => void
  setVisionStage: (visionStage: TrackerStage) => void
  toggleFeed: () => void
  toggleZen: () => void
  setShortcutsOpen: (open: boolean) => void
  setSound: (sound: boolean) => void
  setMic: (mic: MicStatus) => void
  toggleTrails: () => void
}

export const useSimulationStore = create<SimulationStore>()((set) => ({
  ...readUrlSettings(),
  vision: 'idle',
  visionStage: 'permission',
  showFeed: true,
  zen: false,
  shortcutsOpen: false,
  sound: false,
  mic: 'off',
  trails: !REDUCED_MOTION,
  setPalette: (palette) => set({ palette }),
  setTurbulence: (turbulence) => set({ turbulence }),
  setShape: (shape) => set({ shape }),
  setDensity: (density) => set({ density }),
  setVision: (vision) => set({ vision }),
  setVisionStage: (visionStage) => set({ visionStage }),
  toggleFeed: () => set((state) => ({ showFeed: !state.showFeed })),
  toggleZen: () => set((state) => ({ zen: !state.zen })),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setSound: (sound) => set({ sound }),
  setMic: (mic) => set({ mic }),
  toggleTrails: () => set((state) => ({ trails: !state.trails })),
}))
