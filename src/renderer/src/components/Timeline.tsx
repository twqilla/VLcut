import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, Sr } from './Icon'
import { clearRange, markIn, markOut, setFitRows, setShowTags, setTextEditor, useUi } from '../ui'
import { ThumbStrip } from './ThumbStrip'
import { musicMarks } from '@shared/timeline/marks'
import type { Clip, Track } from '@shared/types'
import * as ops from '@shared/timeline/ops'
import { textClip, makeClip, shapeClip } from '@shared/timeline/model'
import { useEditor } from '../store'
import { player, usePlayback } from '../engine/player'
import { Waveform } from './Waveform'
import { withKey } from '@shared/shortcuts'
import { useKeys } from '../keys'
import { canUnnest, nestSelection, unnestSelection, useNest } from '../nest'
import { type SplitLayout, splitScreen } from '@shared/timeline/layout'
import { clipTags, type ClipTag } from '@shared/timeline/tags'
import { openMenu } from '../contextMenu'
import { TEXT_MIME, clearGhost, dragPayload, useGhost } from '../dragGhost'
import { TEXT_PRESETS } from '../textPresets'
import type { Project } from '@shared/types'

/** Height of one tag bar under a clip, and the most rows shown before a "+N" takes over. */
const TAG_H = 17
const MAX_TAG_ROWS = 5
const HEADER_WIDTH = 150
const SNAP_PIXELS = 8
export const ASSET_MIME = 'application/x-vlcut-asset'

/** The track and time under a point of this window's page, for clips dropped from the other split-view window. */
export function dropTargetAt(at: { x: number; y: number }): { trackId: string; time: number } | null {
  const lane = document.elementsFromPoint(at.x, at.y).find((el) => el instanceof HTMLElement && el.dataset.trackId) as HTMLElement | undefined
  if (!lane) return null
  return { trackId: lane.dataset.trackId!, time: Math.max(0, (at.x - lane.getBoundingClientRect().left) / useEditor.getState().zoom) }
}

function Playhead({ zoom }: { zoom: number }) {
  const time = usePlayback((s) => s.time)
  // The grip at the top can be dragged: it follows the pointer along the timeline.
  const drag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId)
    else if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const content = e.currentTarget.closest('.track-content') as HTMLElement
    const x = e.clientX - content.getBoundingClientRect().left
    const fps = useEditor.getState().project!.settings.fps
    useEditor.getState().selectAsset(null)
    player.pause()
    player.seek(ops.snapToFrame(Math.max(0, x / zoom), fps))
  }
  return (
    <div className="playhead" style={{ transform: `translateX(${time * zoom}px)` }}>
      <div className="playhead-grip" role="slider" aria-label="Playhead" aria-valuenow={Math.round(time * 100) / 100} onPointerDown={drag} onPointerMove={drag} title="Drag to move the playhead" />
    </div>
  )
}

function Ruler({ zoom, duration, marks }: { zoom: number; duration: number; marks: { beats: number[]; snares: number[] } }) {
  const rangeIn = useUi((u) => u.rangeIn)
  const rangeOut = useUi((u) => u.rangeOut)
  // Pick a tick spacing that keeps labels roughly 80 px apart.
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const step = steps.find((s) => s * zoom >= 80) ?? 600
  const ticks = []
  for (let t = 0; t <= duration + step; t += step) {
    const m = Math.floor(t / 60)
    const s = t % 60
    ticks.push(
      <span key={t} className="tick" style={{ left: t * zoom }}>
        {m}:{s < 10 ? '0' : ''}{Number.isInteger(s) ? s : s.toFixed(2)}
      </span>
    )
  }
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId)
    else if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    useEditor.getState().selectAsset(null)
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    const fps = useEditor.getState().project!.settings.fps
    player.pause()
    player.seek(ops.snapToFrame(x / zoom, fps))
  }
  return (
    <div className="ruler" onPointerDown={scrub} onPointerMove={scrub}>
      {ticks}
      {rangeIn !== null && rangeOut !== null && <span className="range-region" style={{ left: rangeIn * zoom, width: Math.max(1, (rangeOut - rangeIn) * zoom) }} title={`Selected region: ${rangeIn.toFixed(2)} s to ${rangeOut.toFixed(2)} s`} />}
      {rangeIn !== null && <span className="range-flag in" style={{ left: rangeIn * zoom }} title="In mark (I)">I</span>}
      {rangeOut !== null && <span className="range-flag out" style={{ left: rangeOut * zoom }} title="Out mark (O)">O</span>}
      {marks.beats.map((t) => <span key={`b${t}`} className="mark beat" style={{ left: t * zoom }} />)}
      {marks.snares.map((t) => <span key={`s${t}`} className="mark snare" style={{ left: t * zoom }} title="Snare" />)}
    </div>
  )
}

