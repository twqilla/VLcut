import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../store'
import { ask, canAdjust, refreshAssistantEnvironment, runSteps, toggleStep, useAssistant } from '../assistant'

import { ASSISTANT_PRESETS } from '@shared/agent/planner2'

const SUGGESTIONS = ['Make this video more cinematic', 'Remove all unnecessary pauses', 'Create dynamic subtitles', 'Make the first 5 seconds more interesting', 'Use the best clips and create a 30-second montage', 'Add transitions that match the music', 'Make the pacing faster', 'Give me three different versions']

export function AssistantPanel() {
  const { exchanges, busy, llm, useLlm, progress } = useAssistant()
  useEditor((s) => s.past.length) // re-render so "undo step" availability stays current
  const [text, setText] = useState('')
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => void refreshAssistantEnvironment(), [])
  // Written with braces on purpose: newer browsers return a Promise from scrollIntoView, and an effect must not return one.
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [exchanges.length])

  const send = (request: string) => {
    if (!request.trim()) return
    setText('')
    void ask(request.trim())
  }

  return (
    <div className="assistant">
      <div className="assistant-log">
        {exchanges.length === 0 && (
          <div className="assistant-intro">
            <p>Describe the edit you want. The assistant plans it, makes the changes on your timeline, and shows each one so you can undo it.</p>
            <p className="hint">It runs on this computer. A restore point is saved before every request.</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>)}
            </div>
          </div>
        )}
        {exchanges.map((ex) => {
          const adjustable = canAdjust(ex)
          return (
            <article key={ex.id} className="exchange">
              <p className="request">{ex.request}</p>
              {ex.steps.length > 0 && (
                <ol className="steps">
                  {ex.steps.map((s, i) => (
                    <li key={i} className={s.undone ? 'undone' : s.changed ? '' : 'noop'}>
                      <p>{s.step.description}</p>
                      <p className="result">{s.undone ? 'Undone.' : s.summary}</p>
                      {(s.changed || s.undone) && (
                        <button disabled={!adjustable} onClick={() => void toggleStep(ex.id, i)} title={adjustable ? '' : 'You have edited since. Use Undo or the History tab instead.'}>
                          {s.undone ? 'Redo this step' : 'Undo this step'}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {ex.variants && (
                <div className="variants">
                  <p>Here are {ex.variants.length} directions. Apply one to see it; applying another replaces it.</p>
                  {ex.variants.map((v) => (
                    <button key={v.name} onClick={() => void runSteps(`${v.name} version`, v.steps)}>
                      <strong>{v.name}</strong>
                      <span>{v.steps[0].description.split(': ')[1]}</span>
                    </button>
                  ))}
                </div>
              )}
              {ex.notes.map((n, i) => <p key={i} className="note">{n}</p>)}
              {ex.plannedBy === 'local model' && <p className="hint">Planned by your local model.</p>}
            </article>
          )
        })}
        {busy && <p className="hint" role="status">{progress || 'Working…'}</p>}
        <div ref={endRef} />
      </div>
      <div className="presets">
        <button type="button" className={presetsOpen ? 'on' : ''} aria-expanded={presetsOpen} onClick={() => setPresetsOpen(!presetsOpen)}>{presetsOpen ? 'Hide presets' : `Presets (${ASSISTANT_PRESETS.reduce((n, g) => n + g.prompts.length, 0)})`}</button>
        {presetsOpen && (
          <div className="preset-list">
            <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search presets…" aria-label="Search presets" />
            {ASSISTANT_PRESETS.map((g) => {
              const shown = g.prompts.filter((p) => p.toLowerCase().includes(filter.toLowerCase()))
              return shown.length ? (
                <section key={g.group}>
                  <h4>{g.group}</h4>
                  <div className="chips">{shown.map((p) => <button key={p} disabled={busy} onClick={() => send(p)}>{p}</button>)}</div>
                </section>
              ) : null
            })}
            <p className="hint">Click one to run it, or type your own wording: the assistant understands effects, text, colour, speed, camera moves, compositing, fades, volume and trimming.</p>
          </div>
        )}
      </div>
      <form className="assistant-input" onSubmit={(e) => { e.preventDefault(); send(text) }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Describe the edit you want…" aria-label="Request for the assistant" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }} />
        <button type="submit" className="primary" disabled={busy || !text.trim()}>Send</button>
      </form>
      <label className="hint llm-toggle" title="Ollama is an optional free program that runs language models on your computer.">
        <input type="checkbox" disabled={!llm.available} checked={useLlm && llm.available} onChange={(e) => useAssistant.setState({ useLlm: e.target.checked })} />{' '}
        {llm.available ? `Use local model (${llm.model}) for freer wording` : 'Built-in planner (no local model running)'}
      </label>
    </div>
  )
}
