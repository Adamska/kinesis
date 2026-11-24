export const LANDMARK_COUNT = 21
/** Floats per landmark in packed arrays: x and y normalized to the frame, z relative depth. */
export const LANDMARK_STRIDE = 3
export const MAX_HANDS = 2

export const Landmark = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
} as const

export const FINGERTIPS = [
  Landmark.THUMB_TIP,
  Landmark.INDEX_TIP,
  Landmark.MIDDLE_TIP,
  Landmark.RING_TIP,
  Landmark.PINKY_TIP,
] as const

/** Bone list of the 21-point hand model as index pairs, thumb to pinky then the palm arch. */
export const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
]
