import type { ReactNode } from 'react'

/** One hairline-bordered compartment of the dock; neighbors share their borders. */
export function DockCell({ children, label, className = '' }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div
      className={`-ml-px -mt-px flex h-11 w-full items-center justify-center gap-3 border border-hairline bg-void/65 px-4 backdrop-blur-md sm:w-auto ${className}`}
    >
      {label && <span className="text-white/40">{label}</span>}
      {children}
    </div>
  )
}

export interface Option<T extends string> {
  id: T
  label: string
  title?: string
  /** CSS background for the underline, such as a palette gradient. */
  accent?: string
}

interface OptionGroupProps<T extends string> {
  label: string
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
}

/** Radio group rendered as underlined words, the dock's one selection idiom. */
export function OptionGroup<T extends string>({ label, options, value, onChange }: OptionGroupProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-4">
      {options.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            onClick={() => onChange(option.id)}
            className={`flex cursor-pointer flex-col gap-1 uppercase transition-colors duration-200 ${
              selected ? 'text-white' : 'text-white/40 hover:text-white/75'
            }`}
          >
            {option.label}
            <span
              className={`h-px w-full transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-35'}`}
              style={{ background: option.accent ?? 'currentColor' }}
            />
          </button>
        )
      })}
    </div>
  )
}

interface ToggleProps {
  label: string
  pressed: boolean
  onToggle: () => void
  /** Shown instead of the label while the control is busy, such as a countdown. */
  status?: string
}

/** Bracketed text toggle, the dock's one on/off idiom. */
export function DockToggle({ label, pressed, onToggle, status }: ToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={`cursor-pointer uppercase tabular-nums transition-colors duration-200 ${
        pressed ? 'text-signal' : 'text-white/45 hover:text-white/80'
      }`}
    >
      <span className="text-white/30">[</span> {status ?? label} <span className="text-white/30">]</span>
    </button>
  )
}
