export type Triplet = readonly [number, number, number]

export interface CosinePalette {
  label: string
  shortLabel: string
  a: Triplet
  b: Triplet
  c: Triplet
  d: Triplet
}

/** Coefficients for color(t) = a + b * cos(2 pi (c t + d)), with t rising from rest to peak energy. */
export const PALETTES = {
  abyss: {
    label: 'Bioluminescent Abyss',
    shortLabel: 'Abyss',
    a: [0.14, 0.5, 0.56],
    b: [0.18, 0.48, 0.36],
    c: [0.5, 0.62, 0.55],
    d: [0.5, 0.5, 0.5],
  },
  corona: {
    label: 'Solar Corona',
    shortLabel: 'Corona',
    a: [0.65, 0.44, 0.2],
    b: [0.37, 0.46, 0.3],
    c: [0.6, 0.5, 0.66],
    d: [0.5, 0.5, 0.335],
  },
  mercury: {
    label: 'Liquid Mercury',
    shortLabel: 'Mercury',
    a: [0.55, 0.55, 0.55],
    b: [0.45, 0.43, 0.39],
    c: [0.5, 0.5, 0.5],
    d: [0.48, 0.5, 0.53],
  },
} as const satisfies Record<string, CosinePalette>

export type PaletteId = keyof typeof PALETTES

export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[]
export const DEFAULT_PALETTE: PaletteId = 'abyss'

const SWATCH_STOPS = 6

/** CSS gradient that previews a palette from rest (left) to peak energy (right). */
export function paletteGradient({ a, b, c, d }: CosinePalette): string {
  const stops = Array.from({ length: SWATCH_STOPS }, (_, index) => {
    const t = 0.1 + (0.9 * index) / (SWATCH_STOPS - 1)
    const channels = a.map((offset, channel) => {
      const value = offset + b[channel] * Math.cos(2 * Math.PI * (c[channel] * t + d[channel]))
      return Math.round(255 * Math.min(Math.max(value, 0), 1) ** (1 / 2.2))
    })
    return `rgb(${channels.join(' ')})`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
