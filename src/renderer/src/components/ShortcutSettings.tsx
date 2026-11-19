import { useEffect, useState } from 'react'
import { comboFromEvent, conflictFor, keysFor, setKeys, SHORTCUTS } from '@shared/shortcuts'
import { resetShortcuts, setOverrides, useKeys } from '../keys'

type Pending = { id: string; combo: string; replace: boolean; clash: string }

/** Lists every shortcut with its keys and lets the person change, add, remove or reset them. */
export function ShortcutSettings() {
  const overrides = useKeys((s) => s.overrides)
  const [listening, setListening] = useState<{ id: string; replace: boolean } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => {
    if (!listening) return
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e)
      if (!combo) return
      e.preventDefault()
      e.stopPropagation()
      const { id, replace } = listening
      setListening(null)
      const clash = conflictFor(combo, useKeys.getState().overrides, id)
      if (clash) return setPending({ id, combo, replace, clash: clash.label })
      const had = keysFor(id, useKeys.getState().overrides)
      setOverrides(setKeys(useKeys.getState().overrides, id, replace ? [combo] : [...new Set([...had, combo])]))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening])

  const apply = (p: Pending): void => {
    const had = keysFor(p.id, overrides)
    setOverrides(setKeys(overrides, p.id, p.replace ? [p.combo] : [...new Set([...had, p.combo])], true))
    setPending(null)
  }
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))]

  return (
    <div className="settings-body" id="keyboard-shortcuts">
      <p className="hint">Click Change, then press the key (or keys) you want. Add gives an action a second key. Changes apply at once and are remembered.</p>
      {pending && (
        <div className="note-box" role="alert">
          <strong>{pending.combo}</strong> already does “{pending.clash}”.{' '}
          <button onClick={() => apply(pending)}>Use it here instead</button> <button onClick={() => setPending(null)}>Keep it there</button>
        </div>
      )}
      {groups.map((g) => (
        <section key={g}>
          <h3>{g}</h3>
          <table className="shortcut-table">
            <tbody>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => {
                const keys = keysFor(s.id, overrides)
                const changed = s.id in overrides
                return (
                  <tr key={s.id}>
                    <td>{s.label}</td>
                    <td className="keys">
                      {keys.length ? keys.map((k) => (
                        <kbd key={k}>{k}<button aria-label={`Remove ${k} from ${s.label}`} onClick={() => setOverrides(setKeys(overrides, s.id, keys.filter((x) => x !== k)))}>×</button></kbd>
                      )) : <em>none</em>}
                    </td>
                    <td className="actions">
                      {listening?.id === s.id ? (
                        <><span role="status">Press a key…</span> <button onClick={() => setListening(null)}>Cancel</button></>
                      ) : (
                        <>
                          <button aria-label={`Change the key for ${s.label}`} onClick={() => { setPending(null); setListening({ id: s.id, replace: true }) }}>Change</button>
                          <button aria-label={`Add a key for ${s.label}`} disabled={keys.length >= 3} onClick={() => { setPending(null); setListening({ id: s.id, replace: false }) }}>Add</button>
                          {changed && <button aria-label={`Reset ${s.label}`} onClick={() => { const next = { ...overrides }; delete next[s.id]; setOverrides(next) }}>Reset</button>}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}
      <button onClick={resetShortcuts} disabled={!Object.keys(overrides).length}>Reset all shortcuts</button>
    </div>
  )
}
