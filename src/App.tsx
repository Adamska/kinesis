import { useEffect } from 'react'
import { Stage } from './scene/Stage'
import { disableTracking } from './vision/trackingSession'

export function App() {
  useEffect(() => disableTracking, [])

  return (
    <main className="relative h-full w-full bg-void">
      <Stage />
    </main>
  )
}
