import { useEffect, useState } from 'react'
import { type InterpoliniSettings, cfgFileName, cfgToInterpolini, interpoliniToCfg } from '@shared/render/interpolini'
import { useEditor } from '../store'
import { loadBlurSettings, saveBlurSettings } from '../blur'
import { InterpoliniPanel } from './InterpoliniPanel'

/** The interpolini studio: its own window with its own look, for the motion-blur settings, saved configurations and the status of the program. */
export function InterpoliniStudio({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project!)
  const [settings, setSettings] = useState<InterpoliniSettings>(loadBlurSettings)
  const [names, setNames] = useState<string[]>([])
  const [chosen, setChosen] = useState('')
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState('')
  const clipFps = Math.max(1, ...project.media.filter((m) => m.kind === 'video').map((m) => m.fps ?? project.settings.fps))
  useEffect(() => { saveBlurSettings(settings) }, [settings])
  const refresh = async (select?: string): Promise<void> => {
    const list = await window.api.interpolini.cfg.list()
    setNames(list)
    if (select !== undefined) setChosen(select)
  }
  useEffect(() => void refresh(), [])
  const clean = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  const run = async (work: () => Promise<void>): Promise<void> => { setNote(''); try { await work() } catch (e) { setNote(clean(e)) } }
  const save = (name: string) => run(async () => {
    const saved = await window.api.interpolini.cfg.save(name, interpoliniToCfg(settings, `VLcut interpolini settings: ${cfgFileName(name)}`))
    await refresh(saved)
    setNewName('')
    setNote(`Saved “${saved}”.`)
  })
  const load = (name: string) => run(async () => { setSettings(cfgToInterpolini(await window.api.interpolini.cfg.read(name))); setNote(`Loaded “${name}”.`) })

  return (
    <div className="modal-backdrop studio-backdrop" role="dialog" aria-modal="true" aria-label="Interpolini studio">
      <div className="studio">
        <header>
          <h2><span className="studio-mark">◆</span> Interpolini studio</h2>
          <span className="studio-sub">Motion blur and frame blending</span>
          <span className="spacer" />
          <button onClick={onClose} aria-label="Close interpolini studio">×</button>
        </header>
        <div className="studio-body">
          <aside className="studio-side">
            <h3>Configurations</h3>
            <p className="hint">Save the settings under a name and switch between them. Each one is a plain .cfg file you can also edit in Notepad.</p>
            <select value={chosen} size={Math.min(8, Math.max(3, names.length))} aria-label="Saved configurations" onChange={(e) => setChosen(e.target.value)}>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="studio-buttons">
              <button disabled={!chosen} onClick={() => void load(chosen)}>Load</button>
              <button disabled={!chosen} onClick={() => void save(chosen)} title="Overwrite the selected configuration with the current settings">Update</button>
              <button disabled={!chosen} onClick={() => void run(async () => { await window.api.interpolini.cfg.edit(chosen); setNote('Opened in Notepad. Save the file there, then press Load.') })}>Edit in Notepad</button>
              <button disabled={!chosen} className="danger" onClick={() => void run(async () => { await window.api.interpolini.cfg.remove(chosen); await refresh(''); setNote('Deleted.') })}>Delete</button>
            </div>
            <div className="studio-new">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New configuration name" aria-label="New configuration name" />
              <button className="primary" disabled={!newName.trim()} onClick={() => void save(newName)}>Save as new</button>
            </div>
            {note && <p className="hint" role="status">{note}</p>}
            <h3>Vegas-style frame blending</h3>
            <button onClick={() => setSettings({ ...settings, interpolate: false, weighting: 'vegas', intensity: 1, blendFps: undefined })} title="Interpolation off, intensity 1.0, Vegas weighting, blending down to the export frame rate">Use the Vegas setup</button>
          </aside>
          <section className="studio-main">
            <InterpoliniPanel settings={settings} onChange={setSettings} exportFps={project.settings.fps} clipFps={clipFps} blendLabel="the project's frame rate" />
            <p className="hint">These settings are used by Blur in Properties, and are the starting point in the Export window.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
