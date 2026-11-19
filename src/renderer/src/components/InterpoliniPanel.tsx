import { useEffect, useState } from 'react'
import type { InterpoliniStatus } from '@shared/types'
import { type InterpoliniSettings, WEIGHTINGS, WEIGHTING_LABELS, blendWeights, describeBlend, resolveRate } from '@shared/render/interpolini'
import { Num, Row } from './fields'

interface Props {
  settings: InterpoliniSettings
  onChange(next: InterpoliniSettings): void
  /** Frame rate of the finished video: interpolini blends down to exactly this. */
  exportFps: number
  /** Frame rate of the footage being exported. */
  clipFps: number
  /** What the target rate is called in the "Blend down to" line. */
  blendLabel?: string
}

/** Settings for interpolini's motion blur, under the names interpolini itself uses. */
export function InterpoliniPanel({ settings, onChange, exportFps, clipFps, blendLabel = "the export's frame rate" }: Props) {
  const [status, setStatus] = useState<InterpoliniStatus | null>(null)
  const [progress, setProgress] = useState<{ label: string; fraction: number } | null>(null)
  const [problem, setProblem] = useState('')
  const [customText, setCustomText] = useState(`[${settings.custom.join(', ')}]`)
  const set = (patch: Partial<InterpoliniSettings>) => onChange({ ...settings, ...patch })

  useEffect(() => {
    void window.api.interpolini.status().then(setStatus)
    return window.api.interpolini.onProgress(setProgress)
  }, [])

  const install = async () => {
    setProblem('')
    try {
      setStatus(await window.api.interpolini.install())
    } catch (err) {
      setProblem((err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setProgress(null)
    }
  }

  const high = resolveRate(settings.fps, clipFps)
  const weights = blendWeights(high, exportFps, settings.intensity, settings.weighting, settings.custom)
  const tallest = Math.max(...weights)

  return (
    <div className="interpolini" aria-label="interpolini settings">
      <div className="interpolini-status" role="status">
        {status === null ? 'Looking for interpolini…' : status.path ? <>interpolini found · {status.info}</> : (
          <>
            {status.info}{' '}
            {status.canAutoInstall ? <button onClick={() => void install()} disabled={Boolean(progress)}>Download interpolini</button> : <span className="dim">Install it from github.com/Z1xus/interpolini and put interpolini-cli on your PATH.</span>}
          </>
        )}
        {progress && <progress value={progress.fraction} max={1} aria-label={progress.label} />}
        {problem && <p className="notice small">{problem}</p>}
      </div>
      <p className="hint">
        interpolini interpolates your footage to a very high frame rate with SVP or the RIFE AI model on your graphics card, then blends it back down. It needs a graphics card with Vulkan support and fetches its AI models the first time it runs. Blurs the footage only; text and graphics added in the editor are not blurred.
      </p>
      <Row label="Engine">
        <select value={settings.engine} onChange={(e) => set({ engine: e.target.value as InterpoliniSettings['engine'] })} aria-label="Interpolation engine">
          <option value="svp">SVP (default)</option>
          <option value="rife">RIFE (AI)</option>
        </select>
      </Row>
      <Row label="Interpolate to">
        <input value={settings.fps} onChange={(e) => set({ fps: e.target.value.trim() })} aria-label="Interpolation fps" title="Frames per second, e.g. 960, or a multiple of the clip's rate, e.g. x16" />
        <span className="dim">fps (or x16)</span>
      </Row>
      <Row label="Blend down to">
        <span className="dim">{exportFps} fps ({blendLabel})</span>
      </Row>
      <Num label="Intensity" value={settings.intensity} min={0} max={10} step={0.05} onChange={(v) => set({ intensity: v })} />
      <Row label="Weighting">
        <select value={settings.weighting} onChange={(e) => set({ weighting: e.target.value as InterpoliniSettings['weighting'] })} aria-label="Blend weighting">
          {WEIGHTINGS.map((w) => <option key={w} value={w}>{WEIGHTING_LABELS[w]}</option>)}
        </select>
      </Row>
      {settings.weighting === 'custom' && (
        <Row label="Custom curve">
          <input
            value={customText}
            aria-label="Custom weights"
            onChange={(e) => {
              setCustomText(e.target.value)
              const values = e.target.value.replace(/[[\]]/g, '').split(',').map((v) => Number(v.trim()))
              if (values.length && values.every((v) => Number.isFinite(v) && v > 0)) set({ custom: values })
            }}
          />
        </Row>
      )}
      <div className="weights" aria-label="How the frames of one blend are weighted" title="Weights of the frames blended into each output frame (oldest on the left)">
        {weights.map((w, i) => <span key={i} style={{ height: `${Math.max(2, (w / tallest) * 100)}%` }} />)}
      </div>
      <p className="hint blur-hint">{describeBlend(settings, clipFps, exportFps)}</p>
      <Num label="Gamma" value={settings.gamma} min={1} max={10} step={0.05} onChange={(v) => set({ gamma: v })} />
      <Row label="Duplicates">
        <label title="Removes repeated frames, typical of game capture, before interpolating"><input type="checkbox" checked={settings.dedup} onChange={(e) => set({ dedup: e.target.checked })} aria-label="Remove duplicate frames" /> Remove duplicate frames</label>
      </Row>
      <details>
        <summary>More interpolini settings</summary>
        <Row label="Half-size search">
          <label><input type="checkbox" checked={settings.half} onChange={(e) => set({ half: e.target.checked })} /> Motion search on a half-size picture (faster)</label>
        </Row>
        <Row label="Speed">
          <select value={settings.speed} onChange={(e) => set({ speed: e.target.value as InterpoliniSettings['speed'] })}>
            {['medium', 'fast', 'faster', 'fastest'].map((v) => <option key={v}>{v}</option>)}
          </select>
        </Row>
        <Row label="Tuning">
          <select value={settings.tuning} onChange={(e) => set({ tuning: e.target.value as InterpoliniSettings['tuning'] })}>
            {['weak', 'smooth', 'film', 'animation'].map((v) => <option key={v}>{v}</option>)}
          </select>
        </Row>
        <Row label="Algorithm">
          <select value={settings.algorithm} onChange={(e) => set({ algorithm: e.target.value as InterpoliniSettings['algorithm'] })}>
            <option value="2">Sharp</option><option value="13">Standard</option><option value="23">Smooth</option>
          </select>
        </Row>
      </details>
    </div>
  )
}
