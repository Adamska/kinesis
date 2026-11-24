/** Particle budgets as square state grids; the count is the grid size squared. */
export const DENSITIES = {
  '64k': { size: 256, label: '64K' },
  '102k': { size: 320, label: '102K' },
  '262k': { size: 512, label: '262K' },
  '1m': { size: 1024, label: '1M' },
} as const

export type DensityId = keyof typeof DENSITIES
export const DENSITY_IDS = Object.keys(DENSITIES) as DensityId[]

/** Brightness and size are tuned at this count; other budgets are normalized to it. */
export const REFERENCE_COUNT = 320 * 320

// Discrete desktop GPUs and Apple silicon comfortably run four times the reference.
const STRONG_GPU = /apple m\d|apple gpu|rtx|radeon (rx|pro)|arc a\d|geforce gtx 1[06-9]\d{2}/i

/**
 * Picks a starting budget from the reported GPU. The million-particle grid is never
 * chosen automatically: it is an opt-in for machines known to handle it.
 */
export function detectDensity(): DensityId {
  if (window.matchMedia('(pointer: coarse)').matches) return '64k'
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) return '64k'
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  if (/swiftshader|llvmpipe|software/i.test(renderer)) return '64k'
  return STRONG_GPU.test(renderer) ? '262k' : '102k'
}

export function isDensity(value: string | null): value is DensityId {
  return DENSITY_IDS.some((id) => id === value)
}
