import type { TrackedHand } from '../store/useSimulationStore'
import { Landmark, LANDMARK_STRIDE } from './handTopology'

// Cost of placing a detection into an empty slot, in frame-height units. A visible
// slot closer than this keeps the hand; anything farther counts as a new hand.
const EMPTY_SLOT_COST = 0.5

function palmDistance(a: Float32Array, b: Float32Array): number {
  const wrist = Landmark.WRIST * LANDMARK_STRIDE
  const knuckle = Landmark.MIDDLE_MCP * LANDMARK_STRIDE
  const dx = a[wrist] + a[knuckle] - b[wrist] - b[knuckle]
  const dy = a[wrist + 1] + a[knuckle + 1] - b[wrist + 1] - b[knuckle + 1]
  return Math.hypot(dx, dy) / 2
}

/**
 * MediaPipe returns hands in no stable order. Matching each detection to the slot whose
 * last palm position is nearest keeps a hand bound to the same force point, so its
 * smoothing, pinch state and spin carry over from frame to frame.
 */
export function assignHandSlots(detected: Float32Array[], hands: readonly TrackedHand[]): (Float32Array | null)[] {
  const slots: (Float32Array | null)[] = hands.map(() => null)
  const cost = (landmarks: Float32Array, slot: number) =>
    hands[slot].visible ? palmDistance(landmarks, hands[slot].landmarks) : EMPTY_SLOT_COST

  if (detected.length === 1) {
    slots[cost(detected[0], 1) < cost(detected[0], 0) ? 1 : 0] = detected[0]
  } else if (detected.length >= 2) {
    const [first, second] = detected
    const crossed = cost(first, 1) + cost(second, 0) < cost(first, 0) + cost(second, 1)
    slots[0] = crossed ? second : first
    slots[1] = crossed ? first : second
  }
  return slots
}
