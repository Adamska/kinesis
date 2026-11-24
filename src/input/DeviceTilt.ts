const FULL_TILT_DEGREES = 30
const RECENTER_RATE = 0.15
const FOLLOW_RATE = 6

interface PermissionGatedOrientation {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/**
 * Handheld tilt as a parallax input. Angles are measured against a baseline that
 * slowly drifts toward the current pose, so whatever way the device is held becomes
 * neutral after a few seconds and only deliberate tilts move the camera.
 */
export class DeviceTilt {
  /** Smoothed tilt in [-1, 1]: x to the right, y away from the viewer. */
  x = 0
  y = 0

  private rawX = 0
  private rawY = 0
  private baseX = Number.NaN
  private baseY = 0

  attach(): () => void {
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return
      // Map the device axes onto the screen axes for the current orientation.
      const angle = screen.orientation?.angle ?? 0
      const [x, y] =
        angle === 90
          ? [event.beta, -event.gamma]
          : angle === 270
            ? [-event.beta, event.gamma]
            : angle === 180
              ? [-event.gamma, -event.beta]
              : [event.gamma, event.beta]
      if (Number.isNaN(this.baseX)) {
        this.baseX = x
        this.baseY = y
      }
      this.rawX = x
      this.rawY = y
    }

    // iOS only delivers orientation after a permission prompt, which itself must be
    // triggered by a user gesture; the first touch on the page serves as that gesture.
    const gated = DeviceOrientationEvent as unknown as PermissionGatedOrientation
    const requestOnTouch = () => {
      void gated.requestPermission?.().catch(() => undefined)
    }
    if (gated.requestPermission) window.addEventListener('pointerdown', requestOnTouch, { once: true })
    window.addEventListener('deviceorientation', onOrientation)

    return () => {
      window.removeEventListener('pointerdown', requestOnTouch)
      window.removeEventListener('deviceorientation', onOrientation)
    }
  }

  update(delta: number): void {
    if (Number.isNaN(this.baseX)) return
    const recenter = 1 - Math.exp(-delta * RECENTER_RATE)
    this.baseX += (this.rawX - this.baseX) * recenter
    this.baseY += (this.rawY - this.baseY) * recenter
    const follow = 1 - Math.exp(-delta * FOLLOW_RATE)
    const clamp = (value: number) => Math.min(Math.max(value / FULL_TILT_DEGREES, -1), 1)
    this.x += (clamp(this.rawX - this.baseX) - this.x) * follow
    this.y += (clamp(this.rawY - this.baseY) - this.y) * follow
  }
}
