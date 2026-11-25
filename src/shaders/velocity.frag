uniform sampler2D uPosition;
uniform sampler2D uVelocity;
uniform float uTime;
uniform float uDelta;
uniform float uTurbulence;
uniform vec3 uForcePosition[FORCE_COUNT];
uniform vec3 uForceVelocity[FORCE_COUNT];
uniform vec3 uForceAxis[FORCE_COUNT];
// x = pinch strength, y = shockwave impulse, z = carry weight (see the drag term),
// w = sculpt progress (see sculpt.glsl).
uniform vec4 uForceDrive[FORCE_COUNT];
// x = overload charge, y = its heartbeat, z = 1 while the shockwave is an explosion.
uniform vec3 uForceCharge[FORCE_COUNT];
// Posed hand model (see handShape.ts): skinned vertex positions and their velocities,
// uHandRows rows per force point, and a table of area-weighted triangles as three vertex indices each.
uniform sampler2D uHandVertices;
uniform sampler2D uHandVelocities;
uniform sampler2D uHandSamples;
uniform float uHandRows;

varying vec2 vUv;

const float TAU = 6.283185307179586;

const float FLOW_SPEED = 0.1;
const float REST_RADIUS = 1.55;
const float CONFINEMENT_STIFFNESS = 6.0;
const float MAX_SPEED = 9.0;

const float PINCH_MASS = 4.2;
const float PINCH_CORE = 0.3;
const float PINCH_RADIUS = 0.8;
const float PINCH_INFLOW = 0.45;
const float PINCH_STEERING = 3.0;

const float SHOCK_REACH = 2.2;
const float SHOCK_WIDTH = 0.55;
const float SHOCK_GAIN = 14.0;
// An exploding fist throws matter harder and farther than a released pinch.
const float BLAST_GAIN = 1.5;
const float BLAST_REACH = 1.25;
// While a fist explodes, speed is capped lower: most of the cloud sits in the fist and
// takes the full kick at once, and uncapped it would fly out past the camera.
const float BLAST_MAX_SPEED = 2.0;

const float DRAG_RADIUS = 0.75;
const float DRAG_GAIN = 1.6;

const float CARRY_RADIUS = 0.45;
const float CARRY_RATE = 14.0;
// Share of the hand's speed that carried matter reaches; slightly under 1 keeps the
// wake trailing the hand instead of piling up in front of it.
const float CARRY_SHARE = 0.85;

// Gathering into a hand: particles travel with their spot on its surface and close
// the gap to it at a speed proportional to the gap, spiralling in around the palm
// normal while far away.
const float SCULPT_STIFFNESS = 5.0;
const float SCULPT_SWIRL = 1.6;
const float SCULPT_MAX_SPEED = 5.5;
const float SCULPT_RATE = 12.0;
// Share of the carrier flow left on settled particles, so the surface shimmers.
const float SCULPT_SHIMMER = 0.35;
// Thickness of the layer of particles across the skin, in world units.
const float SCULPT_SKIN = 0.012;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/** Texel of a vertex of the hand model in the skinned vertex textures. */
ivec2 handTexel(int hand, float index) {
  int vertex = int(index + 0.5);
  return ivec2(vertex % HAND_VERTEX_WIDTH, hand * int(uHandRows + 0.5) + vertex / HAND_VERTEX_WIDTH);
}

/**
 * The particle's own fixed spot on the skin of the hand model: a triangle drawn from
 * the area-weighted table, then a point inside it. The spot is expressed on the posed
 * mesh, so settled particles stick to the hand like a skin as it moves and bends.
 */
