uniform vec3 uPaletteA;
uniform vec3 uPaletteB;
uniform vec3 uPaletteC;
uniform vec3 uPaletteD;

varying vec2 vAxis;
varying float vStretch;
varying float vTone;
varying float vIntensity;
varying float vOpacity;

const float TAU = 6.283185307179586;

// Inigo Quilez cosine palette: color(t) = a + b * cos(2 pi (c t + d)).
vec3 palette(float t) {
  return uPaletteA + uPaletteB * cos(TAU * (uPaletteC * t + uPaletteD));
}

void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  point.y = -point.y;

  // The sprite was enlarged by vStretch on both axes. Compressing the axis
  // perpendicular to screen-space velocity by the same factor leaves an ellipse
  // elongated along the direction of travel.
  float along = dot(point, vAxis);
  float across = dot(point, vec2(-vAxis.y, vAxis.x)) * vStretch;
  float r2 = along * along + across * across;
  if (r2 > 1.0) discard;

  float core = exp(-9.0 * r2);
  float halo = 0.18 * (1.0 - r2) * (1.0 - r2);
  vec3 color = max(palette(vTone), 0.0) * vIntensity;

  gl_FragColor = vec4(color, (core + halo) * vOpacity);
}
