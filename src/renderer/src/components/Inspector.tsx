import { useState } from 'react'
import type { AnimProp, Clip, Easing, Mask, ShapeProps, TextProps, VizProps } from '@shared/types'
import { DEFAULT_MASK } from '@shared/timeline/model'
import * as ops from '@shared/timeline/ops'
import { propAt, upsertKeyframe } from '@shared/timeline/keyframes'
import { transitionEase } from '@shared/effects/more'
import { shapeTransitionProgress } from '@shared/timeline/ops'
import { EFFECTS, FONT_CATEGORIES, TEXT_ANIMATIONS, TEXT_OUT_ANIMATIONS, TRANSITIONS, effectSpec, makeEffect } from '@shared/effects/registry'
import { useEditor } from '../store'
import { player, usePlayback, usePreviewTool } from '../engine/player'
import { formatBytes, formatDuration } from '../format'
import { Num, Row, Section } from './fields'
import { loadCustomStacks, saveCustomStacks } from './Sidebar'
import { loadCustomFonts, useCustomFonts } from '../engine/fonts'
import { BlurSection } from './BlurSection'
import { Scopes } from './Scopes'
import { applyLook, captureLook, sanitizeLook } from '@shared/templates'
import { AUDIO_EFFECTS, type AudioEffect, audioEffectSpec, makeAudioEffect } from '@shared/effects/audio'
import { attachToTrack, hyperlapseSelection, reframeSelection, removeStabilization, stabilizeSelection, trackFromPick, useMotion } from '../motion'
import { bakeLut } from '../engine/bakeLut'
import { encodeLut, decodeLut, parseCube, serializeCube } from '@shared/color/cube'
import { newId } from '@shared/timeline/model'
import { withMaskKey, withoutKeys } from '@shared/timeline/mask'
import type { BlendMode } from '@shared/types'
import { blurFile, blurSelection, unblurSelection } from '../blur'
import { describeBlurred, sourceOf } from '@shared/timeline/blur'

const KEY_TOLERANCE = 1 / 60
const RESOLUTIONS: [string, number, number][] = [
  ['1080p · 16:9', 1920, 1080], ['1440p · 16:9', 2560, 1440], ['4K · 16:9', 3840, 2160],
  ['1080 × 1920 · 9:16', 1080, 1920], ['1080 × 1080 · 1:1', 1080, 1080], ['1080 × 1350 · 4:5', 1080, 1350]
]

