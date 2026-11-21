import { useEffect, useMemo, useState } from 'react'
import type { ExportProgress, ExportSettings } from '@shared/types'
import { projectDuration } from '@shared/timeline/ops'
import { sliceProject } from '@shared/timeline/range'
import { useUi } from '../ui'
import { losslessPlan } from '@shared/render/lossless'
import { useEditor } from '../store'
import { formatDuration } from '../format'
import { Num, Row } from './fields'
import { InterpoliniPanel } from './InterpoliniPanel'
import { loadBlurSettings } from '../blur'
import { vegasWindow } from '@shared/render/vegasBlend'
import { EXPORT_PRESETS, applyPreset, presetFileName, shapeMismatch } from '@shared/render/presets'

const HEIGHTS = [720, 1080, 1440, 2160]
const QUALITY = [
  { label: 'Highest', crf: 14 },
  { label: 'High', crf: 18 },
  { label: 'Medium', crf: 23 },
  { label: 'Small file', crf: 28 }
]

export function ExportDialog({ onClose }: { onClose(): void }) {
  const wholeProject = useEditor((s) => s.project!)
  const rangeIn = useUi((u) => u.rangeIn)
  const rangeOut = useUi((u) => u.rangeOut)
  const hasRange = rangeIn !== null && rangeOut !== null && rangeOut > rangeIn
  const [useRange, setUseRange] = useState(true)
  /** What is exported: the whole timeline, or only the part between the in and out marks. */
  const regionOnly = hasRange && useRange
  const project = useMemo(() => (regionOnly ? sliceProject(wholeProject, rangeIn!, rangeOut!) : wholeProject), [regionOnly, wholeProject, rangeIn, rangeOut])
  const duration = projectDuration(project)
  const aspect = project.settings.width / project.settings.height
  // "1080p" means the short side is 1080, whatever the orientation.
  const sizeFor = (short: number): [number, number] => (aspect >= 1 ? [Math.round((short * aspect) / 2) * 2, short] : [short, Math.round(short / aspect / 2) * 2])
  const [settings, setSettings] = useState<ExportSettings>({
    outputPath: '',
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    codec: 'h264',
    crf: 18,
    audioBitrateKbps: 192,
    normalizeAudio: false,
    motionBlur: { mode: 'off', amount: 0.75, samples: 16, weighting: 'gaussian', interpolini: loadBlurSettings() },
    pixelScaling: Boolean(project.settings.pixelScaling)
  })
  const [useBitrate, setUseBitrate] = useState(false)
  const [encoders, setEncoders] = useState<Record<string, { ok: boolean; reason: string }> | null>(null)
  useEffect(() => void window.api.exporter.encoders().then(setEncoders).catch(() => undefined), [])
  /** The fastest frame rate among the footage in the project (what a Vegas-style resample blends down from). */
  const footageFps = Math.max(1, ...project.media.filter((m) => m.kind === 'video').map((m) => m.fps ?? project.settings.fps))
  const vegasNote = (src: number, out: number, intensity: number): string => { const w = vegasWindow(src, out, intensity); return w.weights.length <= 1 ? `The footage is ${Math.round(src)} fps and the export ${out} fps, so each exported frame is one footage frame and nothing is blended. Use footage with a higher frame rate (for example 120 or 240 fps) for a blur.` : `Each ${out} fps frame blends ${w.weights.length} frames of the ${Math.round(src)} fps footage (weights ${w.weights.map((x) => Math.round(x / Math.min(...w.weights))).join(' : ')}).` }
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const plan = losslessPlan(project)
  const [lossless, setLossless] = useState(false)
  const [fast, setFast] = useState<{ state: 'running' | 'done' | 'error'; text: string; path?: string } | null>(null)
  const useLossless = lossless && plan.ok
  const set = (patch: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...patch }))

  const [batch, setBatch] = useState<string[]>([])
  const [queue, setQueue] = useState<{ id: string; state: 'waiting' | 'running' | 'done' | 'failed'; text: string }[]>([])
  const [preset, setPreset] = useState('')
  const [resumeNote, setResumeNote] = useState('')
  useEffect(() => window.api.exporter.onProgress((p) => {
    if (p.message?.startsWith('Continuing')) setResumeNote(p.message)
    setProgress((cur) => (jobId === null || p.jobId === jobId || cur === null ? p : cur))
  }), [jobId])

  const running = fast?.state === 'running' || progress?.state === 'preparing' || progress?.state === 'rendering' || progress?.state === 'finishing'
  const short = Math.min(settings.width, settings.height)

  const browse = async () => {
    const path = await window.api.exporter.pickPath(`${project.name.replace(/[\\/:*?"<>|]/g, '_')}.mp4`)
    if (path) set({ outputPath: path })
    return path
  }

  const start = async () => {
    const outputPath = settings.outputPath || (await browse())
    if (!outputPath) return
    setProgress(null)
    setFast(null)
    setResumeNote('')
    setJobId(null)
    if (useLossless) {
      setFast({ state: 'running', text: 'Copying without re-encoding…' })
      try {
        const seconds = await window.api.exporter.lossless(project, outputPath)
        setFast({ state: 'done', text: `Export finished in ${seconds.toFixed(1)} s, at the original quality.`, path: outputPath })
      } catch (err) {
        setFast({ state: 'error', text: (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '') })
      }
      return
    }
    const final = { ...settings, outputPath, videoBitrateKbps: useBitrate ? settings.videoBitrateKbps ?? 12000 : undefined }
    try {
      setJobId(await window.api.exporter.start(project, final))
    } catch (err) {
      setProgress({ jobId: '', state: 'error', frame: 0, totalFrames: 0, elapsedMs: 0, message: (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''), outputPath })
    }
  }

  /** Resolves when the job reaches a final state. */
  const waitForJob = (id: string): Promise<ExportProgress> =>
    new Promise((resolve) => {
      const off = window.api.exporter.onProgress((p) => {
        if (p.jobId === id && (p.state === 'done' || p.state === 'error' || p.state === 'cancelled')) {
          off()
          resolve(p)
        }
      })
    })

  /** Exports the project once for every ticked preset, one after another, next to the chosen file. */
  const runBatch = async () => {
    const base = settings.outputPath || (await browse())
    if (!base) return
    const chosen = EXPORT_PRESETS.filter((p) => batch.includes(p.id))
    setQueue(chosen.map((p) => ({ id: p.id, state: 'waiting', text: '' })))
    for (const p of chosen) {
      const mark = (state: 'running' | 'done' | 'failed', text = ''): void => setQueue((q) => q.map((e) => (e.id === p.id ? { ...e, state, text } : e)))
      mark('running')
      try {
        const out = presetFileName(base, p)
        const id = await window.api.exporter.start(project, { ...applyPreset(p, project.settings, settings), outputPath: out })
        setJobId(id)
        const final = await waitForJob(id)
        mark(final.state === 'done' ? 'done' : 'failed', final.state === 'done' ? out : final.message ?? final.state)
        if (final.state === 'cancelled') break
      } catch (err) {
        mark('failed', (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
      }
    }
  }

  const percent = progress ? Math.round((progress.frame / progress.totalFrames) * 100) : 0

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Export video">
      <div className="modal">
        <header>
          <h2>Export video</h2>
          <button onClick={onClose} disabled={running} aria-label="Close">×</button>
        </header>

        {duration <= 0 ? (
          <p className="hint">The timeline is empty. Add a clip before exporting.</p>
        ) : (
          <>
            <div className="lossless-choice">
              <label>
                <input type="checkbox" disabled={!plan.ok || running} checked={useLossless} onChange={(e) => setLossless(e.target.checked)} /> <strong>Fast export (no re-encoding)</strong>
              </label>
              <p className="hint">
                {plan.ok
                  ? 'Copies the original video and audio exactly: no quality loss, original frame rate (including 120 and 240 fps), finished in seconds. Each cut starts on the nearest keyframe at or before the point you chose, so a cut can begin slightly early.'
                  : `Not available for this timeline because ${plan.reason}. It works when the timeline is only straight cuts of one file (or matching files) on a single track.`}
              </p>
            </div>
            <fieldset disabled={running}>
              {hasRange && (
                <Row label="Region">
                  <label title="The part of the timeline between the in mark (I) and the out mark (O)"><input type="checkbox" aria-label="Export only the selected region" checked={useRange} onChange={(e) => setUseRange(e.target.checked)} /> Export only the selected region: {rangeIn!.toFixed(2)} s to {rangeOut!.toFixed(2)} s ({(rangeOut! - rangeIn!).toFixed(2)} s)</label>
                </Row>
              )}
              <Row label="Save to">
                <input readOnly value={settings.outputPath} placeholder="Choose a file…" className="grow" aria-label="Output file" />
                <button onClick={() => void browse()}>Browse</button>
              </Row>
              {useLossless ? null : <>
              <Row label="Preset">
                <select value={preset} aria-label="Export preset" onChange={(e) => { setPreset(e.target.value); const p = EXPORT_PRESETS.find((x) => x.id === e.target.value); if (p) { setSettings((cur) => applyPreset(p, project.settings, cur)); setUseBitrate(false) } }}>
                  <option value="">Choose a destination…</option>
                  {['Video sites', 'Social', 'Sharing', 'Archive'].map((g) => <optgroup key={g} label={g}>{EXPORT_PRESETS.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
                </select>
              </Row>
              {preset && (() => { const p = EXPORT_PRESETS.find((x) => x.id === preset)!; return <p className="hint">{p.note}{shapeMismatch(p, project.settings) ? ' Your project is a different shape, so the picture sits inside the frame with bars; change the project format in Properties to fill it.' : ''}</p> })()}
              <details className="batch">
                <summary>Export for several places at once</summary>
                <div className="batch-list">
                  {EXPORT_PRESETS.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={batch.includes(p.id)} onChange={(e) => setBatch((b) => (e.target.checked ? [...b, p.id] : b.filter((x) => x !== p.id)))} /> {p.name}</label>)}
                </div>
                <button disabled={!batch.length || running} onClick={() => void runBatch()}>Export {batch.length || ''} version{batch.length === 1 ? '' : 's'} one after another</button>
                {queue.length > 0 && (
                  <ol className="queue" aria-label="Export queue">
                    {queue.map((q) => <li key={q.id} className={q.state}>{EXPORT_PRESETS.find((p) => p.id === q.id)!.name}: {q.state}{q.text ? ` · ${q.text}` : ''}</li>)}
                  </ol>
                )}
              </details>
              <Row label="Resolution">
                <select value={HEIGHTS.includes(short) && sizeFor(short)[0] === settings.width ? short : 'custom'} onChange={(e) => { const [w, h] = sizeFor(Number(e.target.value)); if (w) set({ width: w, height: h }) }}>
                  {HEIGHTS.map((h) => <option key={h} value={h}>{h === 2160 ? '4K' : `${h}p`} · {sizeFor(h).join(' × ')}</option>)}
                  <option value="custom">Custom</option>
                </select>
              </Row>
              <Row label="Custom size">
                <input type="number" min={16} max={7680} step={2} value={settings.width} onChange={(e) => set({ width: Number(e.target.value) })} aria-label="Width" />
                <span className="dim">×</span>
                <input type="number" min={16} max={4320} step={2} value={settings.height} onChange={(e) => set({ height: Number(e.target.value) })} aria-label="Height" />
              </Row>
              <Row label="Frame rate">
                <input type="number" min={1} max={1000} step={1} list="fps-presets" value={settings.fps} onChange={(e) => set({ fps: Math.max(1, Math.min(1000, Number(e.target.value) || 30)) })} aria-label="Frame rate" />
                <span className="dim">fps</span>
                <datalist id="fps-presets">{[24, 25, 30, 50, 60, 120, 240].map((f) => <option key={f} value={f} />)}</datalist>
              </Row>
              <Row label="Encoder">
                <select aria-label="Encoder" value={`${settings.codec}-${settings.encoder ?? 'cpu'}`} onChange={(e) => { const [codec, encoder] = e.target.value.split('-'); set({ codec: codec as ExportSettings['codec'], encoder: encoder as 'cpu' | 'nvenc' }) }}>
                  <option value="h264-cpu">H.264 · processor (x264, plays everywhere)</option>
                  <option value="h264-nvenc" disabled={encoders?.h264_nvenc?.ok === false}>H.264 · NVIDIA graphics card (NVENC){encoders?.h264_nvenc?.ok === false ? ' (not available)' : ''}</option>
                  <option value="h265-cpu">H.265 / HEVC · processor (x265, smaller files)</option>
                  <option value="h265-nvenc" disabled={encoders?.hevc_nvenc?.ok === false}>H.265 / HEVC · NVIDIA graphics card (NVENC){encoders?.hevc_nvenc?.ok === false ? ' (not available)' : ''}</option>
                </select>
              </Row>
              {settings.encoder === 'nvenc' && encoders && !(settings.codec === 'h265' ? encoders.hevc_nvenc?.ok : encoders.h264_nvenc?.ok) && <p className="notice small" role="alert">{(settings.codec === 'h265' ? encoders.hevc_nvenc : encoders.h264_nvenc)?.reason}</p>}
              {encoders && (encoders.h264_nvenc?.ok === false) && <p className="hint">The graphics-card choices are off because: {encoders.h264_nvenc.reason}</p>}
              <Row label="Quality">
                <select value={useBitrate ? 'bitrate' : settings.crf} onChange={(e) => { if (e.target.value === 'bitrate') setUseBitrate(true); else { setUseBitrate(false); set({ crf: Number(e.target.value) }) } }}>
                  {QUALITY.map((q) => <option key={q.crf} value={q.crf}>{q.label}</option>)}
                  <option value="bitrate">Fixed bitrate…</option>
                </select>
              </Row>
              {useBitrate && (
                <Row label="Bitrate">
                  <input type="range" aria-label="Bitrate slider" min={1} max={300} step={1} value={Math.round((settings.videoBitrateKbps ?? 12000) / 1000)} onChange={(ev) => set({ videoBitrateKbps: Number(ev.target.value) * 1000 })} style={{ flex: 1 }} />
                  <input type="number" aria-label="Bitrate in Mbps" min={1} max={400} step={1} value={Math.round((settings.videoBitrateKbps ?? 12000) / 1000)} onChange={(ev) => set({ videoBitrateKbps: Math.max(1, Math.min(400, Number(ev.target.value) || 12)) * 1000 })} style={{ width: 70 }} />
                  <strong className="bitrate-readout" aria-live="polite">{Math.round((settings.videoBitrateKbps ?? 12000) / 1000)} Mbps</strong>
                </Row>
              )}
              <Row label="Audio">
                <select value={settings.audioBitrateKbps} onChange={(e) => set({ audioBitrateKbps: Number(e.target.value) })}>
                  {[128, 192, 256, 320].map((b) => <option key={b} value={b}>AAC {b} kbps</option>)}
                </select>
              </Row>
              <Row label="Scaling">
                <label title="Blocky pixels instead of smoothing when footage is enlarged: best for pixel art, game capture and low-resolution clips."><input type="checkbox" checked={settings.pixelScaling} onChange={(e) => set({ pixelScaling: e.target.checked })} aria-label="Sharp pixels" /> Sharp pixels (nearest-neighbour)</label>
              </Row>
              <Row label="Motion blur">
                <select value={settings.motionBlur.mode} onChange={(e) => set({ motionBlur: { ...settings.motionBlur, mode: e.target.value as ExportSettings['motionBlur']['mode'] } })} aria-label="Motion blur">
                  <option value="off">Off</option>
                  <option value="interpolini">interpolini (RIFE / SVP, graphics card)</option>
                  <option value="quick">Frame blending (in this editor: Vegas-style or simple)</option>
                </select>
              </Row>
              {settings.motionBlur.mode === 'interpolini' && (
                <InterpoliniPanel
                  settings={settings.motionBlur.interpolini}
                  onChange={(interpolini) => set({ motionBlur: { ...settings.motionBlur, interpolini } })}
                  exportFps={settings.fps}
                  clipFps={Math.max(1, ...project.media.filter((m) => m.kind === 'video').map((m) => m.fps ?? project.settings.fps))}
                />
              )}
              {settings.motionBlur.mode === 'quick' && (
                <>
                  <Num label={settings.motionBlur.weighting === 'vegas' ? 'Intensity' : 'Blur amount'} value={settings.motionBlur.amount} min={0.1} max={settings.motionBlur.weighting === 'vegas' ? 2 : 1.5} step={0.05} onChange={(v) => set({ motionBlur: { ...settings.motionBlur, amount: v } })} />
                  {settings.motionBlur.weighting !== 'vegas' && <Num label="Blend frames" value={settings.motionBlur.samples} min={4} max={32} step={1} onChange={(v) => set({ motionBlur: { ...settings.motionBlur, samples: v } })} />}
                  <Row label="Weighting">
                    <select value={settings.motionBlur.weighting} onChange={(e) => { const weighting = e.target.value as ExportSettings['motionBlur']['weighting']; set({ motionBlur: { ...settings.motionBlur, weighting, ...(weighting === 'vegas' ? { amount: 1 } : {}) } }) }} aria-label="Blur weighting">
                      <option value="vegas">Vegas (resample: edge frames count half)</option>
                      <option value="equal">Equal (even streaks)</option>
                      <option value="gaussian">Gaussian (soft, centred)</option>
                      <option value="triangle">Triangle</option>
                    </select>
                  </Row>
                  {settings.motionBlur.weighting === 'vegas' && <p className="hint blur-hint" role="status">{vegasNote(footageFps, settings.fps, settings.motionBlur.amount)}</p>}
                  <p className="hint blur-hint">Blends several moments of the timeline inside each frame. It blurs motion that is animated or filmed at a high frame rate; footage shot at a low frame rate stays steppy (use interpolini for that). Cost grows with Blend frames.</p>
                </>
              )}
              <Row label="Loudness">
                <label><input type="checkbox" checked={settings.normalizeAudio} onChange={(e) => set({ normalizeAudio: e.target.checked })} /> Normalise to −14 LUFS</label>
              </Row>
              </>}
            </fieldset>

            {fast && (
              <div className={`export-status ${fast.state}`} role="status">
                <p>{fast.text} {fast.path && <button onClick={() => window.api.system.showInFolder(fast.path!)}>Show in folder</button>}</p>
              </div>
            )}
            {progress && !fast && (
              <div className={`export-status ${progress.state}`} role="status">
                {running && (
                  <>
                    <progress value={progress.frame} max={progress.totalFrames} />
                    {resumeNote && <p>{resumeNote}</p>}
                    <p>
                      {progress.state === 'preparing' ? progress.message ?? 'Preparing footage…' : progress.state === 'finishing' ? 'Finishing the file…' : `Rendering frame ${progress.frame} of ${progress.totalFrames} (${percent}%)`}
                      {progress.etaMs !== undefined && ` · about ${formatDuration(progress.etaMs / 1000)} left`}
                    </p>
                  </>
                )}
                {progress.state === 'done' && (
                  <p>
                    Export finished in {formatDuration(progress.elapsedMs / 1000)}. <button onClick={() => window.api.system.showInFolder(progress.outputPath)}>Show in folder</button>
                  </p>
                )}
                {progress.state === 'cancelled' && <p>Export cancelled. No file was written.</p>}
                {progress.state === 'error' && (
                  <>
                    <p>Export failed. No file was written.</p>
                    <pre>{progress.message}</pre>
                  </>
                )}
              </div>
            )}

            <footer>
              <span className="dim">{formatDuration(duration)} · no watermark</span>
              {running ? <button onClick={() => jobId && void window.api.exporter.cancel(jobId)}>Cancel export</button> : <button className="primary" onClick={() => void start()}>Export</button>}
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
