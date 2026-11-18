import { useEffect, useRef } from 'react'
import { simulationBridge } from '../../store/useSimulationStore'
import { FINGERTIPS, HAND_BONES, Landmark, LANDMARK_COUNT } from '../../vision/handTopology'

const SIGNAL = '215 244 255'
const MAX_PIXEL_RATIO = 2

function drawSkeleton(context: CanvasRenderingContext2D, width: number, height: number): void {
  const { visible, landmarks, pinch, aspect } = simulationBridge.hand
  context.clearRect(0, 0, width, height)
  if (!visible) return

  // Contain-fit the camera frame inside the preview, mirrored on x so the skeleton
  // reads like a reflection of the user's hand.
  const frameWidth = Math.min(width, height * aspect)
  const frameHeight = frameWidth / aspect
  const left = (width - frameWidth) / 2
  const top = (height - frameHeight) / 2
  const px = (index: number) => left + (1 - landmarks[index * 2]) * frameWidth
  const py = (index: number) => top + landmarks[index * 2 + 1] * frameHeight

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

/** Corner wireframe of the tracked 21-point hand, redrawn on its own animation frame loop. */
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
      drawSkeleton(context, width, height)

      const status = simulationBridge.hand.visible ? 'Locked' : 'No hand'
      if (statusRef.current && statusRef.current.textContent !== status) {
        statusRef.current.textContent = status
      }
    }
    render()
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <figure className="w-44 border border-hairline bg-void/65 text-[10px] uppercase tracking-[0.16em] backdrop-blur-md sm:w-60">
      <figcaption className="flex justify-between border-b border-hairline px-2.5 py-1.5">
        <span className="text-white/40">Hand // 21 pt</span>
        <span ref={statusRef} className="text-white/85">
          No hand
        </span>
      </figcaption>
      <canvas ref={canvasRef} className="block aspect-[4/3] w-full" />
    </figure>
  )
}
