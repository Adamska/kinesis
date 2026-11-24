import type { InputSource } from '../store/useSimulationStore'

export interface SourceProfile {
  /** Rate at which the force point follows its input, per second. */
  follow: number
  /** Rate at which the measured velocity is smoothed, per second. */
  velocity: number
  /** 1 when matter is carried along at the input's own velocity, 0 when it is pushed. */
  carry: number
}

// A tracked hand is already filtered and played back along a smooth path, so it is
// followed almost directly; the pointer and attractor keep their softer response.
export const PROFILES: Record<InputSource, SourceProfile> = {
  autonomous: { follow: 14, velocity: 10, carry: 0 },
  pointer: { follow: 14, velocity: 10, carry: 0 },
  tracking: { follow: 60, velocity: 22, carry: 1 },
}