/** The right-click menu of a clip: the things done most often, in plain words. */
function clipMenu(x: number, y: number, clip: Clip, track: Track): void {
  const ed = useEditor.getState()
  if (!ed.selection.includes(clip.id)) ed.select([clip.id])
  const asset = ed.project!.media.find((m) => m.id === clip.assetId)
  const inside = player.time > clip.start + 0.05 && player.time < ops.clipEnd(clip) - 0.05
  const tags = clipTags(ed.project!, clip)
  openMenu(x, y, [
    ...(clip.text ? [{ label: 'Edit text…', run: () => setTextEditor(true) }, { label: '', separator: true }] : []),
    { label: 'Split at the playhead', run: ed.splitAtPlayhead, disabled: !inside || track.locked, hint: 'S' },
    { label: 'Duplicate', run: ed.duplicateSelection, disabled: track.locked, hint: 'Ctrl+D' },
    { label: 'Copy', run: ed.copySelection, hint: 'Ctrl+C' },
    { label: 'Paste at the playhead', run: ed.paste, hint: 'Ctrl+V' },
    { label: '', separator: true },
    ...(asset && (asset.hasAudio || asset.kind === 'audio') && asset.kind !== 'audio' ? [clip.muted ? { label: 'Bring the sound back', run: ed.restoreAudio } : { label: 'Remove the sound', run: ed.removeAudio }] : []),
    { label: tags.some((t) => t.kind === 'effect' || t.kind === 'look') ? 'Remove all effects' : 'No effects to remove', run: () => ed.updateSelected('Clear effects', () => ({ effects: [] })), disabled: !tags.some((t) => t.kind === 'effect' || t.kind === 'look') },
    { label: 'Nest selected clips into one', run: () => void nestSelection(), disabled: track.locked },
    ...(asset?.nested ? [{ label: 'Unnest (put the original clips back)', run: unnestSelection }] : []),
    { label: '', separator: true },
    { label: 'Delete', run: ed.deleteSelection, danger: true, disabled: track.locked, hint: 'Del' }
  ])
}

type DragMode = 'move' | 'trim-start' | 'trim-end'

