import {
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  NearestFilter,
  RGBAFormat,
  WebGLRenderTarget,
} from 'three'

/** A single oversized triangle covers the viewport without the diagonal seam of a quad. */
export function createFullscreenTriangle(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  )
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
  return geometry
}

export function createStateTarget(size: number): WebGLRenderTarget {
  return new WebGLRenderTarget(size, size, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  })
}
