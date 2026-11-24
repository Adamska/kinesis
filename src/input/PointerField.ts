import { FORCE_POINT_COUNT } from '../gpgpu/forceField'

const IDLE_TIMEOUT_MS = 2500

export interface PointerContact {
  id: number
  x: number
  y: number
  pressed: boolean
  releasePending: boolean
  lastActivity: number
}

/**
 * Pointer fallback with one contact per force point: move to stir, hold to pinch,
 * release to burst. Two fingers on a touch screen drive two independent wells.
 */
export class PointerField {
  readonly contacts: PointerContact[] = Array.from({ length: FORCE_POINT_COUNT }, () => ({
    id: -1,
    x: 0,
    y: 0,
    pressed: false,
    releasePending: false,
    lastActivity: Number.NEGATIVE_INFINITY,
  }))

  attach(element: HTMLElement): () => void {
    const owner = (event: PointerEvent) => this.contacts.find((contact) => contact.id === event.pointerId)
    // A new pointer takes over the first contact that is not held down.
    const claim = (event: PointerEvent) => {
      const contact = owner(event) ?? this.contacts.find((candidate) => !candidate.pressed)
      if (contact) contact.id = event.pointerId
      return contact
    }
    const locate = (contact: PointerContact, event: PointerEvent) => {
      const rect = element.getBoundingClientRect()
      contact.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      contact.y = 1 - ((event.clientY - rect.top) / rect.height) * 2
      contact.lastActivity = performance.now()
    }

    const move = (event: PointerEvent) => {
      const contact = event.pointerType === 'mouse' ? claim(event) : owner(event)
      if (contact) locate(contact, event)
    }
    const press = (event: PointerEvent) => {
      const contact = claim(event)
      if (!contact) return
      locate(contact, event)
      contact.pressed = true
      element.setPointerCapture(event.pointerId)
    }
    const release = (event: PointerEvent) => {
      const contact = owner(event)
      if (!contact) return
      locate(contact, event)
      contact.releasePending = contact.pressed
      contact.pressed = false
      if (event.pointerType !== 'mouse') contact.id = -1
    }
    const cancel = (event: PointerEvent) => {
      const contact = owner(event)
      if (!contact) return
      contact.pressed = false
      contact.id = -1
    }

    element.addEventListener('pointermove', move)
    element.addEventListener('pointerdown', press)
    element.addEventListener('pointerup', release)
    element.addEventListener('pointercancel', cancel)
    return () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerdown', press)
      element.removeEventListener('pointerup', release)
      element.removeEventListener('pointercancel', cancel)
    }
  }

  isEngaged(contact: PointerContact, now: number): boolean {
    return contact.pressed || now - contact.lastActivity < IDLE_TIMEOUT_MS
  }

  consumeRelease(contact: PointerContact): boolean {
    const pending = contact.releasePending
    contact.releasePending = false
    return pending
  }
}
