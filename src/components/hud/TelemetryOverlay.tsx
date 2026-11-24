import { useRef, type ReactNode } from 'react'
import { DENSITIES } from '../../config/density'
import { simulationBridge, useSimulationStore } from '../../store/useSimulationStore'
import { useTicker } from './useTicker'

const REFRESH_INTERVAL_MS = 250

function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-hairline py-1.5 whitespace-nowrap">
      <dt className="text-white/40">{label}</dt>
      <dd className="text-white/85 tabular-nums">{children}</dd>
    </div>
  )
}

export function TelemetryOverlay() {
  const { size } = DENSITIES[useSimulationStore((state) => state.density)]
  const fpsRef = useRef<HTMLSpanElement>(null)
  const latencyRef = useRef<HTMLSpanElement>(null)

  useTicker(() => {
    const { fps, inferenceMs } = simulationBridge.telemetry
    if (fpsRef.current) fpsRef.current.textContent = fps.toFixed(0)
    if (latencyRef.current) {
      latencyRef.current.textContent = inferenceMs > 0 ? `${inferenceMs.toFixed(1)} ms` : 'standby'
    }
  }, REFRESH_INTERVAL_MS)

  return (
    <section className="w-60 text-[10px] uppercase tracking-[0.16em]">
      <h1 className="border border-hairline bg-void/60 px-3 py-2 text-[11px] font-medium text-white/90 backdrop-blur-sm">
        Kinesis <span className="text-white/35">//</span> GPGPU Fluid Lab
      </h1>
      <dl className="mt-3 px-3">
        <Readout label="Particles">{(size * size).toLocaleString('en-US')}</Readout>
        <Readout label="State grid">
          {size} x {size} f16
        </Readout>
        <Readout label="Frame rate">
          <span ref={fpsRef}>0</span> fps
        </Readout>
        <Readout label="Vision">
          <span ref={latencyRef}>standby</span>
        </Readout>
      </dl>
    </section>
  )
}
