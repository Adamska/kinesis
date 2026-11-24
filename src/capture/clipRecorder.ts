const MAX_CLIP_SECONDS = 8
const CAPTURE_FPS = 60
const BITS_PER_SECOND = 10_000_000
// Ordered by preference: MP4 plays everywhere a clip gets shared; WebM is the fallback.
const MIME_TYPES = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

type Listener = (recording: boolean) => void

let canvas: HTMLCanvasElement | null = null
let recorder: MediaRecorder | null = null
let startedAt = 0
let stopTimer = 0
const listeners = new Set<Listener>()

/** The renderer's canvas registers itself here once the WebGL context exists. */
export function registerCaptureCanvas(element: HTMLCanvasElement | null): void {
  canvas = element
}

export function canRecordClips(): boolean {
  return typeof MediaRecorder !== 'undefined' && MIME_TYPES.some((type) => MediaRecorder.isTypeSupported(type))
}

export function onRecordingChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Seconds left before the clip stops on its own, or null when idle. */
export function remainingSeconds(): number | null {
  return recorder ? Math.max(MAX_CLIP_SECONDS - (performance.now() - startedAt) / 1000, 0) : null
}

function save(blob: Blob, mimeType: string): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `kinesis-${stamp}.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
}

/** Records the rendered canvas, without the interface, for up to eight seconds. */
export function startRecording(): void {
  const mimeType = MIME_TYPES.find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type))
  if (recorder || !canvas || !mimeType) return

  const stream = canvas.captureStream(CAPTURE_FPS)
  const chunks: Blob[] = []
  const instance = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: BITS_PER_SECOND })
  instance.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  instance.onstop = () => {
    stream.getTracks().forEach((track) => track.stop())
    if (chunks.length > 0) save(new Blob(chunks, { type: mimeType }), mimeType)
  }
  instance.start()
  recorder = instance
  startedAt = performance.now()
  stopTimer = window.setTimeout(stopRecording, MAX_CLIP_SECONDS * 1000)
  listeners.forEach((listener) => listener(true))
}

export function stopRecording(): void {
  if (!recorder) return
  window.clearTimeout(stopTimer)
  recorder.stop()
  recorder = null
  listeners.forEach((listener) => listener(false))
}

export function toggleRecording(): void {
  if (recorder) stopRecording()
  else startRecording()
}
