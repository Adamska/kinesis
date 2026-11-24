import { useEffect, useRef } from 'react'
import { simulationBridge, useSimulationStore, type TrackedHand } from '../../store/useSimulationStore'
import { FINGERTIPS, HAND_BONES, Landmark, LANDMARK_COUNT, LANDMARK_STRIDE } from '../../vision/handTopology'
import { trackingVideo } from '../../vision/trackingSession'

const SIGNAL = '215 244 255'
const MAX_PIXEL_RATIO = 2
const FEED_OPACITY = 0.32

interface Frame {
  left: number
  top: number
  width: number
  height: number
}

/** Contain-fits a frame of the given aspect ratio inside the preview. */
function fitFrame(aspect: number, width: number, height: number): Frame {
  const frameWidth = Math.min(width, height * aspect)
  const frameHeight = frameWidth / aspect
  return { left: (width - frameWidth) / 2, top: (height - frameHeight) / 2, width: frameWidth, height: frameHeight }
}

/** Dimmed, desaturated camera image mirrored like the skeleton, so the hands line up. */
function drawFeed(context: CanvasRenderingContext2D, width: number, height: number): void {
  const video = trackingVideo()
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return
  const frame = fitFrame(video.videoWidth / video.videoHeight, width, height)
  context.save()
  context.globalAlpha = FEED_OPACITY
  context.filter = 'grayscale(1) contrast(1.15)'
  context.translate(frame.left + frame.width, frame.top)
  context.scale(-1, 1)
  context.drawImage(video, 0, 0, frame.width, frame.height)
  context.restore()
}

function drawSkeleton(context: CanvasRenderingContext2D, hand: TrackedHand, width: number, height: number): void {
  const { visible, landmarks, pinch, aspect } = hand
  if (!visible) return

  // Mirrored on x so the skeleton reads like a reflection of the user's hand.
  const frame = fitFrame(aspect, width, height)
  const px = (index: number) => frame.left + (1 - landmarks[index * LANDMARK_STRIDE]) * frame.width
  const py = (index: number) => frame.top + landmarks[index * LANDMARK_STRIDE + 1] * frame.height

  context.lineWidth = 1
  context.strokeStyle = 'rgb(255 255 255 / 0.5)'
  context.beginPath()
  for (const [from, to] of HAND_BONES) {
    context.moveTo(px(from), py(from))
    context.lineTo(px(to), py(to))
  }
  context.stroke()

  context.strokeStyle = `rgb(${SIGNAL} / ${0.25 + 0.75 * pinch})`
  context.beginPath()
  context.moveTo(px(Landmark.THUMB_TIP), py(Landmark.THUMB_TIP))
  context.lineTo(px(Landmark.INDEX_TIP), py(Landmark.INDEX_TIP))
  context.stroke()

  for (let index = 0; index < LANDMARK_COUNT; index++) {
    const isTip = (FINGERTIPS as readonly number[]).includes(index)
    const size = isTip ? 4 : 2
    context.fillStyle = isTip ? `rgb(${SIGNAL})` : 'rgb(255 255 255 / 0.85)'
    context.fillRect(px(index) - size / 2, py(index) - size / 2, size, size)
  }
}

/** Corner wireframe of the tracked 21-point hands, redrawn on its own animation frame loop. */
function FeedToggle() {
  const showFeed = useSimulationStore((state) => state.showFeed)
  const toggleFeed = useSimulationStore((state) => state.toggleFeed)

  return (
    <button
      type="button"
      aria-pressed={showFeed}
      onClick={toggleFeed}
      className={`pointer-events-auto absolute right-2 bottom-1.5 cursor-pointer uppercase transition-colors ${
        showFeed ? 'text-signal' : 'text-white/40 hover:text-white/75'
      }`}
    >
      <span className="text-white/35">[</span> Feed <span className="text-white/35">]</span>
    </button>
  )
}

export function HandSkeletonPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const statusRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)

      const pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== Math.round(width * pixelRatio)) {
        canvas.width = Math.round(width * pixelRatio)
        canvas.height = Math.round(height * pixelRatio)
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)
      if (useSimulationStore.getState().showFeed) drawFeed(context, width, height)
      const { hands } = simulationBridge
      for (const hand of hands) drawSkeleton(context, hand, width, height)

      const count = hands.filter((hand) => hand.visible).length
      const status = count === 0 ? 'No hand' : count === 1 ? 'Locked' : 'Locked x2'
      if (statusRef.current && statusRef.current.textContent !== status) {
        statusRef.current.textContent = status
      }
    }
    render()
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <figure className="w-44 border border-hairline bg-void/65 text-[10px] uppercase tracking-[0.16em] backdrop-blur-md sm:w-60">
      <figcaption className="flex justify-between border-b border-hairline px-2.5 py-1.5 whitespace-nowrap">
        <span className="text-white/40">Hands // 21 pt</span>
        <span ref={statusRef} className="text-white/85">
          No hand
        </span>
      </figcaption>
      <div className="relative">
        <canvas ref={canvasRef} className="block aspect-[4/3] w-full" />
        <FeedToggle />
      </div>
    </figure>
  )
}
