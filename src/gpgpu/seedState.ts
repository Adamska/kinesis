import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three'
import { mulberry32 } from './random'

const SHELL_RADII = [0.5, 0.95, 1.4] as const
const SHELL_THICKNESS = 0.035
const DUST_FRACTION = 0.3
const DUST_RADIUS = 1.6

function createStateTexture(data: Float32Array, size: number): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

export interface SeedState {
  position: DataTexture
  velocity: DataTexture
}

/**
 * Seeds the cloud as thin concentric shells suspended in sparse dust. Thin sheets
 * are what an incompressible flow folds into visible structure; a uniform ball
 * would stay uniform forever.
 */
export function createSeedState(size: number, seed = 0x4b494e45): SeedState {
  const random = mulberry32(seed)
  const count = size * size
  const position = new Float32Array(count * 4)
  const velocity = new Float32Array(count * 4)

  // Shells are picked proportionally to r^2 so every shell has equal surface density.
  const shellWeights = SHELL_RADII.map((radius) => radius * radius)
  const totalWeight = shellWeights.reduce((sum, weight) => sum + weight, 0)

  for (let index = 0; index < count; index++) {
    const offset = index * 4
    const cosTheta = random() * 2 - 1
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta)
    const azimuth = random() * Math.PI * 2

    let radius: number
    if (random() < DUST_FRACTION) {
      radius = DUST_RADIUS * Math.cbrt(random())
    } else {
      let pick = random() * totalWeight
      let shell = 0
      while (shell < SHELL_RADII.length - 1 && pick > shellWeights[shell]) {
        pick -= shellWeights[shell]
        shell++
      }
      // Sum of three uniforms approximates a Gaussian cross-section through the shell.
      const jitter = (random() + random() + random() - 1.5) * 2 * SHELL_THICKNESS
      radius = SHELL_RADII[shell] + jitter
    }

    position[offset] = radius * sinTheta * Math.cos(azimuth)
    position[offset + 1] = radius * cosTheta
    position[offset + 2] = radius * sinTheta * Math.sin(azimuth)
    position[offset + 3] = 0

    velocity[offset + 3] = random()
  }

  return {
    position: createStateTexture(position, size),
    velocity: createStateTexture(velocity, size),
  }
}