function ClipView({ clip, track, zoom }: { clip: Clip; track: Track; zoom: number }) {
  const selected = useEditor((s) => s.selection.includes(clip.id))
  const asset = useEditor((s) => s.project!.media.find((m) => m.id === clip.assetId))
  const drag = useRef<{ mode: DragMode; startX: number; startY: number; origStart: number; origEnd: number; moved: boolean; key: string; outside: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, mode: DragMode) => {
    if (e.button !== 0 || track.locked) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const { select, selection } = useEditor.getState()
    if (e.shiftKey || e.ctrlKey || e.metaKey) select([clip.id], true)
    else if (!selection.includes(clip.id)) select([clip.id])
    drag.current = { mode, startX: e.clientX, startY: e.clientY, origStart: clip.start, origEnd: ops.clipEnd(clip), moved: false, key: `drag-${clip.id}-${Date.now()}`, outside: false }
    // Follow the pointer at window level: the clip's element can be redrawn (or move to another track) mid-drag.
    const move = (ev: PointerEvent): void => onPointerMove(ev)
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onPointerUp(ev)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    // Any direction starts a drag: straight up or down moves a clip to another track.
    if (!d.moved && Math.hypot(dx, e.clientY - d.startY) < 3) return
    d.moved = true
    // Dragged out of the window: the clip goes back to where it was, and the other split-view window shows where it would land.
    const outside = e.clientX < 0 || e.clientY < 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight
    if (d.mode === 'move' && outside) {
      if (!d.outside) {
        d.outside = true
        const { past, undo } = useEditor.getState()
        if (past[past.length - 1]?.coalesce === d.key) undo()
      }
      window.api.split.hover(e.clientX, e.clientY)
      return
    }
    if (d.outside) {
      d.outside = false
      window.api.split.hover(null)
    }
    const { apply, snapping, project } = useEditor.getState()
    const delta = dx / zoom
    const fps = project!.settings.fps
    const points = snapping ? [...ops.snapPoints(project!, new Set([clip.id]), useEditor.getState().snapMarks), player.time] : []
    const snap = (t: number) => ops.snapToFrame(ops.snapTime(t, points, SNAP_PIXELS / zoom), fps)

    if (d.mode === 'trim-start') return apply('Trim clip', (p) => ops.trimClipStart(p, clip.id, snap(d.origStart + delta)), { coalesce: d.key })
    if (d.mode === 'trim-end') return apply('Trim clip', (p) => ops.trimClipEnd(p, clip.id, snap(d.origEnd + delta)), { coalesce: d.key })

    // Move: snap either edge, and follow the pointer onto another track of the same kind.
    const length = d.origEnd - d.origStart
    let start = d.origStart + delta
    const snappedStart = snap(start)
    const snappedEnd = snap(start + length)
    start = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - (start + length)) ? snappedStart : snappedEnd - length
    const lane = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof HTMLElement && el.dataset.trackId) as HTMLElement | undefined
    const targetId = lane?.dataset.trackId ?? track.id
    apply('Move clip', (p) => {
      const moved = ops.moveClip(p, clip.id, targetId, Math.max(0, start))
      return moved === p ? ops.moveClip(p, clip.id, ops.findClip(p, clip.id)!.track.id, Math.max(0, start)) : moved
    }, { coalesce: d.key })
  }

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d?.outside) {
      window.api.split.hover(null)
      // Released over the other split-view window: the selected clips are copied there.
      void useEditor.getState().sendSelection({ x: e.clientX, y: e.clientY })
    }
  }

  const width = Math.max(2, clip.duration * zoom)
  const label = clip.text ? clip.text.words?.map((w) => w.text).join(' ') || clip.text.content.replace(/\*/g, '') : asset?.name ?? (clip.assetId ? 'Missing media' : clip.shape ? `Shape · ${clip.shape.kind}` : clip.viz ? `Visualizer · ${clip.viz.style}` : 'Effects layer')
  const kind = clip.text ? 'text' : clip.shape || clip.viz ? 'shape' : !clip.assetId ? 'adjust' : asset?.kind ?? 'video'
  const keyframeTimes = [...new Set(Object.values(clip.keyframes).flatMap((list) => (list ?? []).map((k) => k.t)))]

  return (
    <div
      className={`clip clip-${kind} ${selected ? 'selected' : ''} ${asset?.missing ? 'missing' : ''}`}
      style={{ left: clip.start * zoom, width }}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); clipMenu(e.clientX, e.clientY, clip, track) }}
      onDoubleClick={() => { if (clip.text) { useEditor.getState().select([clip.id]); setTextEditor(true) } }}
      title={clip.text ? `${label} (double-click to edit the text)` : label}
    >
      {asset && !asset.missing && asset.kind !== 'audio' && width > 30 && <ThumbStrip clip={clip} asset={asset} width={width} height={track.height - 4} />}
      {asset && !clip.muted && (asset.hasAudio || asset.kind === 'audio') && width > 12 && <Waveform clip={clip} asset={asset} width={width} height={track.height - 6} />}
      {clip.transitionIn && <span className="transition-mark" style={{ width: Math.min(width, clip.transitionIn.duration * zoom) }} />}
      <span className="clip-label">
        {clip.muted && <b className="badge" title="Sound removed"><Icon name="volumeOff" size={11} /><Sr>no sound </Sr></b>}
        {clip.freeze && <b className="badge" title="Freeze frame"><Icon name="snowflake" size={11} /><Sr>freeze </Sr></b>}
        {clip.speed !== 1 && <b className="badge" title="Speed"><Icon name="gauge" size={11} />{clip.speed}×</b>}
        {clip.reversed && <b className="badge" title="Reversed"><Icon name="reverse" size={11} /><Sr>reversed </Sr></b>}
        {clip.effects.length > 0 && <b className="badge" title={`${clip.effects.length} effect${clip.effects.length === 1 ? '' : 's'}`}><Icon name="sparkles" size={11} />{clip.effects.length}<Sr> fx</Sr></b>}
        {(clip.audioFx?.length ?? 0) > 0 && <b className="badge" title="Sound effects"><Icon name="sliders" size={11} />{clip.audioFx!.length}</b>}
        {clip.blend && <b className="badge" title={`Blend: ${clip.blend}`}><Icon name="layers" size={11} /></b>}
        {label}
      </span>
      {keyframeTimes.map((t) => (
        <span key={t} className="keyframe-mark" style={{ left: t * zoom }} />
      ))}
      <div className="handle start" onPointerDown={(e) => onPointerDown(e, 'trim-start')} />
      <div className="handle end" onPointerDown={(e) => onPointerDown(e, 'trim-end')} />
    </div>
  )
}

