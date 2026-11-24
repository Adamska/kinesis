import { useRef } from 'react'
import { simulationBridge, useSimulationStore, type Gesture } from '../../store/useSimulationStore'
import { useTicker } from './useTicker'

const REFRESH_INTERVAL_MS = 80

const POINTER_LABELS: Record<Gesture, string> = {
  flow: 'Pointer: Stir',
  pinch: 'Pointer: Pinch',
  shockwave: 'Pointer: Shockwave',
}

const TRACKING_LABELS: Record<Gesture, string> = {
  flow: 'Tracking: Open hand',
  pinch: 'Tracking: Pinch',
  shockwave: 'Tracking: Shockwave',
}

function describeState(): { label: string; gesture: Gesture } {
  const { source, gesture } = simulationBridge.telemetry
  if (source === 'tracking') {
    const twin = simulationBridge.hands.every((hand) => hand.visible)
    return { label: twin ? TRACKING_LABELS[gesture].replace('Tracking', 'Tracking x2') : TRACKING_LABELS[gesture], gesture }
  }
  if (source === 'pointer') return { label: POINTER_LABELS[gesture], gesture }
  const searching = useSimulationStore.getState().vision === 'active'
  return { label: searching ? 'Tracking: Searching' : 'Autonomous flow', gesture: 'flow' }
}

export function GestureIndicator() {
  const rootRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)

  useTicker(() => {
    const root = rootRef.current
    const label = labelRef.current
    if (!root || !label) return
    const state = describeState()
    if (label.textContent !== state.label) label.textContent = state.label
    if (root.dataset.gesture !== state.gesture) root.dataset.gesture = state.gesture
  }, REFRESH_INTERVAL_MS)

  return (
    <div ref={rootRef} data-gesture="flow" className="group flex min-w-52 items-center gap-2.5">
      <span className="size-1.5 bg-white/45 transition-colors duration-150 group-data-[gesture=pinch]:bg-signal group-data-[gesture=shockwave]:bg-white" />
      <span
        ref={labelRef}
        className="text-white/70 transition-colors duration-150 group-data-[gesture=pinch]:text-signal group-data-[gesture=shockwave]:text-white"
      >
        Autonomous flow
      </span>
    </div>
  )
}
