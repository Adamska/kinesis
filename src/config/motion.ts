/**
 * Visitors who ask the system for reduced motion get a calmer field: gentler
 * turbulence, a still camera and no unprompted shockwaves. Read once at startup.
 */
export const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