/** The bars under one clip: what was added to it, each with an eye (where it can be switched off) and an × to remove it. */
function TagBars({ clip, track, zoom, luts }: { clip: Clip; track: Track; zoom: number; luts: Project['luts'] }) {
  const tags = clipTags({ luts } as Project, clip)
  if (!tags.length) return null
  const shownTags = tags.length > MAX_TAG_ROWS ? tags.slice(0, MAX_TAG_ROWS - 1) : tags
  const hidden = tags.length - shownTags.length
  const act = (label: string, f: (p: Project) => Project) => { useEditor.getState().apply(label, f); useEditor.getState().select([clip.id]) }
  const width = Math.max(34, clip.duration * zoom)
  return (
    <>
      {shownTags.map((tag, i) => <TagBar key={tag.id} tag={tag} left={clip.start * zoom} top={i * TAG_H} width={width} locked={track.locked} onSelect={() => useEditor.getState().select([clip.id])} onRemove={() => act(`Remove ${tag.label}`, tag.remove)} onToggle={tag.toggle ? () => act(`${tag.enabled ? 'Turn off' : 'Turn on'} ${tag.label}`, tag.toggle!) : undefined} />)}
      {hidden > 0 && <div className="fx-tag fx-more" style={{ left: clip.start * zoom, top: (MAX_TAG_ROWS - 1) * TAG_H, width }} title={tags.slice(MAX_TAG_ROWS - 1).map((t) => t.label).join(', ')} onPointerDown={() => useEditor.getState().select([clip.id])}>+{hidden} more (see Properties)</div>}
    </>
  )
}

function TagBar({ tag, left, top, width, locked, onSelect, onRemove, onToggle }: { tag: ClipTag; left: number; top: number; width: number; locked: boolean; onSelect(): void; onRemove(): void; onToggle?: () => void }) {
  return (
    <div className={`fx-tag fx-${tag.kind} ${tag.enabled ? '' : 'off'}`} style={{ left, top, width }} title={tag.title} onPointerDown={(e) => { e.stopPropagation(); onSelect() }}>
      <span className="fx-name">{tag.label}</span>
      {!locked && onToggle && <button aria-label={`${tag.enabled ? 'Turn off' : 'Turn on'} ${tag.label}`} className="fx-btn" onPointerDown={(e) => e.stopPropagation()} onClick={onToggle}><Icon name={tag.enabled ? 'eye' : 'eyeOff'} size={10} /></button>}
      {!locked && <button aria-label={`Remove ${tag.label}`} className="fx-btn" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}>×</button>}
    </div>
  )
}

const KIND_ICON = { video: 'film', audio: 'music', text: 'type' } as const
const HEIGHTS = [34, 56, 88]

