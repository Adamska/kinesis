import { useEffect } from 'react'
import { Hud } from './components/hud/Hud'
import { useKeyboardShortcuts } from './input/shortcuts'
import { Stage } from './scene/Stage'
import { useUrlSync } from './store/useUrlSync'
import { schedulePreload, shutdownTracking } from './vision/trackingSession'

export function App() {
  useKeyboardShortcuts()
  useUrlSync()

  useEffect(() => {
    const cancelPreload = schedulePreload()
    return () => {
      cancelPreload()
      shutdownTracking()
    }
  }, [])

  return (
    <main className="relative h-full w-full overflow-hidden bg-void">
      <Stage />
      <Hud />
    </main>
  )
}
