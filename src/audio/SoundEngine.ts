const MASTER_LEVEL = 0.55
const GLIDE = 0.08

export interface SoundState {
  /** Speed of the fastest force point, in world units per second. */
  speed: number
  pinch: number
  impulse: number
  /** Horizontal position of the dominant force point in [-1, 1], for panning. */
  pan: number
  turbulence: number
}

function createNoise(context: AudioContext): AudioBufferSourceNode {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  return source
}

/**
 * Generative score driven by the force field. A detuned drone opens up with the flow,
 * filtered noise follows the stirring speed and pans with it, a sub tone deepens as a
 * pinch closes, and every shockwave fires a sweeping blast with a sub thump.
 */
export class SoundEngine {
  readonly context = new AudioContext()

  private readonly master = this.context.createGain()
  private readonly droneFilter = this.context.createBiquadFilter()
  private readonly stirFilter = this.context.createBiquadFilter()
  private readonly stirGain = this.context.createGain()
  private readonly stirPan = this.context.createStereoPanner()
  private readonly well = this.context.createOscillator()
  private readonly wellGain = this.context.createGain()
  private readonly sources: AudioScheduledSourceNode[] = []
  private previousImpulse = 0

  constructor() {
    const { context } = this
    const compressor = context.createDynamicsCompressor()
    this.master.gain.value = 0
    this.master.connect(compressor).connect(context.destination)

    const droneGain = context.createGain()
    droneGain.gain.value = 0.05
    this.droneFilter.type = 'lowpass'
    this.droneFilter.Q.value = 4
    this.droneFilter.connect(droneGain).connect(this.master)
    for (const [type, frequency, detune] of [
      ['sawtooth', 55, -7],
      ['sawtooth', 55, 7],
      ['triangle', 110, 0],
    ] as const) {
      const oscillator = context.createOscillator()
      oscillator.type = type
      oscillator.frequency.value = frequency
      oscillator.detune.value = detune
      oscillator.connect(this.droneFilter)
      this.sources.push(oscillator)
    }

    const noise = createNoise(context)
    this.stirFilter.type = 'bandpass'
    this.stirFilter.Q.value = 1.2
    this.stirGain.gain.value = 0
    noise.connect(this.stirFilter).connect(this.stirGain).connect(this.stirPan).connect(this.master)
    this.sources.push(noise)

    this.well.type = 'sine'
    this.wellGain.gain.value = 0
    this.well.connect(this.wellGain).connect(this.master)
    this.sources.push(this.well)

    this.sources.forEach((source) => source.start())
    this.master.gain.setTargetAtTime(MASTER_LEVEL, context.currentTime, 0.4)
  }

  update({ speed, pinch, impulse, pan, turbulence }: SoundState): void {
    const now = this.context.currentTime
    const motion = Math.min(speed / 5, 1)
    this.droneFilter.frequency.setTargetAtTime(180 + 900 * motion + 300 * turbulence, now, 0.3)
    this.stirFilter.frequency.setTargetAtTime(350 + 2200 * motion, now, GLIDE)
    this.stirGain.gain.setTargetAtTime(0.16 * motion * motion, now, GLIDE)
    this.stirPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)) * 0.8, now, GLIDE)
    this.well.frequency.setTargetAtTime(38 + 30 * pinch, now, 0.2)
    this.wellGain.gain.setTargetAtTime(0.32 * pinch * pinch, now, 0.15)

    if (impulse > 0.9 && this.previousImpulse <= 0.9) this.blast(pan)
    this.previousImpulse = impulse
  }

  /** One-shot: a noise burst through a closing lowpass, layered with a falling sine. */
  private blast(pan: number): void {
    const { context } = this
    const now = context.currentTime
    const panner = context.createStereoPanner()
    panner.pan.value = Math.max(-1, Math.min(1, pan)) * 0.6
    panner.connect(this.master)

    const noise = createNoise(context)
    const filter = context.createBiquadFilter()
    const noiseGain = context.createGain()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(5000, now)
    filter.frequency.exponentialRampToValueAtTime(160, now + 0.9)
    noiseGain.gain.setValueAtTime(0.5, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.1)
    noise.connect(filter).connect(noiseGain).connect(panner)

    const thump = context.createOscillator()
    const thumpGain = context.createGain()
    thump.frequency.setValueAtTime(95, now)
    thump.frequency.exponentialRampToValueAtTime(30, now + 0.5)
    thumpGain.gain.setValueAtTime(0.7, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
    thump.connect(thumpGain).connect(panner)

    noise.start(now)
    noise.stop(now + 1.2)
    thump.start(now)
    thump.stop(now + 0.7)
    noise.onended = () => panner.disconnect()
  }

  async dispose(): Promise<void> {
    this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.1)
    await new Promise((resolve) => window.setTimeout(resolve, 300))
    this.sources.forEach((source) => source.stop())
    await this.context.close()
  }
}
