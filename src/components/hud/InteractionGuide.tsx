import { useSimulationStore } from '../../store/useSimulationStore'

const POINTER_GUIDE = [
  ['Move', 'Stir the field'],
  ['Hold', 'Singularity'],
  ['Release', 'Shockwave'],
] as const

const TRACKING_GUIDE = [
  ['Move hand', 'Drag the fluid'],
  ['Pinch', 'Singularity'],
  ['Snap open', 'Shockwave'],
] as const

export function InteractionGuide() {
  const tracking = useSimulationStore((state) => state.vision === 'active')
  const guide = tracking ? TRACKING_GUIDE : POINTER_GUIDE

  return (
    <dl className="hidden w-60 text-[10px] uppercase tracking-[0.16em] sm:block">
      {guide.map(([action, effect]) => (
        <div key={action} className="flex justify-between gap-6 border-t border-hairline py-1.5">
          <dt className="text-white/40">{action}</dt>
          <dd className="text-white/70">{effect}</dd>
        </div>
      ))}
    </dl>
  )
}
