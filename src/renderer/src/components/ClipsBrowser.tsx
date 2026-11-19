import { useEffect, useRef, useState } from 'react'
import type { ClipFile, MediaAsset, ProjectSummary } from '@shared/types'
import { useEditor } from '../store'
import { formatBytes, formatDate, formatDuration, mediaUrl } from '../format'

const PLAYABLE = new Set(['h264', 'vp8', 'vp9', 'av1'])
const precise = (t: number): string => `${formatDuration(t)}.${String(Math.floor((t % 1) * 100)).padStart(2, '0')}`

function Thumb({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.api.media.thumbnail(path, 0).then((url) => alive && setSrc(url), () => {})
    return () => {
      alive = false
    }
  }, [path])
  return src ? <img src={src} alt="" /> : <span className="thumb-empty" />
}

/** Browse a folder of recordings, play any of them at once, trim without re-encoding, or send one to the editor. */
export function ClipsBrowser({ projects }: { projects: ProjectSummary[] }) {
  const [folder, setFolder] = useState<string | null>(null)
  const [files, setFiles] = useState<ClipFile[]>([])
  const [selected, setSelected] = useState<ClipFile | null>(null)
  const [info, setInfo] = useState<MediaAsset | null>(null)
  const [range, setRange] = useState<{ in: number; out: number } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  const refresh = async (dir: string | null) => setFiles(dir ? await window.api.clips.list(dir) : [])
  useEffect(() => {
    void window.api.clips.getFolder().then((dir) => {
      setFolder(dir)
      void refresh(dir)
    })
  }, [])

  const choose = async () => {
    const dir = await window.api.clips.pickFolder()
    if (!dir) return
    setFolder(dir)
    setSelected(null)
    await refresh(dir)
  }

  const open = async (file: ClipFile) => {
    setSelected(file)
    setInfo(null)
    setRange(null)
    setMessage('')
    const [probed] = await window.api.media.probe([file.path])
    setInfo(probed ?? null)
    if (probed) setRange({ in: 0, out: probed.duration })
    else setMessage('This file could not be read as video.')
  }

  const mark = (edge: 'in' | 'out') => {
    const t = video.current?.currentTime ?? 0
    setRange((r) => (r ? (edge === 'in' ? { in: Math.min(t, r.out - 0.05), out: r.out } : { in: r.in, out: Math.max(t, r.in + 0.05) }) : r))
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await work()
    } catch (err) {
      setMessage((err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setBusy(false)
    }
  }

  const trimmed = Boolean(range && info && (range.in > 0.01 || range.out < info.duration - 0.01))
  const saveTrim = () =>
    run(async () => {
      const out = await window.api.clips.trim(selected!.path, range!.in, range!.out - range!.in)
      setMessage(`Saved ${out.split(/[\\/]/).pop()} beside the original, at the original quality.`)
      await refresh(folder)
    })
  const edit = (projectId: string | null) => run(() => useEditor.getState().editFile(selected!.path, projectId, trimmed ? range!.in : undefined, trimmed ? range!.out : undefined))

  const playable = info ? PLAYABLE.has(info.videoCodec ?? '') : true

  return (
    <div className="clips">
      <div className="clips-bar">
        <button className="primary" onClick={() => void choose()}>{folder ? 'Change folder' : 'Choose your clips folder'}</button>
        {folder && <span className="project-meta" title={folder}>{folder}</span>}
        {folder && <button onClick={() => void refresh(folder)}>Refresh</button>}
      </div>
      {!folder && <p className="empty">Pick the folder where your recordings are saved. Every video in it and its subfolders shows up here, newest first, ready to play, trim or edit.</p>}
      {folder && files.length === 0 && <p className="empty">No video files in this folder.</p>}
      <div className="clips-body">
        <ul className="clips-grid" aria-label="Clips">
          {files.map((f) => (
            <li key={f.path}>
              <button className={`clip-card ${selected?.path === f.path ? 'selected' : ''}`} onClick={() => void open(f)} onDoubleClick={() => void run(() => useEditor.getState().editFile(f.path, null))} title="Click to open, double-click to edit in a new project">
                <Thumb path={f.path} />
                <span className="project-name">{f.name}</span>
                <span className="project-meta">{f.folder ? `${f.folder} · ` : ''}{formatDate(f.modified)} · {formatBytes(f.sizeBytes)}</span>
              </button>
            </li>
          ))}
        </ul>
        {selected && (
          <section className="clip-viewer" aria-label="Clip viewer">
            {playable ? (
              <video ref={video} key={selected.path} src={mediaUrl(selected.path)} controls />
            ) : (
              <p className="notice">This clip uses {info?.videoCodec}, which cannot be played here directly. “Edit in new project” converts it for preview automatically; trimming still works.</p>
            )}
            {info && range && (
              <>
                <p className="project-meta">{info.width}×{info.height} · {info.fps} fps · {info.videoCodec} · {formatDuration(info.duration)}</p>
                <div className="trim-row">
                  <button onClick={() => mark('in')} disabled={!playable} title="Start the trim at the current position">Set start</button>
                  <span className="timecode">{precise(range.in)} → {precise(range.out)}</span>
                  <button onClick={() => mark('out')} disabled={!playable} title="End the trim at the current position">Set end</button>
                  <button onClick={() => setRange({ in: 0, out: info.duration })} disabled={!trimmed}>Reset</button>
                </div>
                <div className="trim-row">
                  <button disabled={busy || !trimmed} onClick={() => void saveTrim()} title="Copies the chosen part without re-encoding">Save trimmed copy</button>
                  <button className="primary" disabled={busy} onClick={() => void edit(null)}>Edit {trimmed ? 'this part ' : ''}in new project</button>
                  <select value="" disabled={busy || !projects.length} onChange={(e) => e.target.value && void edit(e.target.value)} aria-label="Add to an existing project">
                    <option value="">Add to project…</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <p className="hint">Nothing is exported or copied to use a clip in the editor: the project points at your original file. A saved trim starts on the nearest keyframe at or before your start point.</p>
              </>
            )}
            {message && <p className="notice small" role="status">{message}</p>}
          </section>
        )}
      </div>
    </div>
  )
}
