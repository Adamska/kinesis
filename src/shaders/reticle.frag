uniform float uPresence;
uniform float uPinch;
uniform float uImpulse;
uniform float uSpin;
uniform vec3 uColor;

varying vec2 vPoint;

const float TAU = 6.283185307179586;
// Ring radii in quad units; the quad spans [-1, 1] and the shockwave ring needs room.
const float RING_OPEN = 0.24;
const float RING_CLOSED = 0.11;
const float BLAST_REACH = 0.95;

// Antialiased hairline of roughly one device pixel at distance `d` from a curve.
float hairline(float d, float width) {
  float pixel = fwidth(d);
  return 1.0 - smoothstep(width * pixel, (width + 1.0) * pixel, abs(d));
}

void main() {
  float radius = length(vPoint);
  float angle = atan(vPoint.y, vPoint.x);

  float ring = mix(RING_OPEN, RING_CLOSED, uPinch);
  float light = 0.55 * hairline(radius - ring, 0.6);

  // Four ticks outside the ring rotate with the well's spin.
  float ticks = hairline(sin(2.0 * (angle - uSpin)) * cos(2.0 * (angle - uSpin)) * radius, 0.8);
  float tickBand = step(ring + 0.025, radius) * step(radius, ring + 0.075);
  light += 0.7 * ticks * tickBand;

  // The core fills in as the pinch closes.
  light += uPinch * 0.6 * (1.0 - smoothstep(0.0, 0.035, radius));

  // A blast ring expands to the edge of the quad and fades out as it travels.
  float blastRadius = mix(ring, BLAST_REACH, 1.0 - uImpulse);
  light += uImpulse * hairline(radius - blastRadius, 1.2);

  float alpha = light * uPresence * (1.0 - smoothstep(0.96, 1.0, radius));
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor, alpha);
}
