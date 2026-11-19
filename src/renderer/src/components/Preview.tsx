import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../store'
import { player, usePlayback, usePreviewTool } from '../engine/player'
import { activeClips, projectDuration } from '@shared/timeline/ops'
import { formatTimecode, mediaUrl } from '../format'
import { applyGroupOp, boundsOf, withValues, type GroupOp, type Vals } from '@shared/timeline/group'
import * as ops from '@shared/timeline/ops'
import { withKey } from '@shared/shortcuts'
import { useKeys } from '../keys'
import { findClip } from '@shared/timeline/ops'
import { propAt, upsertKeyframe } from '@shared/timeline/keyframes'
import type { AnimProp } from '@shared/types'
import { pickTrackPoint } from '../motion'
import { useQuality } from '../engine/quality'
import { formatOffset, hideReadout, showReadout, useReadout } from '../readout'
import { Icon, Sr } from './Icon'
import { setTextEditor, togglePreviewFocus, useUi } from '../ui'
import { TextEditor } from './TextEditor'
import { maskPointsAt, withMaskPoint, withoutKeys } from '@shared/timeline/mask'

const QUALITIES = [
  { label: 'Full', scale: 1 },
  { label: 'Half', scale: 0.5 },
  { label: 'Quarter', scale: 0.25 }
]

function Timecode() {
  const time = usePlayback((s) => s.time)
  const fps = useEditor((s) => s.project!.settings.fps)
  const duration = useEditor((s) => projectDuration(s.project!))
  return (
    <span className="timecode">
      {formatTimecode(time, fps)} <span className="dim">/ {formatTimecode(duration, fps)}</span>
    </span>
  )
}

/** The program monitor: draws the timeline at the playhead. */
/** What a group drag remembers: each clip's values at the start and the group's centre (fractions of the frame). */
interface GroupSession { initial: Map<string, Vals>; centre: { x: number; y: number }; key: string }

