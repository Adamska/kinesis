import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three'
import { mulberry32 } from './random'

export const SHAPE_IDS = ['fluid', 'title', 'sphere', 'knot', 'galaxy'] as const
export type ShapeId = (typeof SHAPE_IDS)[number]
export type FormId = Exclude<ShapeId, 'fluid'>

export const SHAPE_LABELS: Record<ShapeId, string> = {
  fluid: 'Fluid',
  title: 'Title',
  sphere: 'Sphere',
  knot: 'Knot',
  galaxy: 'Galaxy',
}

type Sampler = (random: () => number, out: Float32Array, offset: number) => void

const TITLE = 'KINESIS'
const TITLE_FONT = '800 200px "JetBrains Mono Variable", ui-monospace, monospace'
const TITLE_WIDTH = 3.4
const TITLE_DEPTH = 0.06

const gaussian = (random: () => number) => random() + random() + random() - 1.5

/** Rasterizes the title and keeps its filled pixels as candidate target points. */
async function titleSampler(): Promise<Sampler> {
  await document.fonts.load(TITLE_FONT).catch(() => undefined)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('A 2D canvas context is required to rasterize the title')
  context.font = TITLE_FONT
  const width = Math.ceil(context.measureText(TITLE).width) + 16
  canvas.width = width
  canvas.height = 240
  context.font = TITLE_FONT
  context.textBaseline = 'middle'
  context.fillStyle = '#fff'
  context.fillText(TITLE, 8, canvas.height / 2)

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const filled: number[] = []
  for (let index = 0; index < canvas.width * canvas.height; index++) {
    if (data[index * 4 + 3] > 127) filled.push(index)
  }
  const scale = TITLE_WIDTH / canvas.width
  return (random, out, offset) => {
    const pixel = filled[Math.floor(random() * filled.length)]
    out[offset] = ((pixel % canvas.width) + random() - canvas.width / 2) * scale
    out[offset + 1] = (canvas.height / 2 - Math.floor(pixel / canvas.width) - random()) * scale
    out[offset + 2] = gaussian(random) * TITLE_DEPTH
  }
}

// Uniform cos(theta) and azimuth give a uniform density over the sphere's surface.
const sphereSampler: Sampler = (random, out, offset) => {
  const cosTheta = 1 - 2 * random()
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta)
  const azimuth = random() * Math.PI * 2
  const radius = 1.25 + gaussian(random) * 0.02
  out[offset] = radius * sinTheta * Math.cos(azimuth)
  out[offset + 1] = radius * cosTheta
  out[offset + 2] = radius * sinTheta * Math.sin(azimuth)
}

// Trefoil (2, 3) torus knot thickened into a tube by a random offset around the curve.
const knotSampler: Sampler = (random, out, offset) => {
  const t = random() * Math.PI * 2
  const ring = 2 + Math.cos(3 * t)
  const tube = 0.1 * Math.sqrt(random())
  const angle = random() * Math.PI * 2
  out[offset] = 0.42 * ring * Math.cos(2 * t) + tube * Math.cos(angle)
  out[offset + 1] = 0.42 * ring * Math.sin(2 * t) + tube * Math.sin(angle)
  out[offset + 2] = -0.42 * Math.sin(3 * t) + tube * Math.cos(angle + 1.3)
}

// Three logarithmic arms around a dense bulge, tilted so the disc shows its depth.
const galaxySampler: Sampler = (random, out, offset) => {
  const radius = 1.7 * Math.pow(random(), 1.6) + 0.04
  const arm = Math.floor(random() * 3)
  const swirl = Math.log(radius + 0.2) * 2.4 + (arm * Math.PI * 2) / 3 + gaussian(random) * 0.35 / (radius + 0.4)
  const height = gaussian(random) * 0.08 * (1 - Math.min(radius / 1.7, 1) * 0.7)
  const x = radius * Math.cos(swirl)
  const z = radius * Math.sin(swirl)
  const tilt = 0.55
  out[offset] = x
  out[offset + 1] = height * Math.cos(tilt) - z * Math.sin(tilt)
  out[offset + 2] = height * Math.sin(tilt) + z * Math.cos(tilt)
}

const SAMPLERS: Record<FormId, () => Sampler | Promise<Sampler>> = {
  title: titleSampler,
  sphere: () => sphereSampler,
  knot: () => knotSampler,
  galaxy: () => galaxySampler,
}

/**
 * Builds a target texture in the same texel layout as the simulation state: texel i
 * holds the point particle i is pulled toward. Assignment is random, so a morph sends
 * matter streaming across the whole volume rather than shuffling locally.
 */
export async function createShapeTargets(form: FormId, size: number): Promise<DataTexture> {
  const sample = await SAMPLERS[form]()
  const random = mulberry32(0x5eed + size)
  const data = new Float32Array(size * size * 4)
  for (let offset = 0; offset < data.length; offset += 4) {
    sample(random, data, offset)
    data[offset + 3] = 1
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}
