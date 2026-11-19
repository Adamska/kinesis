// Exponential smoothing factor for a first-order low-pass with cutoff fc sampled every
// dt seconds: alpha = 1 / (1 + tau / dt) with time constant tau = 1 / (2 pi fc).
function smoothingFactor(cutoff: number, dt: number): number {
  const rate = 2 * Math.PI * cutoff * dt
  return rate / (rate + 1)
}

/**
 * One Euro filter (Casiez, Roussel and Vogel, CHI 2012): exponential smoothing whose
 * cutoff rises with the speed of the signal. A resting hand is held steady, while a
 * moving hand is followed with very little lag.
 */
export class OneEuroFilter {
  private readonly minCutoff: number
  private readonly beta: number
  private readonly derivativeCutoff: number
  private value = 0
  private derivative = 0
  private primed = false

  constructor(minCutoff: number, beta: number, derivativeCutoff = 1) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.derivativeCutoff = derivativeCutoff
  }

  filter(sample: number, dt: number): number {
    if (!this.primed || dt <= 0) {
      this.primed = true
      this.value = sample
      this.derivative = 0
      return sample
    }
    const rate = (sample - this.value) / dt
    this.derivative += (rate - this.derivative) * smoothingFactor(this.derivativeCutoff, dt)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative)
    this.value += (sample - this.value) * smoothingFactor(cutoff, dt)
    return this.value
  }

  reset(): void {
    this.primed = false
  }
}
