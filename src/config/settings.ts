export const TURBULENCE_RANGE = { min: 0.2, max: 2.5, step: 0.05 } as const
export const DEFAULT_TURBULENCE = 1

export function clampTurbulence(value: number): number {
  return Math.min(Math.max(value, TURBULENCE_RANGE.min), TURBULENCE_RANGE.max)
}
