uniform float uExtent;

varying vec2 vPoint;

void main() {
  // Billboard: the quad is laid out in view space around the transformed origin, so
  // the reticle always faces the camera whatever the orbit angle.
  vPoint = position.xy;
  vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  center.xy += position.xy * uExtent;
  gl_Position = projectionMatrix * center;
}
