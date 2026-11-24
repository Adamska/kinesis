uniform vec3 uVoid;
uniform vec3 uTint;
uniform float uAspect;

varying vec2 vUv;

void main() {
  // Distance from the center in units of screen height, so the glow stays round.
  vec2 offset = (vUv - vec2(0.5, 0.46)) * vec2(uAspect, 1.0);
  float glow = exp(-dot(offset, offset) * 2.6);
  vec3 color = uVoid + uTint * glow;
  gl_FragColor = vec4(color, 1.0);
}
