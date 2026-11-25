uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform vec2 uResolution;
uniform float uParticleSize;
uniform float uDensityGain;
uniform float uFocusDistance;
uniform float uAperture;
uniform float uStateSize;
// Only w, the sculpt progress, is read here (see sculpt.glsl).
uniform vec4 uForceDrive[FORCE_COUNT];
uniform vec3 uForcePosition[FORCE_COUNT];
// Only x, the overload charge, is read here.
uniform vec3 uForceCharge[FORCE_COUNT];

varying vec2 vAxis;
varying float vStretch;
varying float vTone;
varying float vIntensity;
varying float vOpacity;
varying float vDefocus;

const float TAU = 6.283185307179586;
const float MIN_POINT_SIZE = 2.0;
const float STRETCH_GAIN = 0.55;
const float MAX_STRETCH = 4.0;
const float MAX_BOKEH_GROWTH = 1.6;
// Depth shading of a sculpted hand, in world units in front of (positive) or behind
// its palm center: the near skin is drawn at full strength and the far skin fades,
// so the palm, the back and the edge of the hand read apart as it turns.
const float SHADE_NEAR = 0.12;
const float SHADE_FAR = -0.22;
const float SHADE_FLOOR = 0.3;

void main() {
  // The position attribute is repurposed: xy addresses this particle's texel in the
  // state textures and z carries a per-particle random seed.
  vec4 state = texture2D(uPositions, position.xy);
  vec4 motion = texture2D(uVelocities, position.xy);
  float seed = position.z;

  vec4 viewPosition = modelViewMatrix * vec4(state.xyz, 1.0);
  gl_Position = projectionMatrix * viewPosition;

  vec3 viewVelocity = mat3(modelViewMatrix) * motion.xyz;
  float planarSpeed = length(viewVelocity.xy);
  vAxis = planarSpeed > 1e-4 ? viewVelocity.xy / planarSpeed : vec2(1.0, 0.0);
  vStretch = 1.0 + min(planarSpeed * STRETCH_GAIN, MAX_STRETCH - 1.0);

  // projectionMatrix[1][1] = cot(fov / 2), so this is the on-screen height in pixels
  // of one world unit at the particle's depth.
  float pixelsPerUnit = projectionMatrix[1][1] * uResolution.y * 0.5 / max(-viewPosition.z, 0.1);
  float diameter = uParticleSize * mix(0.6, 1.4, seed) * pixelsPerUnit;

  // Thin-lens depth of field: the circle of confusion grows linearly with distance
  // from the focal plane. Out-of-focus particles become wider, dimmer discs.
  float confusion = abs(-viewPosition.z - uFocusDistance) * uAperture * pixelsPerUnit;
  float blurred = min(diameter + confusion, diameter * MAX_BOKEH_GROWTH + MIN_POINT_SIZE);
  vDefocus = clamp(confusion / max(blurred, 1e-3), 0.0, 1.0);
  float size = max(blurred, MIN_POINT_SIZE);
  gl_PointSize = size * vStretch;

  float speed = length(motion.xyz);
  float heat = 1.0 - exp(-state.w * 0.45);
  vTone = clamp(0.05 + 0.5 * min(speed / 1.2, 1.0) + 0.5 * heat + 0.1 * (seed - 0.5), 0.0, 1.0);

  float shimmer = 0.8 + 0.2 * sin(TAU * (motion.w + seed));
  vIntensity = (1.1 + 1.6 * heat * heat) * shimmer;

  // Sprites below MIN_POINT_SIZE are clamped up, defocus widens them and stretching
  // spreads them over a streak. Scaling opacity by the area ratios keeps emitted light
  // constant.
  vOpacity = (diameter * diameter) / (size * size) / vStretch * uDensityGain;

  // Particles settled on a sculpted hand are packed densely; dim them to match.
  float hold;
  int hand = sculptHand(floor(position.xy * uStateSize), uForceDrive, hold);
  if (hand >= 0) {
    float relief = viewPosition.z - (modelViewMatrix * vec4(uForcePosition[hand], 1.0)).z;
    float shade = mix(SHADE_FLOOR, 1.0, smoothstep(SHADE_FAR, SHADE_NEAR, relief));
    vOpacity *= mix(1.0, mix(SCULPT_DIM, CHARGE_DIM, uForceCharge[hand].x) * shade, hold);
  }
}
