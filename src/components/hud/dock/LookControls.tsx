import { useSimulationStore } from '../../../store/useSimulationStore'
import { DockToggle } from './DockCell'

export function LookControls() {
  const trails = useSimulationStore((state) => state.trails)
  const toggleTrails = useSimulationStore((state) => state.toggleTrails)
  return <DockToggle label="Trails" pressed={trails} onToggle={toggleTrails} />
}
