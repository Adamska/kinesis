const IDLE_TIMEOUT_MS = 2500

/** Pointer fallback: move to stir, hold to pinch, release to burst. */
export class PointerField {
  x = 0
  y = 0
  pressed = false

  private lastActivity = Number.NEGATIVE_INFINITY
  private releasePending = false

  attach(element: HTMLElement): () => void {
    const locate = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect()
      this.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      this.y = 1 - ((event.clientY - rect.top) / rect.height) * 2
      this.lastActivity = performance.now()
    }
    const press = (event: PointerEvent) => {
      locate(event)
      this.pressed = true
      element.setPointerCapture(event.pointerId)
    }
    const release = (event: PointerEvent) => {
      locate(event)
      this.releasePending = this.pressed
      this.pressed = false
    }
    const cancel = () => {
      this.pressed = false
    }

    element.addEventListener('pointermove', locate)
    element.addEventListener('pointerdown', press)
    element.addEventListener('pointerup', release)
    element.addEventListener('pointercancel', cancel)
    return () => {
      element.removeEventListener('pointermove', locate)
      element.removeEventListener('pointerdown', press)
      element.removeEventListener('pointerup', release)
      element.removeEventListener('pointercancel', cancel)
    }
  }

  isEngaged(now: number): boolean {
    return this.pressed || now - this.lastActivity < IDLE_TIMEOUT_MS
  }

  consumeRelease(): boolean {
    const pending = this.releasePending
    this.releasePending = false
    return pending
  }
}
