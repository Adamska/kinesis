const CAPACITY = 4
const DEFAULT_INTERVAL_MS = 1000 / 30
const INTERVAL_SMOOTHING = 0.1
// When a frame is late, the path is extrapolated past the newest sample for at most
// this share of a frame interval. Playing back closer to the newest sample than one
// interval would extrapolate on every frame and turn the motion jerky.
const MAX_OVERRUN = 0.5

/**
 * Timestamped trail of filtered palm positions. Camera frames arrive at about 30 Hz
 * while the screen refreshes at 60 Hz or more, so the hand is sampled between frames
 * on a Catmull-Rom spline through the last four positions, played back one frame
 * interval behind the newest one. The motion is continuous and passes exactly through
 * every measured position, with no overshoot when the hand stops.
 */
export class HandPath {
  private readonly times = new Float64Array(CAPACITY)
  private readonly xs = new Float64Array(CAPACITY)
  private readonly ys = new Float64Array(CAPACITY)
  private count = 0
  private interval = DEFAULT_INTERVAL_MS

  push(time: number, x: number, y: number): void {
    if (this.count > 0) {
      const gap = time - this.times[CAPACITY - 1]
      if (gap <= 0) return
      this.interval += (Math.min(gap, 100) - this.interval) * INTERVAL_SMOOTHING
    }
    this.times.copyWithin(0, 1)
    this.xs.copyWithin(0, 1)
    this.ys.copyWithin(0, 1)
    this.times[CAPACITY - 1] = time
    this.xs[CAPACITY - 1] = x
    this.ys[CAPACITY - 1] = y
    this.count = Math.min(this.count + 1, CAPACITY)
  }

  reset(): void {
    this.count = 0
    this.interval = DEFAULT_INTERVAL_MS
  }

  /** Writes the interpolated position at `now` into `out` as [x, y]. */
  sample(now: number, out: [number, number]): [number, number] {
    const last = CAPACITY - 1
    if (this.count < 2) return this.fill(out, last)

    const time = now - this.interval
    // Find the segment [k, k + 1] that contains the playback time.
    let k = last - 1
    while (k > CAPACITY - this.count && time < this.times[k]) k--
    const t0 = this.times[k]
    const t1 = this.times[k + 1]
    const span = Math.max(t1 - t0, 1)
    const u = Math.min(Math.max((time - t0) / span, 0), 1 + MAX_OVERRUN)

    if (u > 1) {
      // Playback has run past the newest sample: continue along the last segment.
      const reach = u - 1
      out[0] = this.xs[last] + (this.xs[last] - this.xs[last - 1]) * reach
      out[1] = this.ys[last] + (this.ys[last] - this.ys[last - 1]) * reach
      return out
    }
    const before = Math.max(k - 1, CAPACITY - this.count)
    const after = Math.min(k + 2, last)
    out[0] = catmullRom(this.xs[before], this.xs[k], this.xs[k + 1], this.xs[after], u)
    out[1] = catmullRom(this.ys[before], this.ys[k], this.ys[k + 1], this.ys[after], u)
    return out
  }

  private fill(out: [number, number], index: number): [number, number] {
    out[0] = this.xs[index]
    out[1] = this.ys[index]
    return out
  }
}

/** Uniform Catmull-Rom spline between p1 and p2, with p0 and p3 as neighbors. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u
  return 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u2 * u)
}
