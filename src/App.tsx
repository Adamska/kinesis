import { useEffect } from 'react'
import { Hud } from './components/hud/Hud'
import { Stage } from './scene/Stage'
import { schedulePreload, shutdownTracking } from './vision/trackingSession'

export function App() {
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
