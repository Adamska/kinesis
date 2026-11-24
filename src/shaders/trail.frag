uniform sampler2D inputBuffer;
uniform sampler2D uHistory;
uniform float uPersistence;

varying vec2 vUv;

void main() {
  vec4 current = texture2D(inputBuffer, vUv);
  // A max blend keeps a fading copy of every bright pixel without adding light: a
  // particle at rest looks unchanged, while a moving one leaves a decaying streak.
  vec3 afterglow = texture2D(uHistory, vUv).rgb * uPersistence;
  gl_FragColor = vec4(max(current.rgb, afterglow), current.a);
}
