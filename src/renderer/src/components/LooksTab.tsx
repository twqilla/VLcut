import { useState } from 'react'
import { LOOKS, type LookCategory } from '@shared/color/looks'
import { OVERLAY_CATALOG, type OverlayCategory } from '@shared/overlayCatalog'
import { addOverlay, applyLook, removeLooks } from '@shared/agent/tools2'
import { overlayContext } from '../assistant'
import { useEditor } from '../store'
import { player } from '../engine/player'

/** A few typical colours (skin, sky, leaves, grey, shadow, highlight) pushed through a look, so a tile shows what it does. */
const SAMPLES: [number, number, number][] = [[0.9, 0.7, 0.58], [0.4, 0.6, 0.92], [0.3, 0.6, 0.3], [0.5, 0.5, 0.5], [0.12, 0.12, 0.18], [0.95, 0.95, 0.9]]
const css = ([r, g, b]: [number, number, number]): string => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`

const LOOK_CATEGORIES: LookCategory[] = ['Cinematic', 'Film', 'Black and white', 'Social', 'Dark and moody']
const OVERLAY_CATEGORIES: OverlayCategory[] = ['Light leaks', 'Film', 'Flashes', 'Digital']

/** Colour looks (lookup tables made from formulas) and overlay clips (light leaks, grain, dust, flashes), both free of licences. */
export function LooksTab() {
  const [intensity, setIntensity] = useState(1)
  const [cover, setCover] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const selected = useEditor((s) => s.selection)

  const look = (id: string, name: string) => {
    const { apply, selection } = useEditor.getState()
    let count = 0
    apply(`Apply the ${name} look`, (p) => { const r = applyLook(p, id, intensity, selection); count = r.count; return r.project })
    setNote(count ? `Gave ${count} clip${count === 1 ? '' : 's'} the “${name}” look.` : 'Add a picture clip to the timeline first.')
  }
  const clear = () => {
    let count = 0
    useEditor.getState().apply('Remove colour look', (p) => { const r = removeLooks(p, useEditor.getState().selection); count = r.count; return r.project })
    setNote(count ? 'Removed the look.' : 'There is no built-in look to remove.')
  }
  const overlay = async (id: string) => {
    const info = OVERLAY_CATALOG.find((o) => o.id === id)!
    setBusy(id)
    try {
      const asset = (await overlayContext([id]))[id]
      let count = 0
      useEditor.getState().apply(`Add ${info.name} overlay`, (p) => { const r = addOverlay(p, asset, info, player.time, cover && info.seconds > 1); count = r.count; return r.project })
      setNote(`Added the ${info.name.toLowerCase()} overlay${count > 1 ? ` (${count} repeats)` : ''}. Change how strongly it shows with Opacity in Properties.`)
    } catch (err) {
      setNote(`Could not make that overlay: ${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="apply-list looks-tab">
      <h3>Colour looks</h3>
      <p className="hint">Click a look to grade {selected.length ? 'the selected clips' : 'every picture clip'}. They are lookup tables made on your computer. Fine-tune in Properties (Intensity on the LUT effect).</p>
      <div className="row"><label>Intensity <input type="range" min={0} max={1} step={0.05} value={intensity} aria-label="Look intensity" onChange={(e) => setIntensity(Number(e.target.value))} /></label><span>{Math.round(intensity * 100)}%</span><button onClick={clear}>Remove look</button></div>
      {LOOK_CATEGORIES.map((c) => (
        <section key={c}>
          <h4>{c}</h4>
          <div className="look-grid">
            {LOOKS.filter((l) => l.category === c).map((l) => (
              <button key={l.id} className="look-tile" aria-label={`Apply the ${l.name} look`} onClick={() => look(l.id, l.name)}>
                <span className="swatches">{SAMPLES.map((s, i) => <i key={i} style={{ background: css(l.grade(s)) }} />)}</span>
                {l.name}
              </button>
            ))}
          </div>
        </section>
      ))}
      <h3>Overlays</h3>
      <p className="hint">Light leaks, film burn, grain, dust, flashes and glitch bars, made on your computer. They go on their own track above the picture, set to blend with it.</p>
      <label className="check"><input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} /> Repeat to cover the rest of the timeline (looping overlays)</label>
      {OVERLAY_CATEGORIES.map((c) => (
        <section key={c}>
          <h4>{c}</h4>
          <div className="stack-grid">
            {OVERLAY_CATALOG.filter((o) => o.category === c).map((o) => <span key={o.id} className="stack-item"><button disabled={busy === o.id} aria-label={`Add the ${o.name} overlay`} onClick={() => void overlay(o.id)}>{o.name}</button></span>)}
          </div>
        </section>
      ))}
      {note && <p className="hint" role="status">{note}</p>}
    </div>
  )
}