function TrackHeader({ track, index, count, shownHeight }: { track: Track; index: number; count: number; shownHeight: number }) {
  const apply = useEditor((s) => s.apply)
  const toggle = (key: 'muted' | 'hidden' | 'locked', label: string) => apply(label, (p) => ops.updateTrack(p, track.id, { [key]: !track[key] }))
  // Cycles small, medium and large rows.
  const nextHeight = HEIGHTS.find((h) => h > track.height + 2) ?? HEIGHTS[0]
  const compact = shownHeight < 44
  return (
    <div className={`track-header ${compact ? 'compact' : ''}`} style={{ height: shownHeight }}>
      <div className="track-title">
        <span className={`track-kind kind-${track.kind}`} title={`${track.kind} track`}><Icon name={KIND_ICON[track.kind]} size={13} /></span>
        <input
          className="track-name"
          value={track.name}
          aria-label="Track name"
          onChange={(e) => apply('Rename track', (p) => ops.updateTrack(p, track.id, { name: e.target.value }), { coalesce: `rename-${track.id}` })}
        />
      </div>
      <div className="track-buttons">
        {track.kind === 'audio' || track.kind === 'video' ? (
          <button className={track.muted ? 'on' : ''} onClick={() => toggle('muted', 'Mute track')} title={track.muted ? 'Unmute' : 'Mute'} aria-pressed={track.muted} aria-label="Mute track"><Icon name={track.muted ? 'volumeOff' : 'volume'} size={13} /></button>
        ) : null}
        {track.kind !== 'audio' && (
          <button className={track.hidden ? 'on' : ''} onClick={() => toggle('hidden', 'Hide track')} title={track.hidden ? 'Show' : 'Hide'} aria-pressed={track.hidden} aria-label="Hide track"><Icon name={track.hidden ? 'eyeOff' : 'eye'} size={13} /></button>
        )}
        <button className={track.locked ? 'on' : ''} onClick={() => toggle('locked', 'Lock track')} title={track.locked ? 'Unlock' : 'Lock'} aria-pressed={track.locked} aria-label="Lock track"><Icon name={track.locked ? 'lock' : 'unlock'} size={13} /></button>
        <span className="spacer" />
        <button onClick={() => apply('Track height', (p) => ops.updateTrack(p, track.id, { height: nextHeight }))} title="Row height" aria-label="Change track height"><Icon name="expand" size={13} /></button>
        <button disabled={index === 0} onClick={() => apply('Move track up', (p) => ops.moveTrack(p, track.id, index - 1))} title="Move up" aria-label="Move track up"><Icon name="up" size={13} /></button>
        <button disabled={index === count - 1} onClick={() => apply('Move track down', (p) => ops.moveTrack(p, track.id, index + 1))} title="Move down" aria-label="Move track down"><Icon name="down" size={13} /></button>
        <button
          onClick={() => {
            if (!track.clips.length || confirm(`Delete track "${track.name}" and its ${track.clips.length} clips?`)) apply('Delete track', (p) => ops.removeTrack(p, track.id))
          }}
          title="Delete track"
          aria-label="Delete track"
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      <div
        className="track-resize"
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) apply('Resize track', (p) => ops.updateTrack(p, track.id, { height: Math.max(28, Math.min(160, track.height + e.movementY)) }), { coalesce: `height-${track.id}` })
        }}
      />
    </div>
  )
}

