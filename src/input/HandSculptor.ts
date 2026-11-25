import { MathUtils, Matrix4, Quaternion, Vector3, type Camera } from 'three'
import { FORCE_POINT_COUNT } from '../gpgpu/forceField'
import { MAX_TIME_STEP } from '../gpgpu/SimulationEngine'
import {
  boneFrame,
  createSurface,
  HAND_VERTEX_WIDTH,
  loadHandModel,
  type HandBone,
  type HandModel,
  type HandSurface,
} from '../gpgpu/handShape'
import type { TrackedHand } from '../store/useSimulationStore'
import { Landmark, LANDMARK_COUNT, LANDMARK_STRIDE } from '../vision/handTopology'

// World length of the palm, wrist to middle knuckle. The hand is drawn at a fixed
// size, slightly larger when it is closer, so it always fits inside the cloud.
const PALM_LENGTH = 0.8
const DEPTH_SCALE = 0.2
// Landmarks are raw detections; smoothing their offsets keeps the surface calm.
const JOINT_RATE = 18
// Vertex velocities let settled particles travel with the skin instead of chasing it;
// they are smoothed so the camera's frame rate does not show through as judder.
const VELOCITY_RATE = 14
// MediaPipe tends to report the thumb splayed far out of the palm. Its metacarpal
// swings only part of the way from the model's rest toward the measured direction,
// within a limit, so the base of the thumb stays attached instead of tearing away.
const THUMB_FOLLOW = 0.6
const THUMB_MAX_SWING = MathUtils.degToRad(35)
// The model's thumb metacarpal is short, and drawn back toward its rest it reads as a
// stubby thumb. It is lengthened along its own axis, from the base of the thumb out.
const THUMB_BASE_STRETCH = 1.3

const PALM: HandBone = { from: Landmark.WRIST, to: Landmark.MIDDLE_MCP, thumb: false }
// Joints carried rigidly by the palm: the wrist, the base of the thumb and the knuckles.
const PALM_JOINTS = [Landmark.WRIST, 1, Landmark.INDEX_MCP, Landmark.MIDDLE_MCP, 13, Landmark.PINKY_MCP] as const
const FINGER_KNUCKLES = [Landmark.INDEX_MCP, Landmark.MIDDLE_MCP, 13, Landmark.PINKY_MCP] as const

/** True when the world landmarks were filled in for this frame. */
function hasDepth(world: Float32Array): boolean {
  const middle = Landmark.MIDDLE_MCP * LANDMARK_STRIDE
  return Math.hypot(world[middle] - world[0], world[middle + 1] - world[1], world[middle + 2] - world[2]) > 1e-6
}

const direction = new Vector3()
const restDirection = new Vector3()
const palmCenter = new Vector3()
const frame = new Matrix4()
const scaling = new Matrix4()
const stretched = new Matrix4()
const rigid = new Matrix4()
const swing = new Quaternion()
const correction = new Quaternion()
const identity = new Quaternion()

/**
 * Poses a rigged, realistic hand model like the tracked hand and writes its skinned
 * surface into the texture the velocity pass reads.
 *
 * The palm moves as one rigid block, as the metacarpals of a real hand do: only its
 * orientation comes from the landmarks, and the wrist, the base of the thumb and the
 * knuckles keep the model's layout. The fingers and the thumb are then rebuilt by
 * forward kinematics: each phalanx takes its direction from the landmarks but keeps
 * the model's length (the thumb metacarpal slightly lengthened), so the hand bends like the user's while staying anatomically
 * proportioned and connected. Each vertex follows its bones by linear blend skinning.
 */
export class HandSculptor {
  private model: HandModel | null = null
  private surface: HandSurface | null = null
  private readonly offsets = Array.from({ length: FORCE_POINT_COUNT }, () => new Float32Array(LANDMARK_COUNT * 3))
  private readonly primed: boolean[] = Array.from({ length: FORCE_POINT_COUNT }, () => false)
  private readonly joints = Array.from({ length: LANDMARK_COUNT }, () => new Vector3())
  private readonly measured = Array.from({ length: LANDMARK_COUNT }, () => new Vector3())
  private skinning: Matrix4[] = []
  private thumbBase = -1

