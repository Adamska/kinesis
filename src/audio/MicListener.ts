const FFT_SIZE = 1024
const LOW_BAND_HZ = 300
const ATTACK_RATE = 30
const RELEASE_RATE = 4
const FLOOR_RISE_RATE = 0.5
const FLOOR_FALL_RATE = 8
const ONSET_HEADROOM = 0.2
const ONSET_FLUX = 0.08
const ONSET_COOLDOWN_MS = 250

/**
 * Microphone envelope follower. It blends low-band energy, where beats live, with
 * broadband loudness, where claps and voices live. An onset is a sharp rise between
 * two samples that also clears the noise floor, which falls fast and rises slowly so
 * a steady beat does not lift it out of reach.
 */
export class MicListener {
  level = 0

  private readonly context: AudioContext
  private readonly stream: MediaStream
  private readonly analyser: AnalyserNode
  private readonly spectrum: Uint8Array<ArrayBuffer>
  private readonly lowBins: number
  private floor = 0
  private previousEnergy = 0
  private lastOnset = 0

  private constructor(stream: MediaStream) {
    this.stream = stream
    this.context = new AudioContext()
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = FFT_SIZE
    this.analyser.smoothingTimeConstant = 0.5
    this.context.createMediaStreamSource(stream).connect(this.analyser)
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount)
    this.lowBins = Math.max(2, Math.round((LOW_BAND_HZ / this.context.sampleRate) * FFT_SIZE))
  }

  static async open(): Promise<MicListener> {
    // Echo cancellation removes the page's own synth from the input, so a shockwave's
    // sound can never trigger the next shockwave.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      video: false,
    })
    return new MicListener(stream)
  }

  /** Advances the follower; returns true when an onset fires on this sample. */
  sample(delta: number, now: number): boolean {
    this.analyser.getByteFrequencyData(this.spectrum)
    let low = 0
    let full = 0
    for (let bin = 1; bin < this.spectrum.length; bin++) {
      const value = this.spectrum[bin] / 255
      full += value
      if (bin <= this.lowBins) low += value
    }
    const energy = Math.min(0.6 * (low / this.lowBins) + 0.4 * (full / (this.spectrum.length - 1)) * 2.5, 1)

    const rate = energy > this.level ? ATTACK_RATE : RELEASE_RATE
    this.level += (energy - this.level) * (1 - Math.exp(-delta * rate))
    const floorRate = energy > this.floor ? FLOOR_RISE_RATE : FLOOR_FALL_RATE
    this.floor += (energy - this.floor) * (1 - Math.exp(-delta * floorRate))

    const flux = energy - this.previousEnergy
    this.previousEnergy = energy
    const onset =
      flux > ONSET_FLUX && energy - this.floor > ONSET_HEADROOM && now - this.lastOnset > ONSET_COOLDOWN_MS
    if (onset) this.lastOnset = now
    return onset
  }

  dispose(): void {
    this.stream.getTracks().forEach((track) => track.stop())
    void this.context.close()
  }
}
