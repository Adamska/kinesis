import { toggleMic, toggleSound } from '../../../audio/audioSession'
import { useSimulationStore, type MicStatus } from '../../../store/useSimulationStore'
import { DockToggle } from './DockCell'

const MIC_STATUS: Partial<Record<MicStatus, string>> = { starting: 'Mic ...', denied: 'Mic blocked' }

export function AudioControls() {
  const sound = useSimulationStore((state) => state.sound)
  const mic = useSimulationStore((state) => state.mic)

  return (
    <>
      <DockToggle label="Sound" pressed={sound} onToggle={() => void toggleSound()} />
      <DockToggle label="Mic" pressed={mic === 'on'} onToggle={() => void toggleMic()} status={MIC_STATUS[mic]} />
    </>
  )
}
