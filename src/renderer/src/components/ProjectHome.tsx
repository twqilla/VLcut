import { useEffect, useState } from 'react'
import type { ProjectSummary, ToolStatus } from '@shared/types'
import { useEditor } from '../store'
import { formatBytes, formatDate } from '../format'
import { ClipsBrowser } from './ClipsBrowser'
import { SettingsDialog } from './SettingsDialog'
import { importDropped, useDrop, useFileDrop } from '../dropFiles'
import { Icon, type IconName } from './Icon'

const FORMATS = [
  { label: 'YouTube', note: '16:9 · 1920×1080', width: 1920, height: 1080 },
  { label: 'TikTok and Reels', note: '9:16 · 1080×1920', width: 1080, height: 1920 },
  { label: 'Square', note: '1:1 · 1080×1080', width: 1080, height: 1080 },
  { label: 'Portrait', note: '4:5 · 1080×1350', width: 1080, height: 1350 },
  { label: '4K film', note: '16:9 · 3840×2160', width: 3840, height: 2160 }
]

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'type', title: 'Titles and captions', text: 'Click text to edit it in a window. Captions from speech, made on your computer.' },
  { icon: 'sparkles', title: 'Effects you can see', text: 'Every effect shows under its clip with an × to take it off.' },
  { icon: 'music', title: 'Audio tools', text: 'Sound effects on clips, music beat detection, noise reduction and voice-overs.' },
  { icon: 'layers', title: 'Looks and overlays', text: '23 colour looks, light leaks, film grain and flashes.' },
  { icon: 'film', title: 'Templates', text: 'Intros, lower thirds, end cards and social prompts, ready to fill in.' },
  { icon: 'mic', title: 'Record voice-overs', text: 'Speak straight onto the timeline, or type and let a voice read it.' },
  { icon: 'scan', title: 'Smart assistant', text: 'Say "cut all clips to 7 seconds" or "render each clip for TikTok".' },
  { icon: 'library', title: 'Private by design', text: 'No account, no upload, no watermark. Your files stay yours.' }
]

const TIPS = [
  'Drag videos, photos or whole folders from your computer straight into the editor.',
  'Right-click a clip for the things you do most: split, duplicate, remove the sound, delete.',
  'Press ? inside the editor to see every shortcut, and change any of them.',
  'Select several clips and press Ctrl+G to nest them into one clip you can add effects to.',
  'Press F11 for full screen.',
  'Press S to split at the playhead and Delete to remove what is selected.',
  'Ask the assistant for a whole look: "make it cinematic" or "add a neon title saying Hello".'
]

/** A cover picture for a project: a colour pair taken from its id, so every project looks like itself. */
function cover(id: string): React.CSSProperties {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return { background: `linear-gradient(135deg, hsl(${h % 360} 70% 38%), hsl(${(h * 7) % 360} 75% 22%))` }
}

