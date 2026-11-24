import { SHORTCUTS } from '../../input/shortcuts'
import { useSimulationStore } from '../../store/useSimulationStore'

/** Keyboard reference, opened with the question mark key. */
export function ShortcutSheet() {
  const open = useSimulationStore((state) => state.shortcutsOpen)
  const setOpen = useSimulationStore((state) => state.setShortcutsOpen)
  if (!open) return null

  return (
    <section
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="pointer-events-auto w-[min(22rem,calc(100vw-2.5rem))] border border-hairline bg-void/85 text-[10px] uppercase tracking-[0.16em] backdrop-blur-md"
    >
      <header className="flex justify-between border-b border-hairline px-4 py-2.5">
        <span className="text-white/90">Keyboard</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="cursor-pointer uppercase text-white/45 transition-colors hover:text-white"
        >
          <span className="text-white/30">[</span> Esc <span className="text-white/30">]</span>
        </button>
      </header>
      <dl className="px-4 py-2">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.action} className="flex justify-between gap-6 border-t border-hairline py-1.5 first:border-t-0">
            <dt className="text-white/45">{shortcut.action}</dt>
            <dd>
              <kbd className="font-mono text-signal">{shortcut.label}</kbd>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
