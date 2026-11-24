import { Vector3, type Camera } from 'three'

const forward = new Vector3()
const direction = new Vector3()

/**
 * Projects a normalized device coordinate onto the plane through the origin that
 * faces the camera: the ray p(t) = eye + t * dir meets the plane where
 * dot(p, forward) = 0, giving t = -dot(eye, forward) / dot(dir, forward).
 * `lift` then moves the point off the plane toward the camera.
 */
export function projectToFocalPlane(camera: Camera, x: number, y: number, lift: number, out: Vector3): Vector3 {
  const eye = camera.position
  camera.getWorldDirection(forward)
  direction.set(x, y, 0.5).unproject(camera).sub(eye).normalize()
  const distance = -eye.dot(forward) / direction.dot(forward)
  return out.copy(eye).addScaledVector(direction, distance).addScaledVector(forward, -lift)
}