vec3 sculptTarget(int hand, vec2 cell, out vec3 targetVelocity) {
  int pick = int(sculptHash(cell, 3u) * float(HAND_SAMPLE_SIZE * HAND_SAMPLE_SIZE));
  vec3 triangle = texelFetch(uHandSamples, ivec2(pick % HAND_SAMPLE_SIZE, pick / HAND_SAMPLE_SIZE), 0).xyz;
  ivec2 ta = handTexel(hand, triangle.x);
  ivec2 tb = handTexel(hand, triangle.y);
  ivec2 tc = handTexel(hand, triangle.z);
  vec3 a = texelFetch(uHandVertices, ta, 0).xyz;
  vec3 b = texelFetch(uHandVertices, tb, 0).xyz;
  vec3 c = texelFetch(uHandVertices, tc, 0).xyz;

  float u = sculptHash(cell, 4u);
  float v = sculptHash(cell, 5u);
  if (u + v > 1.0) {
    u = 1.0 - u;
    v = 1.0 - v;
  }
  // A slight spread across the surface gives the skin some depth instead of a shell.
  vec3 normal = cross(b - a, c - a);
  normal /= max(length(normal), 1e-9);
  float depth = (sculptHash(cell, 6u) - 0.5) * SCULPT_SKIN;
  vec3 va = texelFetch(uHandVelocities, ta, 0).xyz;
  targetVelocity = va + (texelFetch(uHandVelocities, tb, 0).xyz - va) * u
    + (texelFetch(uHandVelocities, tc, 0).xyz - va) * v;
  return a + (b - a) * u + (c - a) * v + normal * depth;
}

