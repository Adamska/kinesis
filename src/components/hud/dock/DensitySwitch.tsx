import { DENSITIES, DENSITY_IDS } from '../../../config/density'
import { useSimulationStore } from '../../../store/useSimulationStore'
import { OptionGroup } from './DockCell'

const DENSITY_OPTIONS = DENSITY_IDS.map((id) => ({
  id,
  label: DENSITIES[id].label,
  title: `${(DENSITIES[id].size ** 2).toLocaleString('en-US')} particles`,
}))

export function DensitySwitch() {
  const density = useSimulationStore((state) => state.density)
  const setDensity = useSimulationStore((state) => state.setDensity)
  return <OptionGroup label="Particle count" options={DENSITY_OPTIONS} value={density} onChange={setDensity} />
}
