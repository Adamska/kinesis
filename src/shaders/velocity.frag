uniform sampler2D uPosition;
uniform sampler2D uVelocity;
uniform float uTime;
uniform float uDelta;
uniform float uTurbulence;
uniform vec3 uHandPos;
uniform vec3 uHandVelocity;
uniform float uPinchStrength;
uniform float uShockwaveImpulse;

varying vec2 vUv;

const float TAU = 6.283185307179586;

const float FLOW_SPEED = 0.1;
const float REST_RADIUS = 1.55;
const float CONFINEMENT_STIFFNESS = 6.0;
const float MAX_SPEED = 7.0;

const vec3 ORBIT_AXIS = vec3(0.279, 0.930, 0.239);
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

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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

  vec3 toParticle = location - uHandPos;
  float dist = length(toParticle);
  vec3 radial = toParticle / max(dist, 1e-4);
  float well = uPinchStrength * exp(-dist * dist / (PINCH_RADIUS * PINCH_RADIUS));

  // Stokes drag toward the carrier flow. Each particle has its own response time, so
  // the cloud behaves like inertial tracers and concentrates into filaments between
  // vortices. Inside the pinch well the coupling loosens so orbits keep their speed.
  float responseTime = mix(0.25, 0.7, hash(vUv));
  float coupling = (1.0 - exp(-uDelta / responseTime)) * (1.0 - 0.92 * well);
  velocity += (flow - velocity) * coupling;

  vec3 acceleration = vec3(0.0);

  // Harmonic confinement acts only past the rest radius, leaving the interior flow
  // incompressible while pulling escapees back with a spring force.
  float radius = length(location);
  float excess = max(radius - REST_RADIUS, 0.0);
  acceleration -= location * (CONFINEMENT_STIFFNESS * excess / max(radius, 1e-4));

  // Pinch: Plummer-softened gravity well, a = -GM r / (r^2 + e^2)^(3/2). The matching
  // circular orbital speed is v_c(r) = r sqrt(GM / (r^2 + e^2)^(3/2)). Steering toward
  // v_c along the tangent (axis x radial) with a slow inward drift feeds the cloud
  // angular momentum, so it spirals into a dense disc instead of collapsing to a point.
  float softened = dist * dist + PINCH_CORE * PINCH_CORE;
  float gravity = PINCH_MASS / (softened * sqrt(softened));
  vec3 tangent = cross(ORBIT_AXIS, radial);
  vec3 orbit = tangent * dist * sqrt(gravity)
    - radial * PINCH_INFLOW * smoothstep(PINCH_CORE, 3.0 * PINCH_CORE, dist);
  acceleration -= toParticle * gravity * well;
  velocity += (orbit - velocity) * well * (1.0 - exp(-uDelta * PINCH_STEERING));

  // Shockwave: the impulse decays from 1 to 0 on the CPU, so (1 - impulse) is the
  // normalized age of the blast. A Gaussian shell rides the expanding front and
  // kicks whatever it sweeps over radially outward.
  float front = (1.0 - uShockwaveImpulse) * SHOCK_REACH;
  float shell = exp(-pow((dist - front) / SHOCK_WIDTH, 2.0));
  acceleration += radial * uShockwaveImpulse * SHOCK_GAIN * shell;

  // Translation: entrain nearby fluid along the hand's velocity vector.
  float reach = exp(-dist * dist / (DRAG_RADIUS * DRAG_RADIUS));
  acceleration += uHandVelocity * DRAG_GAIN * reach;

  velocity += acceleration * uDelta;
  velocity *= min(1.0, MAX_SPEED / max(length(velocity), 1e-4));

  phase = fract(phase + uDelta * (0.08 + 0.06 * flowMagnitude));

  gl_FragColor = vec4(velocity, phase);
}
