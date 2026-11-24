import { useEffect, useState } from 'react'
import { canRecordClips, onRecordingChange, remainingSeconds, toggleRecording } from '../../../capture/clipRecorder'
import { useTicker } from '../useTicker'
import { DockToggle } from './DockCell'

/** Records a clip of the canvas; while running, the label counts down to the auto stop. */
export function RecordToggle() {
  const [supported] = useState(canRecordClips)
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState<string>()

  useEffect(() => onRecordingChange(setRecording), [])

  // Setting an unchanged string is a no-op, so idle ticks never re-render.
  useTicker(() => {
    const remaining = remainingSeconds()
    setStatus(remaining === null ? undefined : `Rec ${remaining.toFixed(1)} s`)
  }, 100)

  if (!supported) return null
  return <DockToggle label="Rec" pressed={recording} onToggle={toggleRecording} status={status} />
}
