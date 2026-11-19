import { useState } from 'react'
import { insertTemplate, MOTION_TEMPLATES, TEMPLATE_CATEGORIES, templateValues, type MotionTemplate, type TemplateCategory } from '@shared/motionTemplates'
import { useEditor } from '../store'
import { player } from '../engine/player'

/** Ready-made intros, lower thirds, titles, end cards and social prompts: fill in the words and place them at the playhead. */
export function TemplatesTab() {
  const [category, setCategory] = useState<TemplateCategory>('Intros')
  const [open, setOpen] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, Record<string, string>>>({})
  const [note, setNote] = useState('')

  const place = (t: MotionTemplate) => {
    const { apply, select } = useEditor.getState()
    let ids: string[] = []
    apply(`Add ${t.name}`, (p) => { const r = insertTemplate(p, t, values[t.id] ?? {}, player.time); ids = r.ids; return r.project })
    select(ids)
    setNote(`Added “${t.name}” at the playhead (${t.seconds} s). Every part is a normal clip you can change.`)
  }

  return (
    <div className="apply-list templates-tab">
      <h3>Templates</h3>
      <div className="chips" role="group" aria-label="Template categories">
        {TEMPLATE_CATEGORIES.map((c) => <button key={c} className={category === c ? 'on' : ''} onClick={() => { setCategory(c); setOpen(null) }}>{c}</button>)}
      </div>
      <ul className="template-list">
        {MOTION_TEMPLATES.filter((t) => t.category === category).map((t) => {
          const v = templateValues(t, values[t.id])
          return (
            <li key={t.id} className={open === t.id ? 'open' : ''}>
              <button className="template-head" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
                <strong>{t.name}</strong>
                <small>{t.blurb} · {t.seconds} s</small>
              </button>
              {open === t.id && (
                <div className="template-form">
                  {t.fields.map((f) => (
                    <label key={f.key} className="field">
                      <span className="field-label">{f.label}</span>
                      {f.kind === 'color'
                        ? <input type="color" value={v[f.key]} aria-label={f.label} onChange={(e) => setValues((all) => ({ ...all, [t.id]: { ...all[t.id], [f.key]: e.target.value } }))} />
                        : <input type="text" value={v[f.key]} maxLength={200} aria-label={f.label} onChange={(e) => setValues((all) => ({ ...all, [t.id]: { ...all[t.id], [f.key]: e.target.value } }))} />}
                    </label>
                  ))}
                  <button className="primary" aria-label={`Add ${t.name} at the playhead`} onClick={() => place(t)}>Add at the playhead</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {note && <p className="hint" role="status">{note}</p>}
    </div>
  )
}
