uniform sampler2D inputBuffer;
// Per force point. Lens: xy = center in uv, z = Einstein radius, w = horizon opacity.
uniform vec4 uLens[FORCE_COUNT];
// Ripple: xy = center in uv, z = radius of the blast front, w = amplitude.
uniform vec4 uRipple[FORCE_COUNT];
uniform float uAspect;

varying vec2 vUv;

const float RIPPLE_WIDTH = 0.035;
const float RIPPLE_SHIFT = 0.018;
const float CHROMA_SHIFT = 0.006;

void main() {
  // Distances are measured in units of screen height so circles stay circular.
  vec2 aspect = vec2(uAspect, 1.0);
  vec2 offset = vec2(0.0);
  float chroma = 0.0;
  float shade = 1.0;

  for (int i = 0; i < FORCE_COUNT; i++) {
    // Thin point-mass lens: an image at angle theta shows the source at
    // beta = theta - thetaE^2 / theta, so light is pulled toward the mass and an
    // Einstein ring forms at thetaE. The deflection is capped inside the ring and
    // faded far outside it so the rest of the frame stays put.
    vec2 d = (vUv - uLens[i].xy) * aspect;
    float r = length(d) + 1e-5;
    float einstein = uLens[i].z;
    float deflection = einstein * einstein / max(r, 0.5 * einstein);
    deflection *= exp(-r * r / (16.0 * einstein * einstein + 1e-6));
    offset -= (d / r) * deflection / aspect;
    shade *= mix(1.0, smoothstep(0.22 * einstein, 0.5 * einstein, r), uLens[i].w);

    // The shockwave front refracts what lies behind it, with a slight color split.
    vec2 q = (vUv - uRipple[i].xy) * aspect;
    float rq = length(q) + 1e-5;
    float band = exp(-pow((rq - uRipple[i].z) / RIPPLE_WIDTH, 2.0)) * uRipple[i].w;
    offset += (q / rq) * band * RIPPLE_SHIFT / aspect;
    chroma += band;
  }

  vec2 source = vUv + offset;
  vec2 split = (length(offset) > 1e-6 ? normalize(offset) : vec2(0.0)) * chroma * CHROMA_SHIFT;
  vec4 center = texture2D(inputBuffer, source);
  float red = texture2D(inputBuffer, source + split).r;
  float blue = texture2D(inputBuffer, source - split).b;
  gl_FragColor = vec4(vec3(red, center.g, blue) * shade, center.a);
}