const BLEND_MODES: [string, string][] = [
  ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['softLight', 'Soft light'], ['hardLight', 'Hard light'],
  ['colorDodge', 'Colour dodge'], ['colorBurn', 'Colour burn'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
  ['add', 'Add'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Colour'], ['luminosity', 'Luminosity']
]

function clipLabel(c: Clip, media: { id: string; name: string }[]): string {
  if (c.text) return c.text.content.replace(/\s+/g, ' ').slice(0, 22) || 'Text'
  if (c.shape) return 'Shape'
  return media.find((m) => m.id === c.assetId)?.name ?? 'Adjustment'
}

function ProjectPanel() {
  const project = useEditor((s) => s.project!)
  const apply = useEditor((s) => s.apply)
  const { width, height, fps } = project.settings
  const set = (patch: Partial<typeof project.settings>) => apply('Change project settings', (p) => ({ ...p, settings: { ...p.settings, ...patch } }), { coalesce: 'settings' })
  const preset = RESOLUTIONS.find(([, w, h]) => w === width && h === height)
  return (
    <>
      <Section title="Project">
        <Row label="Format">
          <select
            value={preset ? `${width}x${height}` : 'custom'}
            onChange={(e) => {
              const [w, h] = e.target.value.split('x').map(Number)
              if (w && h) set({ width: w, height: h })
            }}
          >
            {RESOLUTIONS.map(([label, w, h]) => (
              <option key={label} value={`${w}x${h}`}>{label}</option>
            ))}
            {!preset && <option value="custom">Custom</option>}
          </select>
        </Row>
        <Row label="Width">
          <input type="number" min={16} max={7680} step={2} value={width} onChange={(e) => set({ width: Math.max(16, Math.round(Number(e.target.value) / 2) * 2) })} />
        </Row>
        <Row label="Height">
          <input type="number" min={16} max={4320} step={2} value={height} onChange={(e) => set({ height: Math.max(16, Math.round(Number(e.target.value) / 2) * 2) })} />
        </Row>
        <Row label="Scaling">
          <label title="Blocky pixels instead of smoothing when footage is enlarged: best for pixel art, game capture and low-resolution clips."><input type="checkbox" aria-label="Sharp pixels" checked={Boolean(project.settings.pixelScaling)} onChange={(e) => set({ pixelScaling: e.target.checked })} /> Sharp pixels (nearest-neighbour)</label>
        </Row>
        <Row label="Frame rate">
          <input type="number" min={1} max={1000} step={1} list="project-fps" value={fps} onChange={(e) => set({ fps: Math.max(1, Math.min(1000, Number(e.target.value) || 30)) })} />
          <span className="dim">fps</span>
          <datalist id="project-fps">{[24, 25, 30, 50, 60, 120, 240].map((f) => <option key={f} value={f} />)}</datalist>
        </Row>
      </Section>
      <p className="hint">Select a clip on the timeline to edit its properties.</p>
    </>
  )
}

function AssetPanel({ assetId }: { assetId: string }) {
  const asset = useEditor((s) => s.project!.media.find((m) => m.id === assetId))
  if (!asset) return null
  const rows: [string, string][] = [
    ['Name', asset.name],
    ['Type', asset.kind],
    ...(asset.kind !== 'image' ? ([['Duration', formatDuration(asset.duration)]] as [string, string][]) : []),
    ...(asset.width ? ([['Resolution', `${asset.width} × ${asset.height}`]] as [string, string][]) : []),
    ...(asset.fps ? ([['Frame rate', `${asset.fps} fps`]] as [string, string][]) : []),
    ...(asset.videoCodec ? ([['Video codec', asset.videoCodec]] as [string, string][]) : []),
    ['Audio', asset.hasAudio ? asset.audioCodec ?? 'yes' : 'none'],
    ['Size', formatBytes(asset.sizeBytes)],
    ['Location', asset.path]
  ]
  const project = useEditor.getState().project!
  return (
    <>
    <Section title="File" actions={asset.missing ? <button className="primary" onClick={() => void useEditor.getState().relinkMedia(asset.id)}>Locate file…</button> : <button onClick={() => useEditor.getState().insertAsset(asset.id)}>Add to timeline</button>}>
      {asset.missing && <p className="notice small">This file is no longer at its saved location. Locate it to bring its clips back.</p>}
      <dl className="facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
    {asset.kind === 'video' && !asset.missing && (
      <BlurSection
        title="Motion blur"
        blendFps={project.settings.fps}
        clipFps={asset.fps ?? project.settings.fps}
        action="Make a blurred copy"
        onBlur={(settings) => void blurFile(asset.id, settings)}
        blurredNote={asset.blurredFrom ? describeBlurred(asset.blurredFrom) : undefined}
        explain="Adds a motion-blurred copy of this file to the library. Drag it onto the timeline like any other clip: no export needed."
      />
    )}
    </>
  )
}

/** Motion blur for a clip: blurs the footage it uses once, then the clip plays the blurred copy. */
function ClipBlur({ clip }: { clip: Clip }) {
  const project = useEditor((s) => s.project!)
  const count = useEditor((s) => s.selection.length)
  const src = sourceOf(project, clip)
  if (!src || src.asset.kind !== 'video') return null
  const here = project.media.find((m) => m.id === clip.assetId)
  return (
    <BlurSection
      title="Motion blur"
      blendFps={project.settings.fps}
      clipFps={src.asset.fps ?? project.settings.fps}
      action={here?.blurredFrom ? 'Blur again with these settings' : count > 1 ? `Blur ${count} selected clips` : 'Blur this clip'}
      onBlur={(settings) => void blurSelection(settings)}
      blurredNote={here?.blurredFrom ? describeBlurred(here.blurredFrom) : undefined}
      onRemove={here?.blurredFrom ? unblurSelection : undefined}
      explain="Your original file is kept. The blurred copy plays in the preview as soon as it is ready and is used by the export, so nothing has to be exported first. Sound is kept."
    />
  )
}

const CURVE_PRESETS: [string, [number, number, number, number]][] = [
  ['Linear', [0, 0, 1, 1]], ['Ease', [0.25, 0.1, 0.25, 1]], ['In', [0.42, 0, 1, 1]], ['Out', [0, 0, 0.58, 1]], ['In-out', [0.42, 0, 0.58, 1]],
  ['Back out', [0.34, 1.56, 0.64, 1]], ['Back in', [0.36, 0, 0.66, -0.56]], ['Snap', [0.9, 0, 0.1, 1]]
]

/** A small Bézier curve editor: drag the two handles; the preset buttons set common curves (some overshoot). */
function CurveEditor({ value, onChange }: { value: [number, number, number, number]; onChange: (v: [number, number, number, number]) => void }) {
  const [open, setOpen] = useState(false)
  const [x1, y1, x2, y2] = value
  const [W, H, PAD] = [168, 132, 18]
  // Plot area: x 0..1 across, y -0.6..1.6 up (so overshoot is visible).
  const px = (x: number): number => PAD + x * (W - 2 * PAD)
  const py = (y: number): number => PAD + ((1.6 - y) / 2.2) * (H - 2 * PAD)
  const fromPx = (cx: number, cy: number): [number, number] => [Math.max(0, Math.min(1, (cx - PAD) / (W - 2 * PAD))), Math.max(-0.6, Math.min(1.6, 1.6 - ((cy - PAD) / (H - 2 * PAD)) * 2.2))]
  const drag = (which: 0 | 1) => (e: React.PointerEvent<SVGCircleElement>) => {
    e.preventDefault()
    const svg = e.currentTarget.ownerSVGElement!
    const move = (ev: PointerEvent): void => {
      const r = svg.getBoundingClientRect()
      const [x, y] = fromPx(((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * H)
      onChange(which === 0 ? [round2(x), round2(y), x2, y2] : [x1, y1, round2(x), round2(y)])
    }
    const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <span className="curve">
      <button type="button" className={open ? 'on' : ''} aria-label="Edit curve" title="Edit the easing curve" onClick={() => setOpen(!open)}>∿</button>
      {open && (
        <div className="curve-pop" role="dialog" aria-label="Easing curve">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
            <rect x={px(0)} y={py(1)} width={px(1) - px(0)} height={py(0) - py(1)} fill="none" stroke="#2a3a5a" />
            <line x1={px(0)} y1={py(0)} x2={px(x1)} y2={py(y1)} stroke="#38b6ff" strokeOpacity={0.5} />
            <line x1={px(1)} y1={py(1)} x2={px(x2)} y2={py(y2)} stroke="#38b6ff" strokeOpacity={0.5} />
            <path d={`M ${px(0)} ${py(0)} C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, ${px(1)} ${py(1)}`} fill="none" stroke="#fff" strokeWidth={2} />
            <circle cx={px(x1)} cy={py(y1)} r={6} fill="#38b6ff" onPointerDown={drag(0)} aria-label="Curve handle 1" style={{ cursor: 'grab' }} />
            <circle cx={px(x2)} cy={py(y2)} r={6} fill="#38b6ff" onPointerDown={drag(1)} aria-label="Curve handle 2" style={{ cursor: 'grab' }} />
          </svg>
          <div className="curve-presets">
            {CURVE_PRESETS.map(([name, v]) => <button key={name} type="button" onClick={() => onChange(v)}>{name}</button>)}
          </div>
        </div>
      )}
    </span>
  )
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/** Sound effects for a clip: add, reorder, edit and remove. Exports always include them; the preview plays all but pitch and voice enhance. */
function AudioFxSection({ clip }: { clip: Clip }) {
  const { updateSelected } = useEditor.getState()
  const list = clip.audioFx ?? []
  const set = (next: AudioEffect[]): void => updateSelected('Audio effects', () => ({ audioFx: next.length ? next : undefined }))
  return (
    <Section
      title="Sound effects"
      actions={
        <select value="" aria-label="Add sound effect" onChange={(e) => e.target.value && set([...list, makeAudioEffect(e.target.value)])}>
          <option value="">+ Add</option>
          {AUDIO_EFFECTS.map((a) => <option key={a.type} value={a.type}>{a.group}: {a.name}</option>)}
        </select>
      }
    >
      {list.length === 0 && <p className="hint">No sound effects. They run in the order shown, before the fades.</p>}
      {list.map((fx, index) => {
        const spec = audioEffectSpec(fx.type)
        if (!spec) return null
        const patch = (change: (e: AudioEffect) => AudioEffect | null, key?: string) =>
          updateSelected('Edit sound effect', (c) => ({ audioFx: (c.audioFx ?? []).flatMap((e) => { if (e.id !== fx.id) return [e]; const n = change(e); return n ? [n] : [] }) }), key)
        return (
          <div key={fx.id} className={`effect ${fx.enabled ? '' : 'off'}`}>
            <header>
              <label><input type="checkbox" checked={fx.enabled} onChange={(e) => patch((x) => ({ ...x, enabled: e.target.checked }))} /> {spec.name}</label>
              <span>
                <button disabled={index === 0} aria-label="Move sound effect up" onClick={() => { const n = [...list]; [n[index - 1], n[index]] = [n[index], n[index - 1]]; set(n) }}>↑</button>
                <button aria-label={`Remove ${spec.name}`} onClick={() => patch(() => null)}>×</button>
              </span>
            </header>
            {spec.params.map((ps) => (
              <Num key={ps.key} label={ps.label} value={fx.params[ps.key] ?? ps.default} min={ps.min} max={ps.max} step={ps.step} onChange={(v) => patch((x) => ({ ...x, params: { ...x.params, [ps.key]: v } }), `afx-${fx.id}-${ps.key}`)} />
            ))}
            {!spec.preview && <p className="hint">Heard in the export; the live preview plays this sound unchanged.</p>}
          </div>
        )
      })}
    </Section>
  )
}

function SpeedRamp({ clip }: { clip: Clip }) {
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(3)
  const [shape, setShape] = useState<ops.RampShape>('linear')
  const time = usePlayback((s) => s.time)
  const ramp = (a: number, b: number) => useEditor.getState().apply('Speed ramp', (p) => ops.rampSpeed(p, clip.id, a, b, 16, shape))
  const inside = time > clip.start + 0.05 && time < clip.start + clip.duration - 0.05
  return (
    <>
      <div className="field">
        <span className="field-label">Ramp</span>
        <input type="number" min={0.1} max={16} step={0.1} value={from} onChange={(e) => setFrom(Number(e.target.value) || 1)} aria-label="Ramp start speed" />
        <span className="dim">→</span>
        <input type="number" min={0.1} max={16} step={0.1} value={to} onChange={(e) => setTo(Number(e.target.value) || 1)} aria-label="Ramp end speed" />
        <button disabled={clip.reversed || from === to} onClick={() => ramp(from, to)}>Apply</button>
      </div>
      <Row label="Ramp shape">
        <select value={shape} aria-label="Ramp shape" onChange={(e) => setShape(e.target.value as ops.RampShape)}>
          {ops.RAMP_SHAPES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Row>
      <p className="hint">Splits the clip into sixteen pieces whose speed follows the shape: from the first speed to the second. “Bell” goes there and back, for a slow-motion hit in the middle (try 1 → 0.25). Each piece stays editable; keyframes on the clip are cleared.</p>
      <Row label="Freeze frame">
        <button disabled={!inside || Boolean(clip.freeze)} title={inside ? 'Holds the picture at the playhead' : 'Move the playhead inside this clip first'} onClick={() => useEditor.getState().apply('Freeze frame', (p) => ops.freezeFrame(p, clip.id, player.time, 2))}>Freeze 2 s at playhead</button>
      </Row>
      <Row label="Hyperlapse">
        <button disabled={clip.reversed || Boolean(clip.freeze)} title="Speeds the clip up with frame blending and steadies it" onClick={() => void hyperlapseSelection(10)}>10× smooth &amp; steady</button>
      </Row>
    </>
  )
}

/** Stabilise, track and reframe: analysis that turns into ordinary keyframes the clip can still be edited with. */
function MotionSection({ clip }: { clip: Clip }) {
  const { busy, note, track } = useMotion()
  const picking = usePreviewTool((s) => s.pickingTrack)
  const pick = usePreviewTool((s) => s.trackPick)
  const project = useEditor((s) => s.project!)
  const [smooth, setSmooth] = useState(0.8)
  const [target, setTarget] = useState('')
  const others = project.tracks.flatMap((t) => t.clips.filter((c) => c.id !== clip.id && (c.text || c.shape || c.assetId)).map((c) => ({ id: c.id, label: `${t.name} · ${clipLabel(c, project.media)}` })))
  const mine = pick?.clipId === clip.id
  const wrongShape = project.settings.width / project.settings.height
  return (
    <Section title="Camera & motion">
      <Row label="Stabilise">
        <span className="checks">
          <select value={smooth} aria-label="Stabilisation strength" onChange={(e) => setSmooth(Number(e.target.value))}>
            <option value={0.4}>Light</option><option value={0.8}>Normal</option><option value={1.6}>Strong</option>
          </select>
          <button disabled={Boolean(busy)} onClick={() => void stabilizeSelection(smooth)}>{clip.stab ? 'Redo' : 'Stabilise'}</button>
          {clip.stab && <button onClick={removeStabilization}>Remove</button>}
        </span>
      </Row>
      <Row label="Track a point">
        <span className="checks">
          <button className={picking ? 'primary' : ''} onClick={() => usePreviewTool.setState({ pickingTrack: !picking, drawingMask: false })} title="Then click the part of the picture to follow">{picking ? 'Click the picture…' : mine ? 'Pick again' : 'Pick point'}</button>
          <button disabled={Boolean(busy) || !mine} onClick={() => void trackFromPick()}>Track from here</button>
        </span>
      </Row>
      {track?.clipId === clip.id && (
        <Row label="Attach clip">
          <span className="checks">
            <select value={target} aria-label="Clip to attach" onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a clip…</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button disabled={!target} onClick={() => attachToTrack(target)}>Attach</button>
          </span>
        </Row>
      )}
      <Row label="Auto reframe">
        <button disabled={Boolean(busy)} onClick={() => void reframeSelection()} title={wrongShape < 1 ? 'Crops this footage to fill the tall frame and follows the action' : 'Fills the frame and follows the action'}>Fill frame and follow action</button>
      </Row>
      {busy && <p className="hint">{busy}… this can take a few seconds.</p>}
      {note && !busy && <p className="hint">{note}</p>}
      <p className="hint">These work on the footage itself, with no cloud and no AI model: shake and tracking are measured by matching blocks of picture from frame to frame. Results become normal keyframes you can edit.</p>
    </Section>
  )
}

function ClipPanel({ clip }: { clip: Clip }) {
  const drawingMask = usePreviewTool((s) => s.drawingMask)
  const editingMask = usePreviewTool((s) => s.editingMask)
  const customFonts = useCustomFonts((s) => s.names)
  const fontOptions = (
    <>
      {customFonts.length > 0 && <optgroup label="Your fonts">{customFonts.map((f) => <option key={f}>{f}</option>)}</optgroup>}
      {FONT_CATEGORIES.map((c) => <optgroup key={c.name} label={c.name}>{c.fonts.map((f) => <option key={f}>{f}</option>)}</optgroup>)}
    </>
  )
  const time = usePlayback((s) => s.time)
  const media = useEditor((s) => s.project!.media)
  const project = useEditor((s) => s.project!)
  const [lutNote, setLutNote] = useState('')
  /** Shrinks the clip into a corner and gives it rounded corners and a shadow. */
  const makePip = (corner: number): void =>
    updateSelected('Picture in picture', (c) => {
      const [sx, sy] = [corner % 2 === 0 ? -1 : 1, corner < 2 ? -1 : 1]
      const effects = [...c.effects.filter((e) => e.type !== 'roundedCorners' && e.type !== 'dropShadow')]
      for (const type of ['roundedCorners', 'dropShadow']) effects.push(makeEffect(type))
      return { transform: { ...c.transform, scale: 0.34, x: sx * 0.31, y: sy * 0.3 }, effects }
    })
  const importLut = async (): Promise<void> => {
    try {
      const text = await window.api.files.openText(['cube'])
      if (text === null) return
      const { name, table } = parseCube(text)
      const lut = { id: newId(), name, size: table.size, data: encodeLut(table) }
      apply('Import LUT', (p) => ({ ...p, luts: [...(p.luts ?? []), lut] }))
      useEditor.getState().addEffect('lut')
      updateSelected('Use LUT', (c) => ({ effects: c.effects.map((e, i) => (i === c.effects.length - 1 && e.type === 'lut' ? { ...e, ref: lut.id } : e)) }))
      setLutNote(`Loaded “${name}” (${table.size}³ table).`)
    } catch (err) {
      setLutNote(`Could not load that LUT: ${(err as Error).message}`)
    }
  }
  const saveLook = async (): Promise<void> => {
    const name = prompt('Name for this look')?.trim()
    if (!name) return
    const saved = await window.api.files.saveText(`${name.replace(/[^\w -]+/g, '').trim() || 'look'}.vlcut-look.json`, JSON.stringify(captureLook(clip, name), null, 2))
    setLutNote(saved ? 'Look saved. Anyone can load it with “Apply a look file”. (LUT effects are not included: they live inside your project.)' : '')
  }
  const loadLook = async (): Promise<void> => {
    const text = await window.api.files.openText(['json'])
    if (text === null) return
    try {
      const parsed = sanitizeLook(JSON.parse(text))
      if (!parsed) return setLutNote('That file is not a VLcut look.')
      const ids = useEditor.getState().selection
      apply(`Apply look “${parsed.look.name}”`, (p) => applyLook(p, ids, parsed.look).project)
      setLutNote(`Applied “${parsed.look.name}” (${parsed.look.effects.length} effects${parsed.look.audioFx.length ? `, ${parsed.look.audioFx.length} sound effects` : ''})${parsed.dropped ? `; ${parsed.dropped} unknown items were skipped` : ''}.`)
    } catch {
      setLutNote('That file could not be read.')
    }
  }
  const exportGrade = async (): Promise<void> => {
    const luts = new Map((project.luts ?? []).map((l) => [l.id, decodeLut(l)]))
    const table = bakeLut(clip.effects, luts)
    const saved = await window.api.files.saveText('vlcut-grade.cube', serializeCube('VLcut grade', table))
    setLutNote(saved ? 'Saved. Only colour effects are included (not blur, grain or other effects that depend on position).' : '')
  }
  const imageNames = media.filter((m) => m.kind === 'image').map((m) => m.name)
  const asset = useEditor((s) => s.project!.media.find((m) => m.id === clip.assetId))
  const { apply, updateSelected } = useEditor.getState()
  const local = Math.max(0, Math.min(clip.duration, time - clip.start))
  const isText = Boolean(clip.text)
  const isAdjustment = !clip.text && !clip.shape && !clip.viz && !clip.assetId
  const viz = clip.viz
  const setViz = (patch: Partial<VizProps>, key?: string) => updateSelected('Edit visualizer', (c) => (c.viz ? { viz: { ...c.viz, ...patch } } : {}), key)
  const shape = clip.shape
  const setShape = (patch: Partial<ShapeProps>, key?: string) => updateSelected('Edit shape', (c) => (c.shape ? { shape: { ...c.shape, ...patch } } : {}), key)
  const setMask = (patch: Partial<Mask>, key?: string) => updateSelected('Edit mask', (c) => (c.mask ? { mask: { ...c.mask, ...patch } } : {}), key)
  const hasPicture = isText || isAdjustment || Boolean(shape) || Boolean(viz) || asset?.kind !== 'audio'
  const hasSound = Boolean(asset && (asset.hasAudio || asset.kind === 'audio'))

  /** Writes an animatable value: to the keyframe at the playhead if the property is animated, else to the base value. */
  const setProp = (prop: AnimProp, value: number) =>
    updateSelected(`Change ${prop}`, (c) => {
      if (c.keyframes[prop]?.length) {
        const t = Math.max(0, Math.min(c.duration, player.time - c.start))
        const easing = c.keyframes[prop]!.find((k) => Math.abs(k.t - t) < KEY_TOLERANCE)?.easing ?? 'easeInOut'
        return { keyframes: { ...c.keyframes, [prop]: upsertKeyframe(c.keyframes[prop], { t, value, easing }) } }
      }
      if (prop === 'opacity' || prop === 'volume') return { [prop]: value }
      return { transform: { ...c.transform, [prop]: value } }
    }, `prop-${prop}`)

  const keyButton = (prop: AnimProp) => {
    const list = clip.keyframes[prop] ?? []
    const here = list.find((k) => Math.abs(k.t - local) < KEY_TOLERANCE)
    const toggle = () =>
      updateSelected(here ? 'Remove keyframe' : 'Add keyframe', (c) => {
        const t = Math.max(0, Math.min(c.duration, player.time - c.start))
        const current = c.keyframes[prop] ?? []
        const next = current.some((k) => Math.abs(k.t - t) < KEY_TOLERANCE) ? current.filter((k) => Math.abs(k.t - t) >= KEY_TOLERANCE) : upsertKeyframe(current, { t, value: propAt(c, prop, t), easing: 'easeInOut' })
        const keyframes = { ...c.keyframes, [prop]: next }
        if (!next.length) delete keyframes[prop]
        return { keyframes }
      })
    return (
      <span className="key-controls">
        <button type="button" className={`key ${here ? 'on' : list.length ? 'some' : ''}`} onClick={toggle} title={here ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'} aria-label={`Keyframe ${prop}`} aria-pressed={Boolean(here)}>◆</button>
        {here && (
          <select
            className="easing"
            value={here.easing}
            aria-label="Easing to next keyframe"
            onChange={(e) => updateSelected('Change easing', (c) => ({ keyframes: { ...c.keyframes, [prop]: (c.keyframes[prop] ?? []).map((k) => (Math.abs(k.t - local) < KEY_TOLERANCE ? { ...k, easing: e.target.value as Easing, bezier: e.target.value === 'bezier' ? k.bezier ?? [0.42, 0, 0.58, 1] : k.bezier } : k)) } }))}
          >
            <option value="linear">Linear</option>
            <option value="easeIn">Ease in</option>
            <option value="easeOut">Ease out</option>
            <option value="easeInOut">Ease in-out</option>
            <option value="hold">Hold</option>
            <option value="bezier">Custom curve…</option>
          </select>
        )}
        {here?.easing === 'bezier' && (
          <CurveEditor
            value={here.bezier ?? [0.42, 0, 0.58, 1]}
            onChange={(bezier) => updateSelected('Edit curve', (c) => ({ keyframes: { ...c.keyframes, [prop]: (c.keyframes[prop] ?? []).map((k) => (Math.abs(k.t - local) < KEY_TOLERANCE ? { ...k, easing: 'bezier' as Easing, bezier } : k)) } }), `curve-${prop}`)}
          />
        )}
      </span>
    )
  }

  const anim = (prop: AnimProp, label: string, min: number, max: number, step = 0.01) => (
    <Num label={label} value={propAt(clip, prop, local)} min={min} max={max} step={step} onChange={(v) => setProp(prop, v)} after={keyButton(prop)} />
  )

  const setText = (patch: Partial<TextProps>, coalesce?: string) => updateSelected('Edit text', (c) => (c.text ? { text: { ...c.text, ...patch } } : {}), coalesce)
  const text = clip.text

  return (
    <>
      {text && (
        <Section title={text.words?.length ? 'Caption' : 'Text'}>
          {text.words?.length ? (
            <div className="words">
              {text.words.map((w, i) => (
                <input
                  key={i}
                  value={w.text}
                  size={Math.max(2, w.text.length)}
                  aria-label={`Word ${i + 1}`}
                  onChange={(e) => setText({ words: text.words!.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }, 'word')}
                />
              ))}
            </div>
          ) : (
            <>
              <textarea value={text.content} rows={3} onChange={(e) => setText({ content: e.target.value }, 'content')} aria-label="Text content" />
              <p className="hint">Wrap words in *asterisks* to set them in the accent font. Write {'{logo.png}'} (the name of an imported image) to place it inline as an icon.</p>
            </>
          )}
          <Row label="Font">
            <select value={text.fontFamily} onChange={(e) => setText({ fontFamily: e.target.value })}>
              {fontOptions}
            </select>
          </Row>
          <Row label="Your fonts"><button onClick={() => void window.api.fonts.import().then((list) => loadCustomFonts(list)).then(() => player.invalidate())}>Add font files…</button></Row>
          <Num label="Size" value={text.fontSize} min={0.01} max={0.5} step={0.002} onChange={(v) => setText({ fontSize: v }, 'fontSize')} />
          <Row label="Weight">
            <select value={text.weight} onChange={(e) => setText({ weight: Number(e.target.value) })}>
              {[400, 500, 600, 700, 900].map((w) => <option key={w}>{w}</option>)}
            </select>
          </Row>
          <Row label="Style">
            <span className="checks">
              <label><input type="checkbox" checked={text.italic} onChange={(e) => setText({ italic: e.target.checked })} /> Italic</label>
              <label><input type="checkbox" checked={text.uppercase} onChange={(e) => setText({ uppercase: e.target.checked })} /> Caps</label>
            </span>
          </Row>
          <Row label="Align">
            <select value={text.align} onChange={(e) => setText({ align: e.target.value as TextProps['align'] })}>
              <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
            </select>
          </Row>
          <Row label="Colour"><input type="color" value={text.color} onChange={(e) => setText({ color: e.target.value }, 'color')} /></Row>
          <Num label="Spacing" value={text.letterSpacing} min={-0.1} max={0.6} step={0.005} onChange={(v) => setText({ letterSpacing: v }, 'ls')} />
          <Num label="Line height" value={text.lineHeight} min={0.7} max={2.5} onChange={(v) => setText({ lineHeight: v }, 'lh')} />
          <Row label="Layout">
            <select value={text.layout} onChange={(e) => setText({ layout: e.target.value as TextProps['layout'] })}>
              <option value="flat">Straight</option><option value="arc">Curved</option><option value="scatter">Scattered</option>
            </select>
          </Row>
          {text.layout === 'arc' && <Num label="Curve" value={text.curve} min={-1} max={1} onChange={(v) => setText({ curve: v }, 'curve')} />}
          <Num label="3D tilt" value={text.tilt} min={-1} max={1} onChange={(v) => setText({ tilt: v }, 'tilt')} />
          <Row label="Animation">
            <select value={text.animation} onChange={(e) => setText({ animation: e.target.value })}>
              {TEXT_ANIMATIONS.map((a) => <option key={a.type} value={a.type}>{a.name}</option>)}
            </select>
          </Row>
          <Row label="Leave">
            <select value={text.animationOut ?? (text.animation === 'none' ? 'none' : 'fade')} onChange={(e) => setText({ animationOut: e.target.value })} aria-label="Text exit animation">
              {TEXT_OUT_ANIMATIONS.map((a) => <option key={a.type} value={a.type}>{a.name}</option>)}
            </select>
          </Row>
          <Row label="Fill">
            <select value={text.fillKind ?? 'solid'} onChange={(e) => setText({ fillKind: e.target.value as TextProps['fillKind'] })} aria-label="Text fill">
              <option value="solid">Solid colour</option><option value="gradient">Gradient</option><option value="metal">Metal</option><option value="chrome">Chrome</option><option value="gold">Gold</option><option value="image">Picture</option>
            </select>
          </Row>
          {text.fillKind === 'gradient' && (
            <>
              <Row label="Gradient to"><input type="color" value={text.fillColor2 ?? '#ffffff'} onChange={(e) => setText({ fillColor2: e.target.value }, 'fc2')} /></Row>
              <Num label="Gradient angle" value={text.fillAngle ?? 0} min={0} max={360} step={1} onChange={(v) => setText({ fillAngle: v }, 'fa')} />
            </>
          )}
          {text.fillKind === 'image' && (
            <Row label="Picture">
              <select value={text.fillImage ?? ''} onChange={(e) => setText({ fillImage: e.target.value })} aria-label="Fill picture">
                <option value="">Choose an imported image…</option>
                {imageNames.map((n) => <option key={n}>{n}</option>)}
              </select>
            </Row>
          )}
          <Row label="Letters">
            <span className="checks">
              <label><input type="checkbox" checked={Boolean(text.hollow)} onChange={(e) => setText({ hollow: e.target.checked })} /> Hollow</label>
              <label><input type="checkbox" checked={Boolean(text.vertical)} onChange={(e) => setText({ vertical: e.target.checked })} /> Vertical</label>
            </span>
          </Row>
          <Num label="Stretch" value={text.stretchX ?? 1} min={0.4} max={3} onChange={(v) => setText({ stretchX: v }, 'sx')} />
          <Row label="Distort">
            <select value={text.distort ?? 'none'} onChange={(e) => setText({ distort: e.target.value as TextProps['distort'], distortAmount: text.distortAmount || 0.5 })} aria-label="Text distortion">
              <option value="none">None</option><option value="wave">Wave</option><option value="bulge">Bulge</option><option value="skew">Slant</option>
            </select>
          </Row>
          {text.distort && text.distort !== 'none' && <Num label="Distort amount" value={text.distortAmount ?? 0.5} min={0} max={1} onChange={(v) => setText({ distortAmount: v }, 'da')} />}
          <Num label="Neon glow" value={text.glowAmount ?? 0} min={0} max={1} onChange={(v) => setText({ glowAmount: v }, 'ga')} />
          {(text.glowAmount ?? 0) > 0 && <Row label="Glow colour"><input type="color" value={text.glowColor || text.color} onChange={(e) => setText({ glowColor: e.target.value }, 'gc')} /></Row>}
          <Num label="3D depth" value={text.extrudeDepth ?? 0} min={0} max={0.4} step={0.005} onChange={(v) => setText({ extrudeDepth: v }, 'ed')} />
          {(text.extrudeDepth ?? 0) > 0 && (
            <>
              <Num label="3D angle" value={text.extrudeAngle ?? 45} min={0} max={360} step={1} onChange={(v) => setText({ extrudeAngle: v }, 'ea')} />
              <Row label="3D colour"><input type="color" value={text.extrudeColor || '#222222'} onChange={(e) => setText({ extrudeColor: e.target.value }, 'ec')} /></Row>
            </>
          )}
          <Num label="Outline" value={text.outlineWidth} min={0} max={0.3} step={0.005} onChange={(v) => setText({ outlineWidth: v }, 'ow')} />
          <Row label="Outline colour"><input type="color" value={text.outlineColor} onChange={(e) => setText({ outlineColor: e.target.value }, 'oc')} /></Row>
          <Num label="Shadow" value={text.shadow} min={0} max={1} onChange={(v) => setText({ shadow: v }, 'sh')} />
          <Row label="Box">
            <span className="checks">
              <label><input type="checkbox" checked={Boolean(text.boxColor)} onChange={(e) => setText({ boxColor: e.target.checked ? '#000000' : '' })} /> Background</label>
              {text.boxColor && <input type="color" value={text.boxColor.slice(0, 7)} onChange={(e) => setText({ boxColor: e.target.value }, 'bc')} />}
            </span>
          </Row>
          <Row label="Accent font">
            <select value={text.accentFontFamily} onChange={(e) => setText({ accentFontFamily: e.target.value })}>
              {fontOptions}
            </select>
          </Row>
          <Row label="Accent">
            <span className="checks">
              <label><input type="checkbox" checked={text.accentItalic} onChange={(e) => setText({ accentItalic: e.target.checked })} /> Italic</label>
              <label><input type="checkbox" checked={Boolean(text.accentColor)} onChange={(e) => setText({ accentColor: e.target.checked ? text.highlightColor : '' })} /> Colour</label>
              {text.accentColor && <input type="color" value={text.accentColor} onChange={(e) => setText({ accentColor: e.target.value }, 'ac')} />}
            </span>
          </Row>
          {text.words?.length ? (
            <>
              <Row label="Spoken word"><input type="color" value={text.highlightColor} onChange={(e) => setText({ highlightColor: e.target.value }, 'hc')} /></Row>
              <Row label="Word box">
                <span className="checks">
                  <label><input type="checkbox" checked={Boolean(text.activeWordBox)} onChange={(e) => setText({ activeWordBox: e.target.checked ? '#e23d5b' : '' })} /> On</label>
                  {text.activeWordBox && <input type="color" value={text.activeWordBox} onChange={(e) => setText({ activeWordBox: e.target.value }, 'awb')} />}
                </span>
              </Row>
              <Num label="Words shown" value={text.wordsPerPage} min={0} max={12} step={1} onChange={(v) => setText({ wordsPerPage: v }, 'wpp')} />
            </>
          ) : null}
        </Section>
      )}

      {shape && (
        <Section title="Shape">
          <Row label="Kind">
            <select value={shape.kind} onChange={(e) => setShape({ kind: e.target.value as ShapeProps['kind'] })}>
              <option value="rect">Box</option><option value="ellipse">Circle</option><option value="line">Line</option><option value="curve">Connector curve</option><option value="tiles">Tile row</option>
            </select>
          </Row>
          <Num label="Width" value={shape.width} min={0.01} max={1.5} onChange={(v) => setShape({ width: v }, 'sw')} />
          {shape.kind === 'tiles' && <Num label="Tiles" value={shape.count} min={1} max={8} step={1} onChange={(v) => setShape({ count: v }, 'sc')} />}
          {shape.kind !== 'line' && <Num label={shape.kind === 'curve' ? 'Bend' : 'Height'} value={shape.height} min={shape.kind === 'curve' ? -1 : 0.01} max={1.5} onChange={(v) => setShape({ height: v }, 'sh')} />}
          {shape.kind === 'rect' && <Num label="Rounding" value={shape.radius} min={0} max={1} onChange={(v) => setShape({ radius: v }, 'sr')} />}
          {shape.kind !== 'line' && (
            <Row label="Fill">
              <span className="checks">
                <label><input type="checkbox" checked={Boolean(shape.fill)} onChange={(e) => setShape({ fill: e.target.checked ? '#e8a33d' : '' })} /> On</label>
                {shape.fill && <input type="color" value={shape.fill} onChange={(e) => setShape({ fill: e.target.value }, 'sf')} />}
              </span>
            </Row>
          )}
          <Row label="Outline">
            <span className="checks">
              <label><input type="checkbox" checked={Boolean(shape.stroke)} onChange={(e) => setShape({ stroke: e.target.checked ? '#ffffff' : '' })} /> On</label>
              {shape.stroke && <input type="color" value={shape.stroke} onChange={(e) => setShape({ stroke: e.target.value }, 'ss')} />}
            </span>
          </Row>
          <Num label="Line width" value={shape.strokeWidth} min={0.001} max={0.1} step={0.001} onChange={(v) => setShape({ strokeWidth: v }, 'slw')} />
          <Row label="Animation">
            <select value={shape.animation} onChange={(e) => setShape({ animation: e.target.value as ShapeProps['animation'] })}>
              <option value="none">None</option><option value="fade">Fade</option><option value="grow">Grow</option><option value="draw">Draw on</option>
            </select>
          </Row>
        </Section>
      )}

      {hasPicture && (
        <Section title="Transform" actions={<button onClick={() => updateSelected('Reset transform', () => ({ transform: { x: 0, y: 0, scale: 1, rotation: 0 }, keyframes: {} }))}>Reset</button>}>
          {anim('x', 'Position X', -1.5, 1.5, 0.005)}
          {anim('y', 'Position Y', -1.5, 1.5, 0.005)}
          {anim('scale', 'Scale', 0.05, 6)}
          {anim('rotation', 'Rotation', -360, 360, 0.5)}
          {anim('opacity', 'Opacity', 0, 1)}
        </Section>
      )}

      {asset && asset.kind !== 'audio' && (
        <Section title="Crop">
          {(['left', 'right', 'top', 'bottom'] as const).map((edge) => (
            <Num key={edge} label={edge[0].toUpperCase() + edge.slice(1)} value={clip.crop[edge]} min={0} max={0.9} onChange={(v) => updateSelected('Crop', (c) => ({ crop: { ...c.crop, [edge]: v } }), `crop-${edge}`)} />
          ))}
        </Section>
      )}

      {hasPicture && !isAdjustment && (
        <Section title="Mask" actions={<label><input type="checkbox" aria-label="Enable mask" checked={Boolean(clip.mask)} onChange={(e) => updateSelected(e.target.checked ? 'Add mask' : 'Remove mask', () => ({ mask: e.target.checked ? { ...DEFAULT_MASK } : undefined }))} /> On</label>}>
          {clip.mask ? (
            <>
              <Row label="Shape">
                <select value={clip.mask.shape} onChange={(e) => setMask({ shape: e.target.value as Mask['shape'] })}>
                  <option value="ellipse">Ellipse</option><option value="rect">Rectangle</option><option value="polygon">Hand-drawn</option>
                </select>
              </Row>
              {clip.mask.shape === 'polygon' && (
                <>
                  <div className="field">
                    <button className={drawingMask ? 'on' : ''} aria-pressed={drawingMask} onClick={() => usePreviewTool.setState({ drawingMask: !drawingMask })}>{drawingMask ? 'Done drawing' : 'Draw on preview'}</button>
                    <button disabled={!clip.mask.points?.length} onClick={() => updateSelected('Edit mask', (c) => (c.mask ? { mask: withoutKeys({ ...c.mask, points: c.mask.points!.slice(0, -1) }) } : {}))}>Undo point</button>
                    <button disabled={!clip.mask.points?.length} onClick={() => updateSelected('Edit mask', (c) => (c.mask ? { mask: withoutKeys({ ...c.mask, points: [] }) } : {}))}>Clear</button>
                  </div>
                  <p className="hint">{clip.mask.points?.length ?? 0} corners. Click the picture to add corners; three or more make the mask.</p>
                  {(clip.mask.points?.length ?? 0) >= 3 && (
                    <>
                      <div className="field">
                        <button className={editingMask ? 'on' : ''} aria-pressed={editingMask} onClick={() => usePreviewTool.setState({ editingMask: !editingMask, drawingMask: false })} title="Shows a handle on every corner; drag them on the preview">{editingMask ? 'Done editing' : 'Edit corners'}</button>
                        <button title="Remembers the shape as it is at the playhead. Move to another moment and drag the corners again to animate the mask (rotoscoping)." onClick={() => updateSelected('Key mask shape', (c) => (c.mask ? { mask: withMaskKey(c.mask, Math.max(0, Math.min(c.duration, player.time - c.start))) } : {}))}>Key shape here</button>
                        <button disabled={!clip.mask.keys?.length} onClick={() => updateSelected('Clear mask keys', (c) => (c.mask ? { mask: withoutKeys(c.mask) } : {}))}>Clear keys</button>
                      </div>
                      <p className="hint">{clip.mask.keys?.length ? `${clip.mask.keys.length} shape key${clip.mask.keys.length === 1 ? '' : 's'}: the corners glide between them. Move the playhead and drag corners to add more.` : 'Rotoscoping: press “Key shape here”, move the playhead, and drag the corners to follow the subject. The mask changes shape between keys.'}</p>
                    </>
                  )}
                </>
              )}
              <Num label="Centre X" value={clip.mask.x} min={-0.5} max={0.5} onChange={(v) => setMask({ x: v }, 'mx')} />
              <Num label="Centre Y" value={clip.mask.y} min={-0.5} max={0.5} onChange={(v) => setMask({ y: v }, 'my')} />
              <Num label="Width" value={clip.mask.width} min={0.02} max={1.5} onChange={(v) => setMask({ width: v }, 'mw')} />
              <Num label="Height" value={clip.mask.height} min={0.02} max={1.5} onChange={(v) => setMask({ height: v }, 'mh')} />
              <Num label="Feather" value={clip.mask.feather} min={0} max={1} onChange={(v) => setMask({ feather: v }, 'mf')} />
              <Row label="Animate">
                <label><input type="checkbox" aria-label="Animate mask" checked={Boolean(clip.mask.moveTo)} onChange={(e) => setMask({ moveTo: e.target.checked ? { x: clip.mask!.x, y: clip.mask!.y, scale: 1 } : undefined })} /> Move across the clip</label>
              </Row>
              {clip.mask.moveTo && (
                <>
                  <Num label="End X" value={clip.mask.moveTo.x} min={-0.6} max={0.6} onChange={(v) => setMask({ moveTo: { ...clip.mask!.moveTo!, x: v } }, 'mtx')} />
                  <Num label="End Y" value={clip.mask.moveTo.y} min={-0.6} max={0.6} onChange={(v) => setMask({ moveTo: { ...clip.mask!.moveTo!, y: v } }, 'mty')} />
                  <Num label="End size" value={clip.mask.moveTo.scale} min={0.1} max={4} onChange={(v) => setMask({ moveTo: { ...clip.mask!.moveTo!, scale: v } }, 'mts')} />
                </>
              )}
              <Row label="Invert"><label><input type="checkbox" checked={clip.mask.invert} onChange={(e) => setMask({ invert: e.target.checked })} /> Hide the inside instead</label></Row>
            </>
          ) : <p className="hint">Show only part of this clip through an ellipse or rectangle.</p>}
        </Section>
      )}

      {asset && asset.kind !== 'image' && (
        <Section title="Speed">
          <Num label="Speed" value={clip.speed} min={0.1} max={16} step={0.05} onChange={(v) => apply('Change speed', (p) => ops.setClipSpeed(p, clip.id, v), { coalesce: 'speed' })} />
          <Row label="Direction">
            <label><input type="checkbox" checked={clip.reversed} onChange={(e) => updateSelected('Reverse clip', () => ({ reversed: e.target.checked }))} /> Reverse</label>
          </Row>
          <Row label="Frame blending">
            <label title="Mixes neighbouring source frames, so slow motion and low frame rates look smooth. Applied in the export; the preview shows single frames."><input type="checkbox" aria-label="Frame blending" checked={Boolean(clip.frameBlend)} onChange={(e) => updateSelected('Frame blending', () => ({ frameBlend: e.target.checked || undefined }))} /> Smooth slow motion (export)</label>
          </Row>
          <SpeedRamp clip={clip} />
          {clip.reversed && <p className="hint">Reversed clips preview without sound and may stutter; the export is smooth.</p>}
        </Section>
      )}

      {hasPicture && !isText && !shape && !isAdjustment && <ClipBlur clip={clip} />}

      {viz && (
        <Section title="Audio visualizer">
          <Row label="Style">
            <select value={viz.style} aria-label="Visualizer style" onChange={(e) => setViz({ style: e.target.value as VizProps['style'] })}>
              <option value="bars">Bars</option><option value="mirror">Mirrored bars</option><option value="wave">Wave</option><option value="circle">Ring</option><option value="dots">Dots</option>
            </select>
          </Row>
          <Row label="Colours"><span className="checks"><input type="color" value={viz.color} onChange={(e) => setViz({ color: e.target.value }, 'vc')} aria-label="Visualizer colour" /><input type="color" value={viz.color2} onChange={(e) => setViz({ color2: e.target.value }, 'vc2')} aria-label="Visualizer second colour" /></span></Row>
          <Num label="Bars" value={viz.bands} min={8} max={96} step={1} onChange={(v) => setViz({ bands: Math.round(v) }, 'vb')} />
          <Num label="Sensitivity" value={viz.gain} min={0.3} max={3} onChange={(v) => setViz({ gain: v }, 'vg')} />
          <Num label="Thickness" value={viz.thickness} min={0.002} max={0.05} step={0.001} onChange={(v) => setViz({ thickness: v }, 'vt')} />
          <Num label="Width" value={viz.width} min={0.1} max={1} onChange={(v) => setViz({ width: v }, 'vw')} />
          <Num label="Height" value={viz.height} min={0.05} max={1} onChange={(v) => setViz({ height: v }, 'vh')} />
          <p className="hint">It listens to whatever music or voice is playing under it. Move and resize it with Position and Scale.</p>
        </Section>
      )}

      {hasSound && (
        <Section title="Audio">
          {asset?.kind === 'video' && <Row label="Sound"><label><input type="checkbox" aria-label="Remove audio from this clip" checked={Boolean(clip.muted)} onChange={(e) => updateSelected(e.target.checked ? 'Remove audio' : 'Restore audio', () => ({ muted: e.target.checked || undefined }))} /> Remove this clip's audio</label></Row>}
          {!clip.muted && anim('volume', 'Volume', 0, 2)}
        </Section>
      )}

      {hasSound && !clip.muted && !clip.freeze && <AudioFxSection clip={clip} />}

      <Section title="Fades">
        <Num label="Fade in" value={clip.fadeIn} min={0} max={Math.min(10, clip.duration)} step={0.05} onChange={(v) => updateSelected('Fade in', () => ({ fadeIn: v }), 'fadeIn')} />
        <Num label="Fade out" value={clip.fadeOut} min={0} max={Math.min(10, clip.duration)} step={0.05} onChange={(v) => updateSelected('Fade out', () => ({ fadeOut: v }), 'fadeOut')} />
      </Section>

      {asset?.kind === 'video' && <MotionSection clip={clip} />}

      {hasPicture && (
        <Section title="Compositing">
          <Row label="Blend mode">
            <select value={clip.blend ?? 'normal'} aria-label="Blend mode" onChange={(e) => updateSelected('Blend mode', () => ({ blend: e.target.value === 'normal' ? undefined : (e.target.value as BlendMode) }))}>
              {BLEND_MODES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
          </Row>
          <Row label="Track matte">
            <select
              value={clip.matte?.clipId ?? ''}
              aria-label="Track matte clip"
              onChange={(e) => updateSelected('Track matte', (c) => ({ matte: e.target.value ? { clipId: e.target.value, mode: c.matte?.mode ?? 'alpha', invert: c.matte?.invert ?? false } : undefined }))}
            >
              <option value="">None</option>
              {project.tracks.filter((t) => t.kind !== 'audio').flatMap((t) => t.clips.filter((c) => c.id !== clip.id).map((c) => (
                <option key={c.id} value={c.id}>{t.name} · {clipLabel(c, project.media)}</option>
              )))}
            </select>
          </Row>
          {clip.matte && (
            <Row label="Matte uses">
              <span className="checks">
                <select value={clip.matte.mode} aria-label="Matte mode" onChange={(e) => updateSelected('Matte mode', (c) => ({ matte: c.matte && { ...c.matte, mode: e.target.value as 'alpha' | 'luma' } }))}>
                  <option value="alpha">Shape (alpha)</option>
                  <option value="luma">Brightness (luma)</option>
                </select>
                <label><input type="checkbox" checked={clip.matte.invert} onChange={(e) => updateSelected('Invert matte', (c) => ({ matte: c.matte && { ...c.matte, invert: e.target.checked } }))} /> Invert</label>
              </span>
            </Row>
          )}
          <Row label="Presets">
            <span className="checks">
              {(['↖', '↗', '↙', '↘'] as const).map((arrow, i) => (
                <button key={arrow} title="Shrink into a corner as a picture-in-picture, with rounded corners and a shadow" onClick={() => makePip(i)}>PiP {arrow}</button>
              ))}
              <button title="Blend this clip over the one beneath it, like a double exposure" onClick={() => updateSelected('Double exposure', (c) => ({ blend: 'screen', opacity: Math.min(c.opacity, 0.7) }))}>Double exposure</button>
            </span>
          </Row>
        </Section>
      )}

      {hasPicture && (
        <Section title="Transition in">
          <Row label="Type">
            <select value={clip.transitionIn?.type ?? ''} onChange={(e) => updateSelected('Set transition', (c) => ({ transitionIn: e.target.value ? { type: e.target.value, duration: c.transitionIn?.duration ?? 0.5 } : undefined }))}>
              <option value="">None</option>
              {TRANSITIONS.map((t) => <option key={t.type} value={t.type}>{t.name}</option>)}
            </select>
          </Row>
          {clip.transitionIn && (() => {
            const tr = clip.transitionIn
            const base = transitionEase(tr.type)
            const a = tr.easeIn ?? base?.[0] ?? 0
            const b = tr.easeOut ?? base?.[1] ?? 0
            const patch = (key: 'easeIn' | 'easeOut' | 'strength', v: number): void => updateSelected('Transition timing', (c) => ({ transitionIn: { ...c.transitionIn!, easeIn: key === 'easeIn' ? v : a, easeOut: key === 'easeOut' ? v : b, ...(key === 'strength' ? { strength: v } : {}) } }), 'trtime')
            const pts = Array.from({ length: 41 }, (_, i) => { const x = i / 40; return `${(x * 100).toFixed(1)},${(100 - shapeTransitionProgress(x, { ...tr, easeIn: a, easeOut: b }) * 100).toFixed(1)}` }).join(' ')
            return (
              <>
                <Num label="Duration" value={tr.duration} min={0.05} max={Math.min(5, clip.duration)} step={0.05} onChange={(v) => updateSelected('Transition duration', (c) => ({ transitionIn: { ...c.transitionIn!, duration: v } }), 'trdur')} />
                <Num label="Start ease" value={a} min={0} max={1} step={0.05} onChange={(v) => patch('easeIn', v)} />
                <Num label="End ease" value={b} min={0} max={1} step={0.05} onChange={(v) => patch('easeOut', v)} />
                <Num label="Strength" value={tr.strength ?? 1} min={0.2} max={2} step={0.1} onChange={(v) => patch('strength', v)} />
                <svg className="ease-curve" viewBox="-4 -4 108 108" role="img" aria-label="Transition timing curve">
                  <rect x="0" y="0" width="100" height="100" fill="none" stroke="currentColor" strokeOpacity="0.25" />
                  <line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="3 3" />
                  <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="3" />
                </svg>
                <p className="hint">Low start ease = hits fast; high end ease = lands softly. Shorten the duration to make it snappier.</p>
              </>
            )
          })()}
        </Section>
      )}

      {hasPicture && (
        <Section
          title="Effects"
          actions={
            <select value="" aria-label="Add effect" onChange={(e) => e.target.value && useEditor.getState().addEffect(e.target.value)}>
              <option value="">+ Add</option>
              {EFFECTS.map((f) => <option key={f.type} value={f.type}>{f.name}</option>)}
            </select>
          }
        >
          <div className="field">
            <button onClick={() => void importLut()}>Import LUT (.cube)…</button>
            <button title="Saves this clip's effects, sound effects, blend mode and transition as a file you can share" onClick={() => void saveLook()}>Save this look…</button>
            <button title="Adds the effects from a look file to the selected clips" onClick={() => void loadLook()}>Apply a look file…</button>
            <button disabled={!clip.effects.some((e) => e.enabled)} title="Saves the colour effects on this clip as a .cube table that other editors can load" onClick={() => void exportGrade()}>Export colour grade as LUT…</button>
          </div>
          {lutNote && <p className="hint">{lutNote}</p>}
          {clip.effects.length === 0 && <p className="hint">No effects on this clip. Effects stack: each one is applied on top of the ones above it.</p>}
          {clip.effects.length > 1 && (
            <div className="field">
              <button onClick={() => {
                const name = prompt('Name for this stack of effects')?.trim()
                if (name) saveCustomStacks([{ name, custom: true, effects: clip.effects.filter((e) => e.enabled).map((e) => ({ type: e.type, params: { ...e.params } })) }, ...loadCustomStacks().filter((s) => s.name !== name)])
              }}>Save as my stack</button>
              <button onClick={() => updateSelected('Clear effects', () => ({ effects: [] }))}>Clear all</button>
            </div>
          )}
          {clip.effects.map((fx, index) => {
            const spec = effectSpec(fx.type)
            if (!spec) return null
            const patch = (change: (e: typeof fx) => typeof fx | null, key?: string) =>
              updateSelected('Edit effect', (c) => ({ effects: c.effects.flatMap((e) => { if (e.id !== fx.id) return [e]; const n = change(e); return n ? [n] : [] }) }), key)
            return (
              <div key={fx.id} className={`effect ${fx.enabled ? '' : 'off'}`}>
                <header>
                  <label><input type="checkbox" checked={fx.enabled} onChange={(e) => patch((x) => ({ ...x, enabled: e.target.checked }))} /> {spec.name}</label>
                  <span>
                    <button disabled={index === 0} aria-label="Move effect up" onClick={() => updateSelected('Reorder effects', (c) => { const list = [...c.effects]; const i = list.findIndex((e) => e.id === fx.id); if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]]; return { effects: list } })}>↑</button>
                    <button aria-label={`Remove ${spec.name}`} onClick={() => patch(() => null)}>×</button>
                  </span>
                </header>
                {fx.type === 'lut' && (
                  <Row label="Table">
                    <select value={fx.ref ?? ''} aria-label="LUT table" onChange={(e) => patch((x) => ({ ...x, ref: e.target.value || undefined }))}>
                      <option value="">Choose a LUT…</option>
                      {(project.luts ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </Row>
                )}
                {spec.params.map((ps) => ps.color ? (
                  <Row key={ps.key} label={ps.label}><input type="color" value={`#${Math.round(fx.params[ps.key] ?? ps.default).toString(16).padStart(6, '0')}`} onChange={(e) => patch((x) => ({ ...x, params: { ...x.params, [ps.key]: parseInt(e.target.value.slice(1), 16) } }), `fx-${fx.id}-${ps.key}`)} /></Row>
                ) : (
                  <Num key={ps.key} label={ps.label} value={fx.params[ps.key] ?? ps.default} min={ps.min} max={ps.max} step={ps.step} onChange={(v) => patch((x) => ({ ...x, params: { ...x.params, [ps.key]: v } }), `fx-${fx.id}-${ps.key}`)} />
                ))}
              </div>
            )
          })}
        </Section>
      )}
      <Scopes />
    </>
  )
}

/** The context-sensitive properties panel. */
export function Inspector() {
  const clip = useEditor((s) => (s.selection.length ? ops.findClip(s.project!, s.selection[0])?.clip : undefined))
  const count = useEditor((s) => s.selection.length)
  const assetId = useEditor((s) => s.selectedAssetId)
  return (
    <div className="inspector">
      {clip ? (
        <>
          {count > 1 && <p className="hint">{count} clips selected. Changes apply to all of them.</p>}
          <ClipPanel clip={clip} />
        </>
      ) : assetId ? (
        <AssetPanel assetId={assetId} />
      ) : (
        <ProjectPanel />
      )}
    </div>
  )
}
