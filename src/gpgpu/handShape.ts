import { DataTexture, FloatType, Matrix4, NearestFilter, RGBAFormat, Vector3, type SkinnedMesh } from 'three'
import handModelUrl from '../assets/hand/right.glb?url'
import { FORCE_POINT_COUNT } from './forceField'
import { mulberry32 } from './random'
import { Landmark } from '../vision/handTopology'

/** Width of the skinned vertex texture; each hand fills a block of rows. */
export const HAND_VERTEX_WIDTH = 128
/** Side of the square table of area-weighted triangle picks. */
export const HAND_SAMPLE_SIZE = 128

/**
 * A rigid segment of the hand between two landmarks. Its frame has y along the
 * segment and x toward a reference direction: across the knuckles for the palm and
 * the fingers, along the palm normal for the thumb, whose flexion runs across the palm.
 */
export interface HandBone {
  from: number
  to: number
  thumb: boolean
}

// Every joint of the WebXR hand rig drives the segment that starts at it. Tips carry
// on the last phalanx, and the metacarpals run from the wrist to their knuckle.
const FINGERS = [
  ['index-finger', Landmark.INDEX_MCP],
  ['middle-finger', Landmark.MIDDLE_MCP],
  ['ring-finger', 13],
  ['pinky-finger', Landmark.PINKY_MCP],
] as const

const JOINT_SEGMENTS: Record<string, readonly [number, number]> = {
  wrist: [Landmark.WRIST, Landmark.MIDDLE_MCP],
  'thumb-metacarpal': [1, 2],
  'thumb-phalanx-proximal': [2, 3],
  'thumb-phalanx-distal': [3, 4],
  'thumb-tip': [3, 4],
  ...Object.fromEntries(
    FINGERS.flatMap(([name, knuckle]) => [
      [`${name}-metacarpal`, [Landmark.WRIST, knuckle]],
      [`${name}-phalanx-proximal`, [knuckle, knuckle + 1]],
      [`${name}-phalanx-intermediate`, [knuckle + 1, knuckle + 2]],
      [`${name}-phalanx-distal`, [knuckle + 2, knuckle + 3]],
      [`${name}-tip`, [knuckle + 2, knuckle + 3]],
    ]),
  ),
}

// Rig joint that sits on each landmark, for reading the rest pose.
const LANDMARK_JOINTS = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  ...FINGERS.flatMap(([name]) => [
    `${name}-phalanx-proximal`,
    `${name}-phalanx-intermediate`,
    `${name}-phalanx-distal`,
    `${name}-tip`,
  ]),
]

/** One chirality of the hand at rest, in the model's own units. */
export interface HandRest {
  vertices: Float32Array
  joints: Vector3[]
  /** Inverse rest frame of each bone. */
  inverseFrames: Matrix4[]
}

export interface HandModel {
  vertexCount: number
  bones: HandBone[]
  right: HandRest
  left: HandRest
  /** Four bone influences per vertex. */
  boneIndices: Uint8Array
  boneWeights: Float32Array
  /** Vertex indices, three per triangle. */
  triangles: Uint32Array
  /** Index of the bone that spans the palm, wrist to middle knuckle. */
  palmBone: number
  /** Wrist to middle knuckle at rest. */
  palmLength: number
}

/**
 * World-space surface of each hand as the velocity pass reads it. `vertices` holds
 * the skinned vertex positions, `rows` rows per force point, and `velocities` their
 * smoothed velocities in the same layout; `samples` holds area-weighted triangle
 * picks, the three vertex indices of each in rgb.
 */
export interface HandSurface {
  vertices: DataTexture
  velocities: DataTexture
  rows: number
  samples: DataTexture
}

const axisX = new Vector3()
const axisY = new Vector3()
const axisZ = new Vector3()
const toIndex = new Vector3()
const toPinky = new Vector3()

/** Writes the frame of `bone` in the pose given by the 21 joint positions. */
export function boneFrame(joints: readonly Vector3[], bone: HandBone, out: Matrix4): Matrix4 {
  const wrist = joints[Landmark.WRIST]
  axisY.subVectors(joints[bone.to], joints[bone.from]).normalize()
  if (bone.thumb) {
    toIndex.subVectors(joints[Landmark.INDEX_MCP], wrist)
    toPinky.subVectors(joints[Landmark.PINKY_MCP], wrist)
    axisX.crossVectors(toIndex, toPinky)
  } else axisX.subVectors(joints[Landmark.INDEX_MCP], joints[Landmark.PINKY_MCP])
  axisX.addScaledVector(axisY, -axisX.dot(axisY))
  // A segment parallel to its reference has no defined roll; any perpendicular will do.
  if (axisX.lengthSq() < 1e-12) axisX.set(axisY.y, -axisY.x, 0)
  if (axisX.lengthSq() < 1e-12) axisX.set(1, 0, 0)
  axisX.normalize()
  axisZ.crossVectors(axisX, axisY)
  return out.makeBasis(axisX, axisY, axisZ).setPosition(joints[bone.from])
}

function createRest(vertices: Float32Array, joints: Vector3[], bones: HandBone[]): HandRest {
  const inverseFrames = bones.map((bone) => boneFrame(joints, bone, new Matrix4()).invert())
  return { vertices, joints, inverseFrames }
}

