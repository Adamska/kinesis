uniform sampler2D uPosition;
uniform sampler2D uVelocity;
uniform float uTime;
uniform float uDelta;
uniform float uTurbulence;
uniform vec3 uForcePosition[FORCE_COUNT];
uniform vec3 uForceVelocity[FORCE_COUNT];
uniform vec3 uForceAxis[FORCE_COUNT];
// x = pinch strength, y = shockwave impulse, z = presence of a user steering it.
uniform vec3 uForceDrive[FORCE_COUNT];
// Shape morph: per-texel target positions and the global strength of the pull.
uniform sampler2D uTargets;
uniform float uMorph;
// Body obstacle: the user's person mask, mirrored and cover-fit onto the screen.
uniform sampler2D uMask;
uniform float uMaskStrength;
uniform vec2 uMaskScale;
uniform vec2 uBodyCenter;
uniform mat4 uViewProjection;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uScreenAspect;

varying vec2 vUv;

const float TAU = 6.283185307179586;

const float FLOW_SPEED = 0.1;
const float REST_RADIUS = 1.55;
const float CONFINEMENT_STIFFNESS = 6.0;
const float MAX_SPEED = 7.0;

const float PINCH_MASS = 4.2;
const float PINCH_CORE = 0.3;
const float PINCH_RADIUS = 0.8;
const float PINCH_INFLOW = 0.45;
const float PINCH_STEERING = 3.0;

const float SHOCK_REACH = 2.2;
const float SHOCK_WIDTH = 0.55;
const float SHOCK_GAIN = 14.0;

const float DRAG_RADIUS = 0.75;
const float DRAG_GAIN = 1.6;

const float MORPH_STIFFNESS = 8.0;
// Critical damping for a unit mass: c = 2 sqrt(k).
const float MORPH_DAMPING = 5.66;
const float CARVE_RADIUS = 0.55;

const float BODY_PUSH = 10.0;
const float BODY_DRAG = 3.0;
const float MASK_TEXEL = 1.0 / 48.0;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Pushes a particle out of the user's silhouette as seen from the camera. The blurred
// mask ramps up toward the body, so its negated gradient points out. Deep inside, where
// the mask is flat, the direction away from the body's centroid takes over.
vec3 bodyAcceleration(vec3 location, inout vec3 velocity) {
  vec4 clip = uViewProjection * vec4(location, 1.0);
  if (uMaskStrength < 1e-3 || clip.w <= 0.0) return vec3(0.0);
  vec2 screen = clip.xy / clip.w * 0.5 + 0.5;
  // Mirrored on x, with image v running downward.
  vec2 uv = 0.5 + (vec2(1.0) - screen - 0.5) * uMaskScale;
  float body = texture2D(uMask, uv).r * uMaskStrength;
  if (body < 0.01) return vec3(0.0);

  vec2 e = vec2(1.5 * MASK_TEXEL, 0.0);
  vec2 gradient = vec2(
    texture2D(uMask, uv + e.xy).r - texture2D(uMask, uv - e.xy).r,
    texture2D(uMask, uv + e.yx).r - texture2D(uMask, uv - e.yx).r
  );
  // Both image axes run against the screen axes, so the screen-space inward
  // direction is the negated uv gradient and outward is the gradient itself.
  vec2 away = (screen - uBodyCenter) * vec2(uScreenAspect, 1.0);
  vec2 outward = gradient * 8.0 + 0.6 * away / max(length(away), 1e-3);
  vec3 push = uCameraRight * outward.x + uCameraUp * outward.y;
  velocity *= 1.0 - min(body * BODY_DRAG * uDelta, 0.5);
  return push / max(length(push), 1e-4) * body * BODY_PUSH;
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
  float carve = 0.0;
  float blast = 0.0;
  for (int i = 0; i < FORCE_COUNT; i++) {
    vec3 offset = location - uForcePosition[i];
    float d2 = dot(offset, offset);
    wells[i] = uForceDrive[i].x * exp(-d2 / (PINCH_RADIUS * PINCH_RADIUS));
    wellTotal += wells[i];
    carve += uForceDrive[i].z * exp(-d2 / (CARVE_RADIUS * CARVE_RADIUS));
    blast = max(blast, uForceDrive[i].y);
  }
  wellTotal = min(wellTotal, 1.0);

  // How firmly this particle is held by the current shape. A force point carves a
  // hole through it, a pinch tears matter away and a shockwave releases the whole
  // shape for as long as the blast lasts; the spring then pulls everything back.
  vec4 goal = texture2D(uTargets, vUv);
  float hold = uMorph * goal.w * (1.0 - min(carve, 1.0)) * (1.0 - wellTotal) * (1.0 - 0.95 * blast);

  // Stokes drag toward the carrier flow. Each particle has its own response time, so
  // the cloud behaves like inertial tracers and concentrates into filaments between
  // vortices. Inside a pinch well the coupling loosens so orbits keep their speed.
  float responseTime = mix(0.25, 0.7, hash(vUv));
  float coupling = (1.0 - exp(-uDelta / responseTime)) * (1.0 - 0.92 * wellTotal) * (1.0 - 0.85 * hold);
  velocity += (flow - velocity) * coupling;

  vec3 acceleration = vec3(0.0);

  // Harmonic confinement acts only past the rest radius, leaving the interior flow
  // incompressible while pulling escapees back with a spring force.
  float radius = length(location);
  float excess = max(radius - REST_RADIUS, 0.0);
  acceleration -= location * (CONFINEMENT_STIFFNESS * excess / max(radius, 1e-4)) * (1.0 - hold);

  acceleration += bodyAcceleration(location, velocity);

  // Critically damped spring toward the shape: it settles without ringing.
  acceleration += (MORPH_STIFFNESS * (goal.xyz - location) - MORPH_DAMPING * velocity) * hold;

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
    float front = (1.0 - impulse) * SHOCK_REACH;
    float shell = exp(-pow((dist - front) / SHOCK_WIDTH, 2.0));
    acceleration += radial * impulse * SHOCK_GAIN * shell;

    // Translation: entrain nearby fluid along the force point's velocity.
    float reach = exp(-dist * dist / (DRAG_RADIUS * DRAG_RADIUS));
    acceleration += uForceVelocity[i] * DRAG_GAIN * reach;
  }

  velocity += acceleration * uDelta;
  velocity *= min(1.0, MAX_SPEED / max(length(velocity), 1e-4));

  phase = fract(phase + uDelta * (0.08 + 0.06 * flowMagnitude));

  gl_FragColor = vec4(velocity, phase);
}