export function Preview() {
  const keyOverrides = useKeys((s) => s.overrides)
  const settings = useEditor((s) => s.project!.settings)
  const sourceAsset = useEditor((s) => s.project!.media.find((m) => m.id === s.selectedAssetId))
  const playing = usePlayback((s) => s.playing)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  /** Size the picture is shown at: as large as fits the panel, keeping the project's shape. */
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null)
  const readout = useReadout()
  const focusOn = useUi((s) => s.previewFocus)
  const quality = useQuality((s) => s.scale)
  const qualityMode = useQuality((s) => s.mode)
  const qualityNote = useQuality((s) => s.note)
  /** Selected clips that have a picture (video, photo, text, shape), as one string so the selector stays stable. */
  const visualKey = useEditor((s) => s.selection.filter((id) => {
    const clip = findClip(s.project!, id)?.clip
    const asset = clip && s.project!.media.find((m) => m.id === clip.assetId)
    return Boolean(clip && (clip.text || clip.shape || (asset && asset.kind !== 'audio')))
  }).join(','))
  const visualIds = visualKey ? visualKey.split(',') : []
  const selectionSize = useEditor((s) => s.selection.length)
  /** One clip is moved directly; two or more move, scale and turn together as a group. */
  const groupMode = visualIds.length >= 2
  const movable = selectionSize === 1 ? visualIds.length === 1 : groupMode
  const drawingMask = usePreviewTool((s) => s.drawingMask)
  const pickingTrack = usePreviewTool((s) => s.pickingTrack)
  const trackPick = usePreviewTool((s) => s.trackPick)
  const editingMask = usePreviewTool((s) => s.editingMask)
  const maskClip = useEditor((s) => {
    const clip = s.selection.length === 1 ? findClip(s.project!, s.selection[0])?.clip : undefined
    return clip?.mask?.shape === 'polygon' && (clip.mask.points?.length ?? 0) >= 3 ? clip : undefined
  })
  const playTime = usePlayback((s) => s.time)
  const groupDrag = useRef<(GroupSession & { x: number; y: number }) | null>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; os: number; or: number; key: string } | null>(null)

  /** Writes position or scale the same way the inspector does: to a keyframe when the property is animated. */
  const nudge = (values: Partial<Record<AnimProp, number>>, key: string) =>
    useEditor.getState().updateSelected('Move on preview', (c) => {
      const t = Math.max(0, Math.min(c.duration, player.time - c.start))
      const keyframes = { ...c.keyframes }
      const transform = { ...c.transform }
      for (const [prop, value] of Object.entries(values) as [AnimProp, number][]) {
        if (keyframes[prop]?.length) keyframes[prop] = upsertKeyframe(keyframes[prop], { t, value, easing: 'easeInOut' })
        else if (prop === 'x' || prop === 'y' || prop === 'scale' || prop === 'rotation') transform[prop] = value
      }
      return { keyframes, transform }
    }, key)

  const current = (prop: AnimProp): number => {
    const s = useEditor.getState()
    const clip = findClip(s.project!, s.selection[0])!.clip
    return propAt(clip, prop, Math.max(0, Math.min(clip.duration, player.time - clip.start)))
  }

  // Selection box with scale and rotate handles, for the one selected clip.
  const shownIds = groupMode ? visualIds : selectionSize === 1 && visualIds.length === 1 ? visualIds : []
  const shownKey = shownIds.join(',')
  const handlesOn = Boolean(shownIds.length && movable && !drawingMask && !pickingTrack && !(sourceAsset && !sourceAsset.missing))
  const [box, setBox] = useState<{ cx: number; cy: number; w: number; h: number; rotation: number } | null>(null)
  useEffect(() => {
    if (!shownKey || !handlesOn) {
      player.watch([])
      setBox(null)
      return
    }
    const ids = shownKey.split(',')
    player.watch(ids)
    const timer = window.setInterval(() => {
      const r = ids.length === 1 ? player.rectFor(ids[0]) : boundsOf(ids.flatMap((id) => { const x = player.rectFor(id); return x ? [x] : [] }))
      setBox((prev) => (r && prev && Math.abs(prev.cx - r.cx) < 0.5 && Math.abs(prev.cy - r.cy) < 0.5 && Math.abs(prev.w - r.w) < 0.5 && Math.abs(prev.h - r.h) < 0.5 && prev.rotation === r.rotation ? prev : r ? { ...r } : null))
    }, 80)
    return () => {
      window.clearInterval(timer)
      player.watch([])
    }
  }, [shownKey, handlesOn])

  /** A group drag: the values every clip had when it began, and the group's centre as fractions of the frame. */
  const startGroup = (): GroupSession => {
    const { project, } = useEditor.getState()
    const initial = new Map<string, Vals>()
    for (const id of shownIds) {
      const c = findClip(project!, id)!.clip
      const t = Math.max(0, Math.min(c.duration, player.time - c.start))
      initial.set(id, { x: propAt(c, 'x', t), y: propAt(c, 'y', t), scale: propAt(c, 'scale', t), rotation: propAt(c, 'rotation', t) })
    }
    return { initial, centre: { x: (box?.cx ?? width / 2) / width - 0.5, y: (box?.cy ?? height / 2) / height - 0.5 }, key: `group-${Date.now()}` }
  }
  const applyGroup = (g: GroupSession, op: GroupOp): void => {
    useEditor.getState().apply('Move group on preview', (p) => shownIds.reduce((acc, id) => {
      const found = ops.findClip(acc, id)
      const from = g.initial.get(id)
      return found && from ? ops.updateClip(acc, id, withValues(found.clip, applyGroupOp(from, op, g.centre, settings.width / settings.height), player.time - found.clip.start)) : acc
    }, p), { coalesce: g.key })
  }
  const dragGroupHandle = (e: React.PointerEvent<SVGElement>, k: number, kind: 'scale' | 'rotate') => {
    if (!box) return
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const [cx, cy] = [r.left + box.cx * k, r.top + box.cy * k]
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx)
    const g = startGroup()
    const move = (ev: PointerEvent): void => {
      if (kind === 'scale') {
        const factor = Math.max(0.05, Math.min(6, Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0))
        showReadout(ev.clientX, ev.clientY, [`Group scale ${Math.round(factor * 100)} %`])
        applyGroup(g, { factor })
      } else {
        let degrees = ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI
        if (!ev.altKey) { const snapped = Math.round(degrees / 15) * 15; if (Math.abs(snapped - degrees) < 3) degrees = snapped }
        showReadout(ev.clientX, ev.clientY, [`Group rotation ${Math.round(degrees * 10) / 10}°`])
        applyGroup(g, { degrees })
      }
    }
    const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); hideReadout() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Drags a corner: the clip grows or shrinks with the pointer's distance from the clip's centre. */
  const dragScale = (e: React.PointerEvent<SVGElement>, k: number) => {
    if (!box) return
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const [cx, cy] = [r.left + box.cx * k, r.top + box.cy * k]
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1
    const s0 = current('scale')
    const key = `handle-scale-${Date.now()}`
    const move = (ev: PointerEvent): void => {
      const scale = Math.max(0.05, Math.min(6, (s0 * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / d0))
      showReadout(ev.clientX, ev.clientY, [`Scale ${Math.round(scale * 100)} %`])
      nudge({ scale }, key)
    }
    const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); hideReadout() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Drags the round handle: the clip turns to follow the pointer around its centre (15° steps unless Alt is held). */
  const dragRotate = (e: React.PointerEvent<SVGElement>, k: number) => {
    if (!box) return
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
    const [cx, cy] = [r.left + box.cx * k, r.top + box.cy * k]
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx)
    const r0 = current('rotation')
    const key = `handle-rotate-${Date.now()}`
    const move = (ev: PointerEvent): void => {
      let deg = r0 + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI
      if (!ev.altKey) { const snapped = Math.round(deg / 15) * 15; if (Math.abs(snapped - deg) < 3) deg = snapped }
      showReadout(ev.clientX, ev.clientY, [`Rotation ${Math.round(deg * 10) / 10}°`])
      nudge({ rotation: Math.round(deg * 10) / 10 }, key)
    }
    const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); hideReadout() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Click a picture or text in the preview to select it: its box is measured for one frame, then the top-most clip under the pointer wins. */
  const pickAt = async (canvas: HTMLCanvasElement, clientX: number, clientY: number, additive: boolean): Promise<void> => {
    const state = useEditor.getState()
    const active = activeClips(state.project!, player.time).filter((a) => a.role === 'main' && a.track.kind !== 'audio' && !a.track.hidden && !a.clip.matte).map((a) => a.clip.id)
    if (!active.length) return
    player.watch([...new Set([...shownIds, ...active])])
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    const r = canvas.getBoundingClientRect()
    const [px, py] = [((clientX - r.left) / r.width) * canvas.width, ((clientY - r.top) / r.height) * canvas.height]
    let hit: string | null = null
    for (const id of [...active].reverse()) {
      const b = player.rectFor(id)
      if (!b) continue
      const a = (-b.rotation * Math.PI) / 180
      const [dx, dy] = [px - b.cx, py - b.cy]
      const [lx, ly] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)]
      if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) { hit = id; break }
    }
    const now = useEditor.getState().selection
    if (hit && !now.includes(hit)) useEditor.getState().select([hit], additive)
    else player.watch(shownIds)
  }
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 0 && !pickingTrack && !drawingMask && !(sourceAsset && !sourceAsset.missing)) void pickAt(e.currentTarget, e.clientX, e.clientY, e.shiftKey || e.ctrlKey || e.metaKey)
    if (!movable || e.button !== 0) return
    if (pickingTrack) {
      const rect = e.currentTarget.getBoundingClientRect()
      const aspect = e.currentTarget.width / e.currentTarget.height
      const shownWidth = Math.min(rect.width, rect.height * aspect)
      pickTrackPoint((e.clientX - (rect.left + rect.width / 2)) / shownWidth, (e.clientY - (rect.top + rect.height / 2)) / (shownWidth / aspect))
      return
    }
    if (drawingMask) {
      // Each click adds a corner to the selected clip's hand-drawn mask.
      const rect = e.currentTarget.getBoundingClientRect()
      const aspect = e.currentTarget.width / e.currentTarget.height
      const shownWidth = Math.min(rect.width, rect.height * aspect)
      const px = (e.clientX - (rect.left + rect.width / 2)) / shownWidth
      const py = (e.clientY - (rect.top + rect.height / 2)) / (shownWidth / aspect)
      useEditor.getState().updateSelected('Add mask point', (c) => (c.mask ? { mask: withoutKeys({ ...c.mask, points: [...(c.mask.points ?? []), [px, py]] }) } : {}))
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (groupMode) { groupDrag.current = { ...startGroup(), x: e.clientX, y: e.clientY }; return }
    drag.current = { x: e.clientX, y: e.clientY, ox: current('x'), oy: current('y'), os: current('scale'), or: current('rotation'), key: `preview-${Date.now()}` }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const gd = groupDrag.current
    if (gd && e.currentTarget.hasPointerCapture(e.pointerId)) {
      const rect = e.currentTarget.getBoundingClientRect()
      const aspect = e.currentTarget.width / e.currentTarget.height
      const shownWidth = Math.min(rect.width, rect.height * aspect)
      if (e.shiftKey) return applyGroup(gd, { factor: Math.max(0.05, Math.min(6, Math.exp((gd.y - e.clientY) / 200))) })
      if (e.ctrlKey || e.metaKey) return applyGroup(gd, { degrees: (e.clientX - gd.x) * 0.4 })
      const [dx, dy] = [(e.clientX - gd.x) / shownWidth, (e.clientY - gd.y) / (shownWidth / aspect)]
      const off = formatOffset(gd.centre.x + dx, gd.centre.y + dy, settings.width, settings.height)
      showReadout(e.clientX, e.clientY, [...off.lines, 'group centre from the frame centre'])
      return applyGroup(gd, { dx, dy })
    }
    const d = drag.current
    if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    // Shift-drag resizes, Ctrl-drag rotates; a plain drag moves.
    if (e.shiftKey) {
      const scale = Math.max(0.05, Math.min(6, d.os * Math.exp((d.y - e.clientY) / 200)))
      showReadout(e.clientX, e.clientY, [`Scale ${Math.round(scale * 100)} %`])
      return nudge({ scale }, d.key)
    }
    if (e.ctrlKey || e.metaKey) {
      const rotation = d.or + (e.clientX - d.x) * 0.4
      showReadout(e.clientX, e.clientY, [`Rotation ${Math.round(rotation * 10) / 10}°`])
      return nudge({ rotation }, d.key)
    }
    // The picture is letterboxed inside the canvas element; measure movement against the picture itself.
    const rect = e.currentTarget.getBoundingClientRect()
    const aspect = e.currentTarget.width / e.currentTarget.height
    const shownWidth = Math.min(rect.width, rect.height * aspect)
    let x = d.ox + (e.clientX - d.x) / shownWidth
    let y = d.oy + (e.clientY - d.y) / (shownWidth / aspect)
    // Snap to the centre lines unless Alt is held.
    if (!e.altKey) {
      if (Math.abs(x) < 0.012) x = 0
      if (Math.abs(y) < 0.012) y = 0
    }
    const off = formatOffset(x, y, settings.width, settings.height)
    showReadout(e.clientX, e.clientY, [...off.lines, 'from the centre'], { guides: true, onCentreX: off.onCentreX, onCentreY: off.onCentreY })
    nudge({ x, y }, d.key)
  }
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!movable) return
    if (groupMode) { const g = startGroup(); return applyGroup(g, { factor: e.deltaY < 0 ? 1.04 : 1 / 1.04 }) }
    nudge({ scale: Math.max(0.05, Math.min(6, current('scale') * (e.deltaY < 0 ? 1.04 : 1 / 1.04))) }, 'preview-scale')
  }

  useEffect(() => {
    player.attach(canvasRef.current)
    return () => player.attach(null)
  }, [])
  useEffect(() => player.invalidate(), [quality, settings.width, settings.height, sourceAsset])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = (): void => {
      const style = getComputedStyle(el)
      const cw = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const ch = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const scale = Math.min(cw / settings.width, ch / settings.height)
      if (scale > 0 && Number.isFinite(scale)) setFit({ w: Math.floor(settings.width * scale), h: Math.floor(settings.height * scale) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [settings.width, settings.height])

  // Keep preview canvases modest: quality scales the project resolution, capped at 1080p-equivalent.
  const scale = Math.min(quality, 1920 / Math.max(settings.width, settings.height))
  const width = Math.max(2, Math.round(settings.width * scale))
  const height = Math.max(2, Math.round(settings.height * scale))

  return (
    <div className="preview-wrap">
      <TextEditor />
      <div className="preview" ref={stageRef}>
        {sourceAsset && !sourceAsset.missing ? (
          <div className="source-view">
            <span className="badge">Source: {sourceAsset.name}</span>
            {sourceAsset.kind === 'image' && <img src={mediaUrl(sourceAsset.path)} alt={sourceAsset.name} />}
            {sourceAsset.kind === 'video' && <video key={sourceAsset.id} src={mediaUrl(sourceAsset.proxyPath ?? sourceAsset.path)} controls />}
            {sourceAsset.kind === 'audio' && <audio key={sourceAsset.id} src={mediaUrl(sourceAsset.path)} controls />}
          </div>
        ) : null}
        {handlesOn && box && fit && !editingMask && (() => {
          const k = fit.w / width
          const [cx, cy, w, h] = [box.cx * k, box.cy * k, box.w * k, box.h * k]
          const corners: [string, number, number][] = [['top-left', -1, -1], ['top-right', 1, -1], ['bottom-left', -1, 1], ['bottom-right', 1, 1]]
          return (
            <svg className="sel-handles" width={fit.w} height={fit.h} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 3, overflow: 'visible' }} aria-label={groupMode ? 'Group selection handles' : 'Selection handles'}>
              <g transform={`rotate(${box.rotation} ${cx} ${cy})`}>
                <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} fill="none" stroke="var(--accent-hi)" strokeWidth={1.5} />
                <line x1={cx} y1={cy - h / 2} x2={cx} y2={cy - h / 2 - 22} stroke="var(--accent-hi)" strokeWidth={1.5} />
                {corners.map(([name, dx, dy]) => (
                  <rect key={name} x={cx + (dx * w) / 2 - 5} y={cy + (dy * h) / 2 - 5} width={10} height={10} fill="#fff" stroke="var(--accent)" strokeWidth={2} aria-label={`Scale handle ${name}`} style={{ pointerEvents: 'all', cursor: dx * dy > 0 ? 'nwse-resize' : 'nesw-resize' }} onPointerDown={(e) => (groupMode ? dragGroupHandle(e, k, 'scale') : dragScale(e, k))} />
                ))}
                <circle cx={cx} cy={cy - h / 2 - 22} r={6} fill="var(--accent)" stroke="#fff" strokeWidth={2} aria-label="Rotate handle" style={{ pointerEvents: 'all', cursor: 'grab' }} onPointerDown={(e) => (groupMode ? dragGroupHandle(e, k, 'rotate') : dragRotate(e, k))} />
              </g>
            </svg>
          )
        })()}
        {editingMask && maskClip && fit && !sourceAsset && (
          <svg className="mask-handles" width={fit.w} height={fit.h} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 3 }} aria-label="Mask corners">
            {(() => {
              const local = Math.max(0, Math.min(maskClip.duration, playTime - maskClip.start))
              const pts = maskPointsAt(maskClip.mask!, local)
              const at = (x: number, y: number): [number, number] => [fit.w / 2 + x * fit.w, fit.h / 2 + y * fit.h]
              return (
                <>
                  <polygon points={pts.map(([x, y]) => at(x, y).join(',')).join(' ')} fill="rgba(56,182,255,0.12)" stroke="#38b6ff" strokeWidth={1.5} />
                  {pts.map(([x, y], i) => {
                    const [cx, cy] = at(x, y)
                    return (
                      <circle
                        key={i}
                        cx={cx}
                        cy={cy}
                        r={7}
                        fill="#fff"
                        stroke="#38b6ff"
                        strokeWidth={2}
                        aria-label={`Mask corner ${i + 1}`}
                        style={{ pointerEvents: 'all', cursor: 'grab' }}
                        onPointerDown={(e) => {
                          e.preventDefault()
                          const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                          const key = `mask-corner-${Date.now()}`
                          const move = (ev: PointerEvent): void => {
                            const nx = Math.max(-1, Math.min(1, (ev.clientX - rect.left - rect.width / 2) / rect.width))
                            const ny = Math.max(-1, Math.min(1, (ev.clientY - rect.top - rect.height / 2) / rect.height))
                            { const off = formatOffset(nx, ny, settings.width, settings.height); showReadout(ev.clientX, ev.clientY, ['Mask corner', ...off.lines, 'from the centre'], { guides: true, onCentreX: off.onCentreX, onCentreY: off.onCentreY }) }
                            useEditor.getState().updateSelected('Move mask corner', (c) => (c.mask ? { mask: withMaskPoint(c.mask, Math.max(0, Math.min(c.duration, player.time - c.start)), i, [nx, ny]) } : {}), key)
                          }
                          const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); hideReadout() }
                          window.addEventListener('pointermove', move)
                          window.addEventListener('pointerup', up)
                        }}
                      />
                    )
                  })}
                </>
              )
            })()}
          </svg>
        )}
        {trackPick && fit && !sourceAsset && <span className="track-dot" style={{ left: `calc(50% + ${trackPick.screenX * fit.w}px)`, top: `calc(50% + ${trackPick.screenY * fit.h}px)` }} aria-label="Tracking point" />}
        {readout.guides && fit && !sourceAsset && (
          <svg className="centre-guides" width={fit.w} height={fit.h} style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 2 }} aria-hidden="true">
            <line x1={fit.w / 2} y1={0} x2={fit.w / 2} y2={fit.h} stroke={readout.onCentreX ? 'var(--accent-hi)' : 'rgba(255,255,255,0.25)'} strokeWidth={readout.onCentreX ? 2 : 1} strokeDasharray={readout.onCentreX ? undefined : '4 4'} />
            <line x1={0} y1={fit.h / 2} x2={fit.w} y2={fit.h / 2} stroke={readout.onCentreY ? 'var(--accent-hi)' : 'rgba(255,255,255,0.25)'} strokeWidth={readout.onCentreY ? 2 : 1} strokeDasharray={readout.onCentreY ? undefined : '4 4'} />
          </svg>
        )}
        {readout.visible && (
          <div className="drag-readout" role="status" style={{ left: readout.x + 16, top: readout.y + 16 }}>
            {readout.lines.map((l, i) => <div key={i} className={i === readout.lines.length - 1 && l === 'from the centre' ? 'dim' : ''}>{l}</div>)}
          </div>
        )}
        <canvas ref={canvasRef} width={width} height={height} style={{ display: sourceAsset && !sourceAsset.missing ? 'none' : undefined, width: fit?.w, height: fit?.h }} aria-label="Program preview" className={`${drawingMask || pickingTrack ? 'drawing' : movable ? 'movable' : ''} ${settings.pixelScaling ? 'pixelated' : ''}`} title={drawingMask ? 'Click to add corners to the mask' : movable ? 'Drag to move the selected clip. Shift-drag or scroll to resize, Ctrl-drag to rotate. Hold Alt to stop snapping to the centre.' : undefined} onPointerDown={onPointerDown} onDoubleClick={() => { const s = useEditor.getState(); const c = s.selection.length === 1 ? findClip(s.project!, s.selection[0])?.clip : undefined; if (c?.text) setTextEditor(true) }} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; groupDrag.current = null; hideReadout() }} onWheel={onWheel} />
      </div>
      <div className="transport">
        <Timecode />
        <div className="transport-buttons">
          <button onClick={() => player.seek(0)} title="Go to start (Home)" aria-label="Go to start"><Icon name="skipStart" /></button>
          <button onClick={() => player.step(-1)} title="Previous frame (←)" aria-label="Previous frame"><Icon name="stepBack" /></button>
          <button className="primary play" onClick={() => { useEditor.getState().selectAsset(null); player.toggle() }} title={withKey('Play / pause', 'playPause', keyOverrides)} aria-label={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={18} />
          </button>
          <button onClick={() => player.step(1)} title="Next frame (→)" aria-label="Next frame"><Icon name="stepForward" /></button>
          <button onClick={() => player.seek(Infinity)} title="Go to end (End)" aria-label="Go to end"><Icon name="skipEnd" /></button>
        </div>
        <button className="icon-btn focus-toggle" onClick={togglePreviewFocus} aria-pressed={focusOn} title="Make the preview larger (F)" aria-label="Focus preview"><Icon name={focusOn ? 'shrink' : 'expand'} /></button>
        <label className="quality">
          <span className="dim">{settings.width}×{settings.height}</span>
          <select value={qualityMode} onChange={(e) => useQuality.getState().choose(e.target.value === 'auto' ? 'auto' : Number(e.target.value))} aria-label="Preview quality" title="Preview quality (does not change the export)">
            <option value="auto">Preview auto</option>
            {QUALITIES.map((q) => (
              <option key={q.label} value={q.scale}>Preview {q.label}</option>
            ))}
          </select>
          {qualityNote && <span className="dim quality-note" role="status" title={qualityNote}>⚠ lowered</span>}
        </label>
      </div>
    </div>
  )
}
