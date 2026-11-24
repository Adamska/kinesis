uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform vec2 uResolution;
uniform float uParticleSize;
uniform float uDensityGain;

varying vec2 vAxis;
varying float vStretch;
varying float vTone;
varying float vIntensity;
varying float vOpacity;

const float TAU = 6.283185307179586;
const float MIN_POINT_SIZE = 2.0;
const float STRETCH_GAIN = 0.55;
const float MAX_STRETCH = 4.0;

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
  float size = max(diameter, MIN_POINT_SIZE);
  gl_PointSize = size * vStretch;

  float speed = length(motion.xyz);
  float heat = 1.0 - exp(-state.w * 0.45);
  vTone = clamp(0.05 + 0.5 * min(speed / 1.2, 1.0) + 0.5 * heat + 0.1 * (seed - 0.5), 0.0, 1.0);

  float shimmer = 0.8 + 0.2 * sin(TAU * (motion.w + seed));
  vIntensity = (1.1 + 1.6 * heat * heat) * shimmer;

  // Sprites below MIN_POINT_SIZE are clamped up, and stretching spreads a sprite over
  // a longer streak. Scaling opacity by both area ratios keeps emitted light constant.
  vOpacity = (diameter * diameter) / (size * size) / vStretch * uDensityGain;
}