export function ProjectHome() {
  useFileDrop('home')
  const dropOver = useDrop((s) => s.over)
  const dropNote = useDrop((s) => s.note)
  const openProject = useEditor((s) => s.openProject)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [name, setName] = useState('')
  const [tools, setTools] = useState<ToolStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recover, setRecover] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    void window.api.session.state().then((s) => { if (s.unclean && s.lastProject) setRecover(s.lastProject) })
  }, [])
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const [tab, setTabState] = useState<'Projects' | 'Clips'>(() => (localStorage.getItem('home-tab') === 'Clips' ? 'Clips' : 'Projects'))
  const setTab = (t: 'Projects' | 'Clips') => {
    localStorage.setItem('home-tab', t)
    setTabState(t)
  }
  const [usage, setUsage] = useState<{ name: string; bytes: number; clearable: boolean }[] | null>(null)
  const refreshUsage = async () => setUsage(await window.api.storage.usage())
  const refresh = async () => setProjects((await window.api.projects.list()).filter((p) => !p.prepFor))

  useEffect(() => {
    void refresh()
    void window.api.system.tools().then(setTools)
  }, [])

  /** Creates a project, optionally in a ready-made frame shape (the shape is part of the project, not an undo step). */
  const create = async (shape?: { width: number; height: number; label: string }) => {
    const project = await window.api.projects.create(name.trim() || (shape ? `${shape.label} project` : ''))
    await openProject(project.id)
    if (shape) {
      useEditor.getState().apply('Set frame', (p) => ({ ...p, settings: { ...p.settings, width: shape.width, height: shape.height } }))
      useEditor.setState({ past: [], future: [] })
    }
  }

  /** Opens a video from the computer as a new project (the first file), with any others in its library. */
  const openVideo = async () => {
    const assets = await window.api.media.pick()
    if (!assets.length) return
    await useEditor.getState().editFile(assets[0].path, null)
    if (assets.length > 1) await importDropped(assets.slice(1).map((a) => a.path), null)
  }
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => void window.api.window.state().then((w) => setFullscreen(w.fullscreen)), [])
  const toggleFullscreen = () => void window.api.window.toggleFullscreen().then(setFullscreen)
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length))
  useEffect(() => { const t = window.setInterval(() => setTip((n) => (n + 1) % TIPS.length), 9000); return () => window.clearInterval(t) }, [])

  const commitRename = async () => {
    if (!renaming) return
    await window.api.projects.rename(renaming.id, renaming.name)
    setRenaming(null)
    await refresh()
  }

  return (
    <div className={`home ${tab === 'Clips' ? 'wide' : ''}`}>
      <div className="home-bg" aria-hidden="true"><i /><i /><i /></div>
      <header className="home-header hero">
        <div className="hero-top">
          <button className="settings-link" onClick={toggleFullscreen} aria-pressed={fullscreen} title="Full screen (F11)">{fullscreen ? 'Exit full screen' : 'Full screen'}</button>
          <button className="settings-link" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
        <h1 className="brand"><svg viewBox="0 0 512 512" width="64" height="64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5cc8ff" /><stop offset="1" stopColor="#2f6bff" /></linearGradient></defs><rect width="512" height="512" fill="#070b16" /><g fill="none" stroke="url(#lg)" strokeWidth="54"><path d="M70 130L150 392L230 130" /><path d="M318 112V392H452" /></g><path d="M410 444l24-24 24 24-24 24z" fill="#5cc8ff" /></svg><span>VLcut</span></h1>
        <p className="tagline">Cut, style and finish your videos. Free, private, and everything happens on your computer.</p>
        <div className="hero-actions">
          <button className="primary big" onClick={() => void openVideo()}>Open a video…</button>
          <span className="hero-or">or drop videos, photos and folders anywhere in this window</span>
        </div>
      </header>

      {recover && (
        <div className="notice" role="alert" aria-label="Recover project">
          <strong>VLcut did not close properly last time.</strong>
          <br />Your work is saved automatically, and a restore point is kept before every assistant request. You were working on “{recover.name || 'a project'}”.
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => { const id = recover.id; setRecover(null); void openProject(id).catch(() => undefined) }}>Reopen it</button>
            <button onClick={() => setRecover(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {tools && (!tools.ffmpeg || !tools.ffprobe) && (
        <div className="notice" role="alert">
          <strong>FFmpeg could not be started, so importing and exporting will not work.</strong>
          <br />ffmpeg: {tools.ffmpeg ? 'ok' : tools.ffmpegInfo}
          <br />ffprobe: {tools.ffprobe ? 'ok' : tools.ffprobeInfo}
          <br />Looked in: {tools.resourcesPath ? `${tools.resourcesPath}\\bin` : '(not installed)'} and the PATH.
        </div>
      )}

      <nav className="tabs home-tabs" role="tablist">
        {(['Projects', 'Clips'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {tab === 'Clips' ? <ClipsBrowser projects={projects} /> : <>
      <section className="start" aria-label="Start a project">
        <h2>Start a new project</h2>
        <div className="format-cards">
          {FORMATS.map((f) => (
            <button key={f.label} className="format-card" aria-label={`New ${f.label} project`} onClick={() => void create(f)}>
              <span className="format-shape" style={{ aspectRatio: `${f.width} / ${f.height}` }} />
              <strong>{f.label}</strong>
              <small>{f.note}</small>
            </button>
          ))}
        </div>
        <form className="new-project" onSubmit={(e) => { e.preventDefault(); void create() }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" aria-label="New project name" />
          <button type="submit" className="primary">Create project</button>
        </form>
      </section>

      <section className="project-list" aria-label="Projects">
        <h2>Your projects</h2>
        {projects.length === 0 && <p className="empty">No projects yet. Pick a shape above, or open a video, to start.</p>}
        <div className="project-grid">
        {projects.map((p) => (
          <article key={p.id} className="project-row">
            <div className="project-cover" style={cover(p.id)} aria-hidden="true"><span>{(p.name.trim()[0] ?? '·').toUpperCase()}</span></div>
            {renaming?.id === p.id ? (
              <input
                autoFocus
                value={renaming.name}
                onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename()
                  if (e.key === 'Escape') setRenaming(null)
                }}
                aria-label="Project name"
              />
            ) : (
              <button className="project-open" onClick={() => void openProject(p.id)}>
                <span className="project-name">{p.name}</span>
                <span className="project-meta">
                  {p.mediaCount} media · edited {formatDate(p.updatedAt)}
                </span>
              </button>
            )}
            <div className="row-actions">
              <button onClick={() => setRenaming({ id: p.id, name: p.name })}>Rename</button>
              <button onClick={() => void window.api.projects.duplicate(p.id).then(refresh)}>Duplicate</button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm(`Delete "${p.name}"? Your media files are not touched.`)) void window.api.projects.remove(p.id).then(refresh)
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
        </div>
      </section>

      <section className="features" aria-label="What you can do">
        <h2>What you can do</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <span className="feature-icon"><Icon name={f.icon} size={20} /></span>
              <strong>{f.title}</strong>
              <span>{f.text}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="tip" role="status" key={tip}><strong>Tip</strong> {TIPS[tip]}</p>

      <details className="storage" onToggle={(e) => (e.currentTarget.open ? void refreshUsage() : undefined)}>
        <summary>Storage on this computer</summary>
        {tools && <p className="project-meta" title={tools.ffmpeg ?? ''}>Video engine: {tools.ffmpeg ? tools.ffmpegInfo : 'not working'}</p>}
        {usage === null ? <p className="empty">Measuring…</p> : (
          <>
            {usage.map((u) => (
              <div key={u.name} className="storage-row">
                <span>{u.name}</span>
                <span className="project-meta">{formatBytes(u.bytes)}</span>
                {u.clearable ? <button disabled={u.bytes === 0} onClick={() => void window.api.storage.clear(u.name).then(refreshUsage)}>Clear</button> : <span />}
              </div>
            ))}
            <p className="project-meta">Cleared caches are rebuilt automatically when needed. Your media files and projects are never touched. <button onClick={() => window.api.storage.openFolder()}>Open folder</button></p>
          </>
        )}
      </details>
      </>}
      {dropOver && <div className="drop-overlay" role="status"><strong>Drop a video to start a project</strong><span>The first file opens as a new project; the others go into its library.</span></div>}
      {dropNote && <div className="drop-toast" role="status">{dropNote}</div>}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
