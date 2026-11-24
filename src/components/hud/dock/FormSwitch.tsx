import { SHAPE_IDS, SHAPE_LABELS } from '../../../gpgpu/shapeTargets'
import { useSimulationStore } from '../../../store/useSimulationStore'
import { OptionGroup } from './DockCell'

const FORM_OPTIONS = SHAPE_IDS.map((id) => ({ id, label: SHAPE_LABELS[id] }))

export function FormSwitch() {
  const shape = useSimulationStore((state) => state.shape)
  const setShape = useSimulationStore((state) => state.setShape)
  return <OptionGroup label="Form" options={FORM_OPTIONS} value={shape} onChange={setShape} />
}
