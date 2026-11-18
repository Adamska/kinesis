import { useEffect } from 'react'
import { Hud } from './components/hud/Hud'
import { Stage } from './scene/Stage'
import { disableTracking } from './vision/trackingSession'

export function App() {
  useEffect(() => disableTracking, [])

  return (
    <main className="relative h-full w-full overflow-hidden bg-void">
      <Stage />
      <Hud />
    </main>
  )
}