  get ready(): boolean {
    return this.surface !== null
  }

  /** Starts loading the model; resolves with the GPU surface once it is ready. */
  prepare(onReady: (surface: HandSurface) => void): void {
    if (this.model) return
    loadHandModel().then(
      (model) => {
        if (this.model) return
        this.model = model
        this.skinning = model.bones.map(() => new Matrix4())
        this.thumbBase = model.bones.findIndex((bone) => bone.from === 1 && bone.to === 2)
        this.surface = createSurface(model)
        onReady(this.surface)
      },
      (error: unknown) => console.warn('Hand model unavailable; sculpting is disabled.', error),
    )
  }

  /** Marks a hand's pose as stale, so it snaps to the next pose it is given. */
  reset(index: number): void {
    this.primed[index] = false
  }

  update(index: number, hand: TrackedHand, center: Vector3, camera: Camera, dt: number): void {
    const { model, surface } = this
    if (!model || !surface) return
    // Offsets from the wrist in mirrored view space (x right, y up, z toward the
    // viewer). Only their directions are used, so their unit does not matter. The
    // metric world landmarks carry the hand's true depth, which lets it turn to its
    // edge and its back; the image landmarks, whose depth is flattened, are the
    // fallback. Image x and depth are normalized by frame width, so the aspect ratio
    // makes their axes isotropic.
    const metric = hasDepth(hand.world)
    const source = metric ? hand.world : hand.landmarks
    const stretch = metric ? 1 : hand.aspect
    const at = (landmark: number, axis: number) => source[landmark * LANDMARK_STRIDE + axis]
    const offsets = this.offsets[index]
    const snap = !this.primed[index]
    const blend = snap ? 1 : 1 - Math.exp(-dt * JOINT_RATE)
    this.primed[index] = true
    for (let landmark = 0; landmark < LANDMARK_COUNT; landmark++) {
      const base = landmark * 3
      offsets[base] += (-(at(landmark, 0) - at(Landmark.WRIST, 0)) * stretch - offsets[base]) * blend
      offsets[base + 1] += (-(at(landmark, 1) - at(Landmark.WRIST, 1)) - offsets[base + 1]) * blend
      offsets[base + 2] += (-(at(landmark, 2) - at(Landmark.WRIST, 2)) * stretch - offsets[base + 2]) * blend
    }

    const rest = hand.left ? model.left : model.right
    const scale = (PALM_LENGTH * (1 + DEPTH_SCALE * hand.depth)) / model.palmLength
    const { joints, measured } = this
    for (let landmark = 0; landmark < LANDMARK_COUNT; landmark++) {
      measured[landmark].fromArray(offsets, landmark * 3).applyQuaternion(camera.quaternion)
    }

    // Rigid palm: out of the model's palm frame, scaled, into the measured one.
    scaling.makeScale(scale, scale, scale)
    rigid.multiplyMatrices(boneFrame(measured, PALM, frame), scaling).multiply(rest.inverseFrames[model.palmBone])
    for (const landmark of PALM_JOINTS) joints[landmark].copy(rest.joints[landmark]).applyMatrix4(rigid)

    // Thumb: the metacarpal swings part of the way toward its measured direction; the
    // whole chain turns with it, so the bends at its joints are kept as measured.
    this.restDirection(rest.joints, 1, 2)
    if (this.measuredDirection(1, 2)) {
      swing.setFromUnitVectors(restDirection, direction)
      const angle = 2 * Math.acos(MathUtils.clamp(swing.w, -1, 1))
      const follow = angle * THUMB_FOLLOW > THUMB_MAX_SWING ? THUMB_MAX_SWING / angle : THUMB_FOLLOW
      swing.slerpQuaternions(identity, swing, follow)
      correction.setFromUnitVectors(direction, restDirection.applyQuaternion(swing))
    } else correction.identity()
    this.place(rest.joints, 2, 1, scale * THUMB_BASE_STRETCH, correction)
    for (let landmark = 3; landmark <= 4; landmark++) this.place(rest.joints, landmark, landmark - 1, scale, correction)

    // Fingers: each phalanx follows its measured direction from the rigid knuckle.
    for (const knuckle of FINGER_KNUCKLES) {
      for (let landmark = knuckle + 1; landmark <= knuckle + 3; landmark++) {
        this.place(rest.joints, landmark, landmark - 1, scale, identity)
      }
    }

    // The palm center sits on the force point that follows the hand.
    palmCenter.addVectors(joints[Landmark.WRIST], joints[Landmark.MIDDLE_MCP]).multiplyScalar(0.5)
    palmCenter.subVectors(center, palmCenter)
    for (const joint of joints) joint.add(palmCenter)

    // Skinning matrix of each bone: out of its rest frame, scaled, into its posed frame.
    // The rest frame's y runs along the bone, so stretching y lengthens the thumb base.
    stretched.makeScale(scale, scale * THUMB_BASE_STRETCH, scale)
    model.bones.forEach((bone, k) => {
      const boneScaling = k === this.thumbBase ? stretched : scaling
      this.skinning[k].multiplyMatrices(boneFrame(joints, bone, frame), boneScaling).multiply(rest.inverseFrames[k])
    })

    const data = surface.vertices.image.data as Float32Array
    const motion = surface.velocities.image.data as Float32Array
    const follow = 1 - Math.exp(-dt * VELOCITY_RATE)
    // Per simulation second: on a slow frame the simulation advances by at most
    // MAX_TIME_STEP, and the particles must still cover the skin's whole displacement.
    const step = Math.min(dt, MAX_TIME_STEP)
    const start = index * surface.rows * HAND_VERTEX_WIDTH * 4
    const { boneIndices, boneWeights, vertexCount } = model
    const vertices = rest.vertices
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const x = vertices[vertex * 3]
      const y = vertices[vertex * 3 + 1]
      const z = vertices[vertex * 3 + 2]
      let px = 0
      let py = 0
      let pz = 0
      for (let slot = 0; slot < 4; slot++) {
        const weight = boneWeights[vertex * 4 + slot]
        if (weight === 0) continue
        const e = this.skinning[boneIndices[vertex * 4 + slot]].elements
        px += weight * (e[0] * x + e[4] * y + e[8] * z + e[12])
        py += weight * (e[1] * x + e[5] * y + e[9] * z + e[13])
        pz += weight * (e[2] * x + e[6] * y + e[10] * z + e[14])
      }
      const texel = start + vertex * 4
      if (snap) {
        motion[texel] = 0
        motion[texel + 1] = 0
        motion[texel + 2] = 0
      } else {
        motion[texel] += ((px - data[texel]) / step - motion[texel]) * follow
        motion[texel + 1] += ((py - data[texel + 1]) / step - motion[texel + 1]) * follow
        motion[texel + 2] += ((pz - data[texel + 2]) / step - motion[texel + 2]) * follow
      }
      data[texel] = px
      data[texel + 1] = py
      data[texel + 2] = pz
    }
    surface.vertices.needsUpdate = true
    surface.velocities.needsUpdate = true
  }

  /** Unit direction of the measured segment into `direction`; false when degenerate. */
  private measuredDirection(from: number, to: number): boolean {
    direction.subVectors(this.measured[to], this.measured[from])
    if (direction.lengthSq() < 1e-12) return false
    direction.normalize()
    return true
  }

  /** Unit direction of the rest segment, carried by the rigid palm, into `restDirection`. */
  private restDirection(restJoints: readonly Vector3[], from: number, to: number): void {
    restDirection.subVectors(restJoints[to], restJoints[from]).transformDirection(rigid)
  }

  /** Places a joint at the model's bone length from its parent, along the measured direction. */
  private place(restJoints: readonly Vector3[], landmark: number, parent: number, scale: number, turn: Quaternion): void {
    if (this.measuredDirection(parent, landmark)) direction.applyQuaternion(turn)
    else {
      this.restDirection(restJoints, parent, landmark)
      direction.copy(restDirection)
    }
    const length = scale * restJoints[landmark].distanceTo(restJoints[parent])
    this.joints[landmark].copy(this.joints[parent]).addScaledVector(direction, length)
  }
}
