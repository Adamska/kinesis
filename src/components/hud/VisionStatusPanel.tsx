import { useRef, useState } from 'react'
import { simulationBridge, useSimulationStore } from '../../store/useSimulationStore'
import type { TrackerStage } from '../../vision/HandTracker'
import { disableTracking } from '../../vision/trackingSession'
import { useTicker } from './useTicker'

const STAGE_ORDER: readonly TrackerStage[] = ['permission', 'download', 'compile', 'warmup']

const STAGES: Record<TrackerStage, { title: string; hint: string }> = {
  permission: {
    title: 'Waiting for camera permission',
    hint: 'Allow camera access in the browser prompt to continue.',
  },
  download: {
    title: 'Downloading vision runtime',
    hint: 'One-time download of about 22 MB, cached for later visits.',
  },
  compile: {
    title: 'Compiling hand tracking model',
    hint: 'Building the inference graph in a background thread.',
  },
  warmup: {
    title: 'Warming up inference',
    hint: 'Running the first pass. Almost ready.',
  },
}

const FAILURES = {
  denied: {
    title: 'Camera access denied',
    hint: 'Allow the camera for this site in your browser settings, then enable tracking again.',
  },
  unavailable: {
    title: 'Tracking unavailable',
    hint: 'No camera was found, or the vision runtime could not be loaded. Check your connection and retry.',
  },
} as const

const frame = 'w-[min(26rem,calc(100vw-2.5rem))] border bg-void/80 text-[10px] uppercase tracking-[0.16em] backdrop-blur-md'

function LoadingPanel() {
  const stage = useSimulationStore((state) => state.visionStage)
  const bytesRef = useRef<HTMLSpanElement>(null)
  const step = STAGE_ORDER.indexOf(stage)

  useTicker(() => {
    if (!bytesRef.current) return
    const megabytes = simulationBridge.telemetry.downloadedBytes / 1_000_000
    bytesRef.current.textContent = megabytes > 0 ? `${megabytes.toFixed(1)} MB` : ''
  }, 120)

  return (
    <section role="status" aria-live="polite" className={`${frame} border-signal/40`}>
      <header className="flex justify-between border-b border-hairline px-4 py-2.5">
        <span className="text-signal">Starting hand tracking</span>
        <span className="text-white/45 tabular-nums">
          Step {step + 1} / {STAGE_ORDER.length}
        </span>
      </header>
      <div className="px-4 py-4">
        <p className="flex justify-between gap-4 text-[12px] text-white">
          {STAGES[stage].title}
          {stage === 'download' && <span ref={bytesRef} className="text-white/60 tabular-nums" />}
        </p>
        <div className="mt-3.5 flex gap-1">
          {STAGE_ORDER.map((id, index) => (
            <span key={id} className="relative h-0.5 flex-1 overflow-hidden bg-white/12">
              {index < step && <span className="absolute inset-0 bg-signal" />}
              {index === step && <span className="hud-sweep absolute inset-0 bg-signal" />}
            </span>
          ))}
        </div>
        <p className="mt-3.5 leading-relaxed text-white/50 normal-case tracking-[0.04em]">{STAGES[stage].hint}</p>
        <p className="mt-1 leading-relaxed text-white/35 normal-case tracking-[0.04em]">
          The simulation keeps running in the meantime.
        </p>
      </div>
    </section>
  )
}

function AwaitingHandPanel() {
  const [acquired, setAcquired] = useState(false)

  useTicker(() => {
    if (simulationBridge.hand.visible) setAcquired(true)
  }, 150)

  if (acquired) return null
  return (
    <section role="status" aria-live="polite" className={`${frame} border-signal/40 px-4 py-4`}>
      <p className="text-[12px] text-signal">Tracking online</p>
      <p className="mt-2 leading-relaxed text-white/60 normal-case tracking-[0.04em]">
        Raise one hand in front of the camera. Move it to drag the fluid, pinch thumb and index to gather it,
        then snap your hand open to release a shockwave.
      </p>
    </section>
  )
}

function FailurePanel({ kind }: { kind: keyof typeof FAILURES }) {
  return (
    <section role="alert" className={`${frame} pointer-events-auto border-white/30 px-4 py-4`}>
      <p className="text-[12px] text-white">{FAILURES[kind].title}</p>
      <p className="mt-2 leading-relaxed text-white/60 normal-case tracking-[0.04em]">{FAILURES[kind].hint}</p>
      <button
        type="button"
        onClick={disableTracking}
        className="mt-3.5 cursor-pointer uppercase text-white/75 transition-colors hover:text-white"
      >
        <span className="text-white/35">[</span> Dismiss <span className="text-white/35">]</span>
      </button>
    </section>
  )
}

/** Centered status for the webcam session: startup progress, first-use guidance and failures. */
export function VisionStatusPanel() {
  const vision = useSimulationStore((state) => state.vision)

  if (vision === 'idle') return null
  if (vision === 'loading') return <LoadingPanel />
  if (vision === 'active') return <AwaitingHandPanel />
  return <FailurePanel kind={vision} />
}