void main() {
  vec4 state = texture2D(uPosition, vUv);
  vec4 motion = texture2D(uVelocity, vUv);
  vec3 location = state.xyz;
  vec3 velocity = motion.xyz;
  float phase = motion.w;

  // Two octaves of curl noise; each octave is divergence-free, so is their sum.
  vec3 flow = curlNoise(location * 0.55 + vec3(0.0, 0.0, uTime * 0.07));
  flow += 0.5 * curlNoise(location * 1.4 + vec3(uTime * 0.11, 17.0, 0.0));
  float flowMagnitude = length(flow);
  flow *= FLOW_SPEED * uTurbulence * (1.0 + 0.3 * sin(TAU * phase));

  // Each force point contributes a well, a shockwave and a drag term. The wells
  // are summed first because their total decides how loosely matter couples to the
  // carrier flow.
  float wells[FORCE_COUNT];
  float wellTotal = 0.0;
  for (int i = 0; i < FORCE_COUNT; i++) {
    vec3 offset = location - uForcePosition[i];
    wells[i] = uForceDrive[i].x * exp(-dot(offset, offset) / (PINCH_RADIUS * PINCH_RADIUS));
    wellTotal += wells[i];
  }
  wellTotal = min(wellTotal, 1.0);

  // Stokes drag toward the carrier flow. Each particle has its own response time, so
  // the cloud behaves like inertial tracers and concentrates into filaments between
  // vortices. Inside a pinch well the coupling loosens so orbits keep their speed.
  float responseTime = mix(0.25, 0.7, hash(vUv));
  float coupling = (1.0 - exp(-uDelta / responseTime)) * (1.0 - 0.92 * wellTotal);
  velocity += (flow - velocity) * coupling;

  vec3 acceleration = vec3(0.0);
  float speedLimit = MAX_SPEED;

  // Harmonic confinement acts only past the rest radius, leaving the interior flow
  // incompressible while pulling escapees back with a spring force.
  float radius = length(location);
  float excess = max(radius - REST_RADIUS, 0.0);
  acceleration -= location * (CONFINEMENT_STIFFNESS * excess / max(radius, 1e-4));

  for (int i = 0; i < FORCE_COUNT; i++) {
    vec3 toParticle = location - uForcePosition[i];
    float dist = length(toParticle);
    vec3 radial = toParticle / max(dist, 1e-4);
    float well = wells[i];

    // Pinch: Plummer-softened gravity well, a = -GM r / (r^2 + e^2)^(3/2). The
    // matching circular orbital speed is v_c(r) = r sqrt(GM / (r^2 + e^2)^(3/2)).
    // Steering toward v_c along the tangent (axis x radial) with a slow inward drift
    // feeds the cloud angular momentum, so it spirals into a dense disc instead of
    // collapsing to a point.
    float softened = dist * dist + PINCH_CORE * PINCH_CORE;
    float gravity = PINCH_MASS / (softened * sqrt(softened));
    vec3 tangent = cross(uForceAxis[i], radial);
    vec3 orbit = tangent * dist * sqrt(gravity)
      - radial * PINCH_INFLOW * smoothstep(PINCH_CORE, 3.0 * PINCH_CORE, dist);
    acceleration -= toParticle * gravity * well;
    velocity += (orbit - velocity) * well * (1.0 - exp(-uDelta * PINCH_STEERING));

    // Shockwave: the impulse decays from 1 to 0 on the CPU, so (1 - impulse) is the
    // normalized age of the blast. A Gaussian shell rides the expanding front and
    // kicks whatever it sweeps over radially outward.
    float impulse = uForceDrive[i].y;
    float blast = uForceCharge[i].z;
    speedLimit = min(speedLimit, mix(MAX_SPEED, BLAST_MAX_SPEED, blast));
    float front = (1.0 - impulse) * SHOCK_REACH * mix(1.0, BLAST_REACH, blast);
    float shell = exp(-pow((dist - front) / (SHOCK_WIDTH * mix(1.0, BLAST_REACH, blast)), 2.0));
    acceleration += radial * impulse * SHOCK_GAIN * mix(1.0, BLAST_GAIN, blast) * shell;

    // Translation. A pushing point accelerates nearby fluid along its velocity. A
    // carrying point (a tracked hand) instead brings nearby particles up to its own
    // velocity along its direction of travel and damps their sideways drift, so the
    // fluid travels with the hand and a wide sweep drags a wide wake. A still hand
    // leaves the flow alone.
    vec3 handVelocity = uForceVelocity[i];
    float handSpeed = length(handVelocity);
    float carry = uForceDrive[i].z;
    float reach = exp(-dist * dist / (DRAG_RADIUS * DRAG_RADIUS));
    acceleration += handVelocity * DRAG_GAIN * reach * (1.0 - carry);
    if (carry > 0.0 && handSpeed > 1e-3) {
      vec3 heading = handVelocity / handSpeed;
      float wake = CARRY_RADIUS * (1.0 + 0.6 * min(handSpeed / 4.0, 1.0));
      float grip = carry * smoothstep(0.1, 0.6, handSpeed) * exp(-dist * dist / (wake * wake))
        * (1.0 - exp(-uDelta * CARRY_RATE));
      float along = dot(velocity, heading);
      vec3 across = velocity - heading * along;
      velocity += heading * (CARRY_SHARE * handSpeed - along) * grip - across * grip * 0.5;
    }
  }

  // Sculpt: an open hand draws its share of particles onto its own surface and keeps
  // them there as it moves. Their pull overrides the other forces in proportion to
  // how settled they are.
  vec2 cell = floor(gl_FragCoord.xy);
  float hold;
  int hand = sculptHand(cell, uForceDrive, hold);
  if (hand >= 0 && hold > 0.0) {
    vec3 targetVelocity;
    vec3 target = sculptTarget(hand, cell, targetVelocity);
    // A charging fist squeezes toward the palm center, tighter on each beat.
    float charge = uForceCharge[hand].x;
    vec3 center = uForcePosition[hand];
    target = center + (target - center) * (1.0 - CHARGE_SQUEEZE * charge * (0.6 + 0.4 * uForceCharge[hand].y));
    vec3 toTarget = target - location;
    float gap = length(toTarget);
    vec3 seek = toTarget * SCULPT_STIFFNESS
      + cross(uForceAxis[hand], toTarget) * SCULPT_SWIRL * smoothstep(0.05, 0.8, gap);
    seek *= min(1.0, SCULPT_MAX_SPEED / max(length(seek), 1e-4));
    acceleration *= 1.0 - hold;
    velocity = mix(velocity, targetVelocity + seek + flow * SCULPT_SHIMMER, hold * (1.0 - exp(-uDelta * SCULPT_RATE)));
    // Tremor: a random kick drawn anew 40 times a second, growing with the charge.
    if (charge > 0.0) {
      uint tick = uint(uTime * 40.0) * 3u + 16u;
      vec3 kick = vec3(sculptHash(cell, tick), sculptHash(cell, tick + 1u), sculptHash(cell, tick + 2u)) - 0.5;
      velocity += kick * CHARGE_TREMOR * charge * charge * hold;
    }
  }

  velocity += acceleration * uDelta;
  velocity *= min(1.0, speedLimit / max(length(velocity), 1e-4));

  phase = fract(phase + uDelta * (0.08 + 0.06 * flowMagnitude));

  gl_FragColor = vec4(velocity, phase);
}