export function Timeline() {
  const keyOverrides = useKeys((s) => s.overrides)
  const nest = useNest()
  const rangeIn = useUi((u) => u.rangeIn)
  const rangeOut = useUi((u) => u.rangeOut)
  const hasSel = useEditor((s) => s.selection.length > 0)
  const unnestable = useEditor((s) => canUnnest())
  const tracks = useEditor((s) => s.project!.tracks)
  const duration = useEditor((s) => ops.projectDuration(s.project!))
  const zoom = useEditor((s) => s.zoom)
  const snapping = useEditor((s) => s.snapping)
  const snapMarks = useEditor((s) => s.snapMarks)
  const media = useEditor((s) => s.project!.media)
  const marks = useMemo(() => musicMarks({ tracks, media } as never), [tracks, media])
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const selectionCount = useEditor((s) => s.selection.length)
  const editor = useEditor.getState()
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const fitRows = useUi((u) => u.fitRows)
  const showTags = useUi((u) => u.showTags)
  const luts = useEditor((s) => s.project!.luts)
  // Spare height in the timeline: rows grow up to twice their own height to use it.
  const [availableHeight, setAvailableHeight] = useState(0)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = (): void => setAvailableHeight(el.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const RULER = 24
  const baseTotal = tracks.reduce((a, t) => a + t.height, 0)
  /** Rows of tag bars a track needs under its clips: as many as the clip with the most tags. */
  const tagRows = (t: Track): number => (showTags ? Math.min(MAX_TAG_ROWS, Math.max(0, ...t.clips.map((c) => clipTags({ luts } as Project, c).length))) : 0)
  const tagTotal = tracks.reduce((a, t) => a + tagRows(t) * TAG_H, 0)
  const rowScale = fitRows && baseTotal > 0 ? Math.max(1, Math.min(2, (availableHeight - RULER - 4 - tagTotal) / baseTotal)) : 1
  const shown = (t: Track): number => Math.round(t.height * rowScale)
  const [dropTrack, setDropTrack] = useState<string | null>(null)
  const [dropTime, setDropTime] = useState<number | null>(null)
  // Highlights where clips dragged from the other split-view window will land.
  useEffect(() => window.api.split.onHover((at) => {
    const target = at ? dropTargetAt(at) : null
    setDropTrack(target?.trackId ?? null)
    setDropTime(target?.time ?? null)
  }), [])

  const contentWidth = Math.max(duration + 30, 60) * zoom

  const ghost = useGhost()
  /** Moves the playhead to where the pointer is (used when clicking or dragging on empty timeline space). */
  const seekTo = (clientX: number): void => {
    useEditor.getState().selectAsset(null)
    player.pause()
    player.seek(ops.snapToFrame(timeAt(clientX), useEditor.getState().project!.settings.fps))
  }

  const timeAt = (clientX: number): number => {
    const el = scrollRef.current!
    return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft) / zoom)
  }

  const onDrop = (e: React.DragEvent, track: Track) => {
    e.preventDefault()
    setDropTrack(null)
    clearGhost()
    const at = ops.snapToFrame(timeAt(e.clientX), useEditor.getState().project!.settings.fps)
    const assetId = e.dataTransfer.getData(ASSET_MIME)
    if (assetId) editor.insertAsset(assetId, track.id, at)
    const preset = TEXT_PRESETS.find((p) => p.name === e.dataTransfer.getData(TEXT_MIME))
    if (preset) {
      const clip = textClip(at, preset.text)
      if (preset.name === 'Lower third') clip.transform = { ...clip.transform, x: -0.22, y: 0.32 }
      // Text goes on this lane when it is a text lane with room, otherwise on a text track (a new one if needed).
      const target = track.kind === 'text' && !track.locked && ops.freeStart(track, at, clip.duration) === at ? track : tracks.find((x) => x.kind === 'text' && !x.locked && ops.freeStart(x, at, clip.duration) === at)
      editor.apply(`Add ${preset.name} text`, (p) => {
        const withTrack = target ? p : ops.addTrack(p, 'text')
        return ops.addClip(withTrack, (target ?? withTrack.tracks[0]).id, clip)
      })
      editor.select([clip.id])
      setTextEditor(true)
    }
  }

  const addText = () => {
    const track = tracks.find((t) => t.kind === 'text' && !t.locked)
    const clip = textClip(player.time)
    editor.apply('Add text', (p) => {
      const withTrack = track ? p : ops.addTrack(p, 'text')
      return ops.addClip(withTrack, (track ?? withTrack.tracks[0]).id, clip)
    })
    editor.select([clip.id])
    setTextEditor(true)
  }

  /** Puts a generated clip at the playhead on a video track with room there, adding a track above if none has. */
  const addOverlay = (label: string, clip: Clip) => {
    const free = tracks.find((t) => t.kind === 'video' && !t.locked && ops.freeStart(t, clip.start, clip.duration) === clip.start)
    editor.apply(label, (p) => {
      const withTrack = free ? p : ops.addTrack(p, 'video')
      return ops.addClip(withTrack, (free ?? withTrack.tracks[0]).id, clip)
    })
    editor.select([clip.id])
  }
  const addAdjustment = () => addOverlay('Add effects layer', makeClip({ assetId: null, start: player.time, duration: 5 }))
  const addShape = () => addOverlay('Add shape', shapeClip(player.time))

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <button className="icon-btn" onClick={editor.undo} disabled={!canUndo} title={withKey('Undo', 'undo', keyOverrides)}><Icon name="undo" /><Sr>Undo</Sr></button>
        <button className="icon-btn" onClick={editor.redo} disabled={!canRedo} title={withKey('Redo', 'redo', keyOverrides)}><Icon name="redo" /><Sr>Redo</Sr></button>
        <span className="sep" />
        <button disabled={nest.busy || !hasSel} onClick={() => void nestSelection()} title={withKey('Nest the selected clips into one', 'nest', keyOverrides)}>Nest</button>
        <button disabled={nest.busy || !unnestable} onClick={unnestSelection} title={withKey('Unnest (put the original clips back)', 'unnest', keyOverrides)}>Unnest</button>
        {nest.note && <span className="nest-note" role="status" title={nest.note}>{nest.note}</span>}
        <button onClick={() => markIn(player.time)} title={withKey('Set the in mark: start of the part that is exported', 'markIn', keyOverrides)} aria-label="Set in mark">[ In</button>
        <button onClick={() => markOut(player.time)} title={withKey('Set the out mark: end of the part that is exported', 'markOut', keyOverrides)} aria-label="Set out mark">Out ]</button>
        {(rangeIn !== null || rangeOut !== null) && <button onClick={clearRange} title={withKey('Clear the in and out marks', 'clearRange', keyOverrides)} aria-label="Clear region">✕ Region</button>}
        <button className="with-icon" onClick={editor.splitAtPlayhead} title={withKey('Split at playhead', 'split', keyOverrides)}><Icon name="scissors" /> Split</button>
        <button className="with-icon" onClick={editor.deleteSelection} disabled={!hasSelection} title="Delete (Del)"><Icon name="trash" /> Delete</button>
        <span className="sep" />
        <select
          value=""
          aria-label="Add"
          title="Add to the timeline, or arrange the selected clips"
          onChange={(e) => {
            const choice = e.target.value
            if (!choice) return
            if (choice === 'text') addText()
            else if (choice === 'shape') addShape()
            else if (choice === 'effects') addAdjustment()
            else if (choice === 'duplicate') editor.duplicateSelection()
            else if (choice.startsWith('track:')) editor.apply('Add track', (p) => ops.addTrack(p, choice.slice(6) as Track['kind']))
            else if (choice.startsWith('split:')) editor.apply('Split screen', (p) => splitScreen(p, useEditor.getState().selection, choice.slice(6) as SplitLayout))
          }}
        >
          <option value="">+ Add</option>
          <optgroup label="At the playhead">
            <option value="text">Text</option>
            <option value="shape">Shape</option>
            <option value="effects">Effects layer</option>
          </optgroup>
          <optgroup label="Track">
            <option value="track:video">Video track</option>
            <option value="track:audio">Audio track</option>
            <option value="track:text">Text track</option>
          </optgroup>
          <optgroup label="Selected clips">
            <option value="duplicate" disabled={!hasSelection}>Duplicate</option>
            <option value="split:left-right" disabled={selectionCount < 2}>Split screen: side by side</option>
            <option value="split:top-bottom" disabled={selectionCount < 2}>Split screen: top and bottom</option>
            <option value="split:grid" disabled={selectionCount < 2}>Split screen: grid</option>
          </optgroup>
        </select>
        <span className="spacer" />
        <button className={`icon-btn ${showTags ? 'on' : ''}`} onClick={() => setShowTags(!showTags)} aria-pressed={showTags} title="Show effects, looks, speed and more as bars under each clip, with an × to remove them" aria-label="Show effects under clips"><Icon name="sparkles" /></button>
        <button className={`icon-btn ${fitRows ? 'on' : ''}`} onClick={() => setFitRows(!fitRows)} aria-pressed={fitRows} title="Taller rows: use spare height in the timeline" aria-label="Fit track rows"><Icon name="grid" /></button>
        <button className={`with-icon ${snapping ? 'on' : ''}`} onClick={editor.toggleSnapping} aria-pressed={snapping} title="Snap to clip edges and the playhead (magnet)"><Icon name="magnet" /> Snap</button>
        {marks.beats.length > 0 && <button className={snapping && snapMarks.beats ? 'on' : ''} disabled={!snapping} onClick={() => editor.toggleSnapMark('beats')} aria-pressed={snapMarks.beats} title="Also snap to the music's beats">Beats</button>}
        {marks.snares.length > 0 && <button className={snapping && snapMarks.snares ? 'on' : ''} disabled={!snapping} onClick={() => editor.toggleSnapMark('snares')} aria-pressed={snapMarks.snares} title="Also snap to the music's snare hits">Snares</button>}
        <label className="zoom">
          <span className="dim">Zoom</span>
          <input type="range" min={Math.log(4)} max={Math.log(800)} step={0.01} value={Math.log(zoom)} onChange={(e) => editor.setZoom(Math.exp(Number(e.target.value)))} aria-label="Timeline zoom" title="Zoom the timeline (+ or -)" />
        </label>
      </div>
      <div className="timeline-body" ref={bodyRef}>
        <div className="track-headers" style={{ width: HEADER_WIDTH }}>
          <div className="ruler-corner" />
          {tracks.map((t, i) => (
            <TrackHeader key={t.id} track={t} index={i} count={tracks.length} shownHeight={shown(t) + tagRows(t) * TAG_H} />
          ))}
        </div>
        <div
          className="track-scroll"
          ref={scrollRef}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) editor.setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
          }}
        >
          <div className="track-content" style={{ width: contentWidth }}>
            <Ruler zoom={zoom} duration={Math.max(duration + 30, 60)} marks={{ beats: snapping && snapMarks.beats ? marks.beats : [], snares: snapping && snapMarks.snares ? marks.snares : [] }} />
            {tracks.map((t) => (
              <div key={t.id} className="lane-group">
              <div
                className={`lane lane-${t.kind} ${t.locked ? 'locked' : ''} ${dropTrack === t.id ? 'drop' : ''}`}
                style={{ height: shown(t) }}
                data-track-id={t.id}
                onPointerDown={(e) => {
                  // Empty space: deselect, move the playhead there, and keep following the pointer while it is held down.
                  if (e.target !== e.currentTarget || e.button !== 0) return
                  editor.select([])
                  e.currentTarget.setPointerCapture(e.pointerId)
                  seekTo(e.clientX)
                }}
                onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e.clientX) }}
                onDragOver={(e) => {
                  const types = e.dataTransfer.types
                  if (types.includes(ASSET_MIME) || types.includes(TEXT_MIME)) {
                    e.preventDefault()
                    setDropTrack(t.id)
                    useGhost.setState({ trackId: t.id, time: ops.snapToFrame(timeAt(e.clientX), useEditor.getState().project!.settings.fps), duration: dragPayload.duration, label: dragPayload.label })
                  }
                }}
                onDragLeave={() => { setDropTrack(null); clearGhost() }}
                onDrop={(e) => onDrop(e, t)}
              >
                {t.clips.map((c) => (
                  <ClipView key={c.id} clip={c} track={{ ...t, height: shown(t) }} zoom={zoom} />
                ))}
                {ghost.trackId === t.id && <div className="drop-ghost" style={{ left: ghost.time * zoom, width: Math.max(24, ghost.duration * zoom) }}><span>{ghost.label}</span></div>}
              </div>
              {tagRows(t) > 0 && (
                <div className="fx-lane" style={{ height: tagRows(t) * TAG_H }} aria-label={`Effects under the clips of ${t.name}`}>
                  {t.clips.map((c) => <TagBars key={c.id} clip={c} track={t} zoom={zoom} luts={luts} />)}
                </div>
              )}
              </div>
            ))}
            {tracks.every((t) => t.clips.length === 0) && (
              <div className="timeline-empty">
                <Icon name="film" size={28} />
                <strong>Your timeline is empty</strong>
                <span>Import clips in the Media tab, then double-click one or drag it here.</span>
              </div>
            )}
            <Playhead zoom={zoom} />
            {dropTime !== null && <div className="drop-marker" style={{ left: dropTime * zoom }} />}
          </div>
        </div>
      </div>
    </div>
  )
}
