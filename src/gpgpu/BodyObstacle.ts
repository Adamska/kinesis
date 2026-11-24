import {
  DataTexture,
  LinearFilter,
  Matrix4,
  RedFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
  type Camera,
} from 'three'
import type { Silhouette } from '../store/useSimulationStore'
import { MASK_HEIGHT, MASK_WIDTH } from '../vision/silhouetteMask'

const STALE_MS = 400
const FADE_RATE = 4
// Height of the silhouette relative to the screen: slightly inset, so the body sits
// inside the cloud with fluid flowing around it rather than emptying the frame.
const BODY_FRAME = 0.8

/**
 * The user's silhouette as an obstacle in the flow. The camera frame is mirrored and
 * cover-fit onto the screen, so particles are tested in screen space: each one is
 * projected, looked up in the mask, and pushed out along the mask's gradient.
 */
export class BodyObstacle {
  readonly texture: DataTexture
  readonly viewProjection = new Matrix4()
  /** Scale from screen uv to mask uv around the center, for a cover fit. */
  readonly maskScale = new Vector2(1, 1)
  /** Centroid of the body in screen uv, the fallback direction deep inside it. */
  readonly center = new Vector2(0.5, 0.5)
  readonly right = new Vector3()
  readonly up = new Vector3()
  strength = 0
  screenAspect = 1

  private version = -1

  constructor() {
    this.texture = new DataTexture(new Uint8Array(MASK_WIDTH * MASK_HEIGHT), MASK_WIDTH, MASK_HEIGHT, RedFormat, UnsignedByteType)
    this.texture.minFilter = LinearFilter
    this.texture.magFilter = LinearFilter
    this.texture.needsUpdate = true
  }

  update(silhouette: Silhouette, enabled: boolean, camera: Camera, aspect: number, delta: number): void {
    const live = enabled && performance.now() - silhouette.seenAt < STALE_MS
    this.strength += ((live ? 1 : 0) - this.strength) * (1 - Math.exp(-delta * FADE_RATE))
    if (this.strength < 1e-3) return

    this.screenAspect = aspect
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.right.setFromMatrixColumn(camera.matrixWorld, 0)
    this.up.setFromMatrixColumn(camera.matrixWorld, 1)
    if (aspect > silhouette.aspect) this.maskScale.set(1, silhouette.aspect / aspect)
    else this.maskScale.set(aspect / silhouette.aspect, 1)
    this.maskScale.divideScalar(BODY_FRAME)

    if (silhouette.version === this.version) return
    this.version = silhouette.version
    const data = this.texture.image.data as Uint8Array
    data.set(silhouette.mask)
    this.texture.needsUpdate = true
    this.locateCenter(data)
  }

  dispose(): void {
    this.texture.dispose()
  }

  /** Mask-weighted centroid, converted from mirrored image uv to screen uv. */
  private locateCenter(data: Uint8Array): void {
    let total = 0
    let sumU = 0
    let sumV = 0
    for (let index = 0; index < data.length; index++) {
      const weight = data[index]
      total += weight
      sumU += weight * ((index % MASK_WIDTH) + 0.5)
      sumV += weight * (Math.floor(index / MASK_WIDTH) + 0.5)
    }
    if (total === 0) return
    const u = sumU / total / MASK_WIDTH
    const v = sumV / total / MASK_HEIGHT
    this.center.set(1 - (0.5 + (u - 0.5) / this.maskScale.x), 1 - (0.5 + (v - 0.5) / this.maskScale.y))
  }
}
