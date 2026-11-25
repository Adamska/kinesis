// Share of all particles that gather into a sculpting hand; the rest keep flowing
// around it, so the hand reads as a form inside the fluid rather than replacing it.
const float SCULPT_SHARE = 0.6;
// Particles join one after another over this share of the sculpt ramp, then take
// SCULPT_SOFTNESS of it to settle, so the hand fills in as a stream, not all at once.
const float SCULPT_SPREAD = 0.65;
const float SCULPT_SOFTNESS = 0.35;

// Brighter settled particles would saturate: a hand packs a large share of the cloud
// into a small volume, so each of them is drawn this much dimmer.
const float SCULPT_DIM = 0.2;

// Overload of a fist about to explode (charge in [0, 1], see ForceDirector): the fist
// squeezes in, trembles, heats up and throbs with a quickening heartbeat.
const float CHARGE_SQUEEZE = 0.14;
const float CHARGE_TREMOR = 1.2;
const float CHARGE_GLOW = 1.6;
// A fist packs the same particles into a third of the hand's area, so they are dimmed
// further as it charges; its heat shows in their color rather than in raw brightness.
const float CHARGE_DIM = 0.1;

/**
 * Integer hash (pcg3d) of a particle's texel and a salt, in [0, 1). Hashing the
 * integer texel rather than an interpolated coordinate gives bit-identical results
 * in the simulation passes and in the particle vertex shader.
 */
float sculptHash(vec2 cell, uint salt) {
  uvec3 v = uvec3(uvec2(cell), salt) * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return float(v.x >> 8u) / 16777216.0;
}

/**
 * Picks the hand the particle at texel `cell` gathers into and how firmly it is held
 * there, from 0 (free) to 1 (settled on the surface). Returns -1 when it stays in the
 * flow. The choice depends only on the particle and on which hands sculpt, so it is
 * stable from frame to frame and identical in every pass that reads it.
 */
int sculptHand(vec2 cell, vec4 drive[FORCE_COUNT], out float hold) {
  hold = 0.0;
  float rank = sculptHash(cell, 1u);
  if (rank >= SCULPT_SHARE) return -1;

  int count = 0;
  for (int i = 0; i < FORCE_COUNT; i++) count += drive[i].w > 0.0 ? 1 : 0;
  if (count == 0) return -1;

  // Split the recruits evenly between the hands that are sculpting.
  int slot = int(sculptHash(cell, 2u) * float(count));
  int hand = -1;
  for (int i = 0; i < FORCE_COUNT; i++) {
    if (drive[i].w <= 0.0) continue;
    if (slot == 0 && hand < 0) hand = i;
    slot--;
  }

  float joinAt = rank / SCULPT_SHARE * SCULPT_SPREAD;
  hold = smoothstep(joinAt, joinAt + SCULPT_SOFTNESS, drive[hand].w);
  return hand;
}
