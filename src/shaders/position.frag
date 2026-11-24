uniform sampler2D uPosition;
uniform sampler2D uVelocity;
uniform float uDelta;
uniform vec3 uForcePosition[FORCE_COUNT];
// x = pinch strength, y = shockwave impulse, z = presence of a user steering it.
uniform vec3 uForceDrive[FORCE_COUNT];

varying vec2 vUv;

const float ESCAPE_RADIUS = 6.0;
const float FIELD_RADIUS = 0.7;
const float ENERGY_CEILING = 16.0;

void main() {
  vec4 state = texture2D(uPosition, vUv);
  vec3 velocity = texture2D(uVelocity, vUv).xyz;

  vec3 location = state.xyz + velocity * uDelta;
  location *= min(1.0, ESCAPE_RADIUS / max(length(location), 1e-4));

  float excitation = 0.5 * dot(velocity, velocity);
  for (int i = 0; i < FORCE_COUNT; i++) {
    vec3 toParticle = location - uForcePosition[i];
    float proximity = exp(-dot(toParticle, toParticle) / (FIELD_RADIUS * FIELD_RADIUS));
    excitation += 2.0 * proximity * max(uForceDrive[i].x, uForceDrive[i].y);
  }

  // Energy charges fast and bleeds off slowly, so wakes stay luminous for a moment
  // after the force field has moved on.
  float rate = excitation > state.w ? 10.0 : 2.2;
  float energy = mix(state.w, excitation, 1.0 - exp(-uDelta * rate));

  gl_FragColor = vec4(location, min(energy, ENERGY_CEILING));
}
