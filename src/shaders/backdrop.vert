varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  // Drawn at the far plane in clip space, so it always fills the screen behind everything.
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
