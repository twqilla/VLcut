import { Icon } from './Icon'
import { toggleSection, useUi } from '../ui'
import type { ReactNode } from 'react'

interface NumProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange(value: number): void
  /** Extra control shown after the number box, e.g. a keyframe button. */
  after?: ReactNode
}

/** A labelled slider with an exact number box. */
export function Num({ label, value, min, max, step = 0.01, onChange, after }: NumProps) {
  const set = (raw: string) => {
    const v = Number(raw)
    if (raw !== '' && Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)))
  }
  const shown = Math.round(value * 1000) / 1000
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(e.target.value)} />
      <input type="number" min={min} max={max} step={step} value={shown} onChange={(e) => set(e.target.value)} />
      {after}
    </label>
  )
}

/** A properties group with a heading that folds it away; the choice is remembered. */
export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const collapsed = useUi((s) => s.collapsedSections.includes(title))
  return (
    <section className={`section ${collapsed ? 'collapsed' : ''}`}>
      <header>
        <button type="button" className="section-toggle" aria-expanded={!collapsed} onClick={() => toggleSection(title)} title={collapsed ? `Show ${title}` : `Hide ${title}`}>
          <Icon name={collapsed ? 'right' : 'down'} size={12} />
          <h3>{title}</h3>
        </button>
        {actions}
      </header>
      {!collapsed && children}
    </section>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}
