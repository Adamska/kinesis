import type { DataTexture } from 'three'
import { createShapeTargets, type ShapeId } from './shapeTargets'

const MORPH_IN_RATE = 1.8
const MORPH_OUT_RATE = 1.4
const RELEASED = 0.002

/**
 * Tracks which shape the field is pulled toward and how strongly. Target textures are
 * built asynchronously; switching between two forms swaps the targets in place, so
 * matter streams straight from one shape to the next.
 */
export class ShapeMorph {
  strength = 0
  targets: DataTexture | null = null

  private readonly size: number
  private requested: ShapeId = 'fluid'
  private loaded: ShapeId = 'fluid'
  private ticket = 0

  constructor(size: number) {
    this.size = size
  }

  request(shape: ShapeId): void {
    if (shape === this.requested) return
    this.requested = shape
    const ticket = ++this.ticket
    if (shape === 'fluid') return
    void createShapeTargets(shape, this.size).then((texture) => {
      if (ticket !== this.ticket) {
        texture.dispose()
        return
      }
      this.targets?.dispose()
      this.targets = texture
      this.loaded = shape
    })
  }

  update(delta: number): void {
    const holding = this.requested !== 'fluid' && this.loaded === this.requested
    const rate = holding ? MORPH_IN_RATE : MORPH_OUT_RATE
    this.strength += ((holding ? 1 : 0) - this.strength) * (1 - Math.exp(-delta * rate))
    if (this.requested === 'fluid' && this.targets && this.strength < RELEASED) {
      this.targets.dispose()
      this.targets = null
      this.loaded = 'fluid'
      this.strength = 0
    }
  }

  /** Releases the targets and cancels pending builds; the instance stays usable. */
  dispose(): void {
    this.ticket++
    this.targets?.dispose()
    this.targets = null
    this.requested = 'fluid'
    this.loaded = 'fluid'
    this.strength = 0
  }
}
