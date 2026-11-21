import { useEffect, useRef, useState } from 'react'
import { LOOKS, type LookCategory } from '@shared/color/looks'
import { OVERLAY_CATALOG, type OverlayCategory } from '@shared/overlayCatalog'
import { addOverlay, applyLook, removeLooks } from '@shared/agent/tools2'
import { overlayContext } from '../assistant'
import { useEditor } from '../store'
import { player, usePlayback } from '../engine/player'
import { applyDragProps } from '../applyDrag'
import type { Project } from '@shared/types'

/** A live thumbnail: the current frame with the look applied, drawn only while the tile is on screen. */
function LookThumb({ id, intensity, project, selection }: { id: string; intensity: number; project: Project; selection: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const time = usePlayback((s) => (s.playing ? -1 : Math.round(s.time * 10))) // not once per frame during playback
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: '120px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || time < 0) return
    const timer = setTimeout(() => { if (ref.current) player.renderVariant(applyLook(project, id, intensity, selection).project, ref.current) }, 80)
    return () => clearTimeout(timer)
  }, [visible, time, id, intensity, project, selection])
  const { width, height } = project.settings
  return <canvas ref={ref} width={160} height={Math.max(2, Math.round((160 * height) / width / 2) * 2)} />
}

const LOOK_CATEGORIES: LookCategory[] = ['Cinematic', 'Film', 'Film stocks', 'Vintage', 'Black and white', 'Warm and cool', 'Social', 'Music video', 'Dark and moody', 'Creative']
const OVERLAY_CATEGORIES: OverlayCategory[] = ['Light leaks', 'Film', 'Flashes', 'Digital']

/** Colour looks (lookup tables made from formulas) and overlay clips (light leaks, grain, dust, flashes), both free of licences. */
export function LooksTab() {
  const [intensity, setIntensity] = useState(1)
  const [cover, setCover] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const selected = useEditor((s) => s.selection)
  const project = useEditor((s) => s.project!)
  const empty = !project.tracks.some((t) => t.clips.length)

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
      <p className="hint">{selected.length ? `${selected.length} selected` : 'All clips'}</p>
      <div className="row"><label>Intensity <input type="range" min={0} max={1} step={0.05} value={intensity} aria-label="Look intensity" onChange={(e) => setIntensity(Number(e.target.value))} /></label><span>{Math.round(intensity * 100)}%</span><button onClick={clear}>Remove look</button></div>
      {LOOK_CATEGORIES.map((c) => (
        <section key={c}>
          <h4>{c}</h4>
          <div className="look-grid">
            {LOOKS.filter((l) => l.category === c).map((l) => (
              <button key={l.id} className="look-tile" aria-label={`Apply the ${l.name} look`} onClick={() => look(l.id, l.name)} title="Click to apply, or drag onto a clip in the timeline" {...applyDragProps({ kind: 'look', id: l.id, name: l.name, intensity })}>
                {!empty && <LookThumb id={l.id} intensity={intensity} project={project} selection={selected} />}
                <span className="look-name">{l.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <h3>Overlays</h3>
      
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