/** Mirrors a rest pose across its x axis, turning the right hand into a left one. */
function mirror(vertices: Float32Array, joints: Vector3[], bones: HandBone[]): HandRest {
  const mirrored = vertices.slice()
  for (let index = 0; index < mirrored.length; index += 3) mirrored[index] = -mirrored[index]
  return createRest(
    mirrored,
    joints.map((joint) => new Vector3(-joint.x, joint.y, joint.z)),
    bones,
  )
}

let loading: Promise<HandModel> | null = null

/** Loads the rigged hand once and converts its skin to the landmark segments. */
export function loadHandModel(): Promise<HandModel> {
  loading ??= (async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
    const gltf = await new GLTFLoader().loadAsync(handModelUrl)
    let mesh: SkinnedMesh | null = null
    gltf.scene.traverse((object) => {
      if ((object as SkinnedMesh).isSkinnedMesh) mesh ??= object as SkinnedMesh
    })
    if (!mesh) throw new Error('The hand model has no skinned mesh')
    const { geometry, skeleton } = mesh as SkinnedMesh

    // Vertices and inverse bind matrices are both in the mesh's own space.
    const restJoint = (name: string) => {
      const index = skeleton.bones.findIndex((bone) => bone.name === name)
      if (index < 0) throw new Error(`The hand model has no joint named ${name}`)
      return new Vector3().setFromMatrixPosition(skeleton.boneInverses[index].clone().invert())
    }
    const joints = LANDMARK_JOINTS.map(restJoint)

    const bones: HandBone[] = []
    const boneOf = skeleton.bones.map((joint) => {
      const [from, to] = JOINT_SEGMENTS[joint.name] ?? JOINT_SEGMENTS.wrist
      let index = bones.findIndex((bone) => bone.from === from && bone.to === to)
      if (index < 0) index = bones.push({ from, to, thumb: from >= 1 && from <= 3 }) - 1
      return index
    })

    const position = geometry.getAttribute('position')
    const skinIndex = geometry.getAttribute('skinIndex')
    const skinWeight = geometry.getAttribute('skinWeight')
    const vertexCount = position.count
    const vertices = new Float32Array(vertexCount * 3)
    const boneIndices = new Uint8Array(vertexCount * 4)
    const boneWeights = new Float32Array(vertexCount * 4)
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      vertices[vertex * 3] = position.getX(vertex)
      vertices[vertex * 3 + 1] = position.getY(vertex)
      vertices[vertex * 3 + 2] = position.getZ(vertex)
      let total = 0
      for (let slot = 0; slot < 4; slot++) {
        boneIndices[vertex * 4 + slot] = boneOf[skinIndex.getComponent(vertex, slot)]
        const weight = skinWeight.getComponent(vertex, slot)
        boneWeights[vertex * 4 + slot] = weight
        total += weight
      }
      for (let slot = 0; slot < 4; slot++) boneWeights[vertex * 4 + slot] /= total || 1
    }

    const right = createRest(vertices, joints, bones)
    const model: HandModel = {
      vertexCount,
      bones,
      right,
      left: mirror(vertices, joints, bones),
      boneIndices,
      boneWeights,
      triangles: triangleList(geometry.getIndex()?.array, vertexCount),
      palmBone: boneOf[skeleton.bones.findIndex((joint) => joint.name === 'wrist')],
      palmLength: joints[Landmark.WRIST].distanceTo(joints[Landmark.MIDDLE_MCP]),
    }
    return model
  })()
  return loading
}

function triangleList(index: ArrayLike<number> | undefined, vertexCount: number): Uint32Array {
  if (index) return Uint32Array.from(index)
  return Uint32Array.from({ length: vertexCount }, (_, vertex) => vertex)
}

function createFloatTexture(data: Float32Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

/**
 * Builds the GPU surface for a loaded model. Triangles are picked in proportion to
 * their rest area, so particles cover the skin evenly; each particle then takes its
 * own point inside its triangle.
 */
export function createSurface(model: HandModel): HandSurface {
  const { triangles } = model
  const { vertices } = model.right
  const count = triangles.length / 3
  const cumulative = new Float64Array(count)
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  let total = 0
  for (let triangle = 0; triangle < count; triangle++) {
    a.fromArray(vertices, triangles[triangle * 3] * 3)
    b.fromArray(vertices, triangles[triangle * 3 + 1] * 3)
    c.fromArray(vertices, triangles[triangle * 3 + 2] * 3)
    total += b.sub(a).cross(c.sub(a)).length()
    cumulative[triangle] = total
  }

  const random = mulberry32(0x48414e44)
  const sampleCount = HAND_SAMPLE_SIZE * HAND_SAMPLE_SIZE
  const samples = new Float32Array(sampleCount * 4)
  for (let sample = 0; sample < sampleCount; sample++) {
    const target = random() * total
    let low = 0
    let high = count - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (cumulative[middle] < target) low = middle + 1
      else high = middle
    }
    samples[sample * 4] = triangles[low * 3]
    samples[sample * 4 + 1] = triangles[low * 3 + 1]
    samples[sample * 4 + 2] = triangles[low * 3 + 2]
  }

  const rows = Math.ceil(model.vertexCount / HAND_VERTEX_WIDTH)
  const vertexTexture = () =>
    createFloatTexture(
      new Float32Array(HAND_VERTEX_WIDTH * rows * FORCE_POINT_COUNT * 4),
      HAND_VERTEX_WIDTH,
      rows * FORCE_POINT_COUNT,
    )
  return {
    vertices: vertexTexture(),
    velocities: vertexTexture(),
    rows,
    samples: createFloatTexture(samples, HAND_SAMPLE_SIZE, HAND_SAMPLE_SIZE),
  }
}
