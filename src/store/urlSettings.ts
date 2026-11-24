import { DEFAULT_PALETTE, PALETTE_IDS, type PaletteId } from '../config/palettes'
import { clampTurbulence, DEFAULT_TURBULENCE } from '../config/settings'

/** The part of the interface state that a shared link reproduces. */
export interface SharedSettings {
  palette: PaletteId
  turbulence: number
}

const isPalette = (value: string | null): value is PaletteId => PALETTE_IDS.some((id) => id === value)

/** Reads shared settings from the query string, ignoring anything malformed. */
export function readUrlSettings(): SharedSettings {
  const params = new URLSearchParams(window.location.search)
  const palette = params.get('palette')
  const turbulence = Number.parseFloat(params.get('turbulence') ?? '')
  return {
    palette: isPalette(palette) ? palette : DEFAULT_PALETTE,
    turbulence: Number.isFinite(turbulence) ? clampTurbulence(turbulence) : DEFAULT_TURBULENCE,
  }
}

/** Rewrites the query string in place; defaults are omitted to keep links short. */
export function writeUrlSettings({ palette, turbulence }: SharedSettings): void {
  const params = new URLSearchParams(window.location.search)
  const assign = (key: string, value: string, fallback: string) => {
    if (value === fallback) params.delete(key)
    else params.set(key, value)
  }
  assign('palette', palette, DEFAULT_PALETTE)
  assign('turbulence', turbulence.toFixed(2), DEFAULT_TURBULENCE.toFixed(2))
  const query = params.toString()
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', url)
  }
}
