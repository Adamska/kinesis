uniform sampler2D uSeed;

varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(uSeed, vUv);
}
