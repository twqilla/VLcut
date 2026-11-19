/** Editor actions built on motion analysis: stabilise, track a point, attach to it, and auto reframe. */
import { create } from 'zustand'
import type { Clip, Keyframe, Project } from '@shared/types'
import { findClip, setClipSpeed, updateClip } from '@shared/timeline/ops'
import { alignBySync, multicamCut } from '@shared/timeline/multicam'
import { planReframe, planStabilization, sourcePoint, trackedPositions, type Geometry } from '@shared/timeline/motion'
import { useEditor } from './store'
import { player, usePreviewTool } from './engine/player'

interface MotionState {
  busy: string | null
  note: string
  /** Where the tracked point sat at each moment of the tracked clip, ready to attach other clips to. */
  track: { clipId: string; positions: { t: number; x: number; y: number }[]; lostAt?: number } | null
}
export const useMotion = create<MotionState>(() => ({ busy: null, note: '', track: null }))
const set = (patch: Partial<MotionState>): void => useMotion.setState(patch)

function context(): { project: Project; clip: Clip; geometry: Geometry; path: string } | null {
  const { project, selection } = useEditor.getState()
  if (!project || selection.length !== 1) return null
  const found = findClip(project, selection[0])
  const asset = found?.clip.assetId ? project.media.find((m) => m.id === found.clip.assetId) : undefined
  if (!found || !asset || asset.kind !== 'video' || !asset.width || !asset.height || asset.missing) return null
  return { project, clip: found.clip, path: asset.path, geometry: { projectW: project.settings.width, projectH: project.settings.height, assetW: asset.width, assetH: asset.height } }
}

async function run(label: string, job: () => Promise<string>): Promise<void> {
  set({ busy: label, note: '' })
  try {
    set({ note: await job() })
  } catch (err) {
    set({ note: `${label} failed: ${(err as Error).message}` })
  } finally {
    set({ busy: null })
  }
}

const sourceRange = (clip: Clip): { sourceStart: number; sourceDuration: number } => ({ sourceStart: clip.sourceIn, sourceDuration: clip.duration * clip.speed })

export function stabilizeSelection(smoothSeconds = 0.8): Promise<void> {
  return run('Stabilising', async () => {
    const ctx = context()
    if (!ctx) return 'Select one video clip first.'
    const { clip } = ctx
    const base = clip.stab ? { x: clip.stab.x, y: clip.stab.y, scale: clip.transform.scale / clip.stab.zoom } : { x: clip.transform.x, y: clip.transform.y, scale: clip.transform.scale }
    const result = await window.api.motion.stabilize({ path: ctx.path, ...sourceRange(clip), smoothSeconds })
    const baseClip: Clip = { ...clip, transform: { ...clip.transform, ...base } }
    const plan = planStabilization(baseClip, ctx.geometry, result.points, result.fps)
    useEditor.getState().updateSelected('Stabilize', (c) => ({
      transform: { ...c.transform, scale: base.scale * plan.zoom },
      keyframes: { ...c.keyframes, x: plan.keyframes.x, y: plan.keyframes.y },
      stab: { zoom: plan.zoom, x: base.x, y: base.y }
    }))
    player.invalidate()
    return `Stabilised. The picture is enlarged ${Math.round((plan.zoom - 1) * 100)} % to hide the edges the corrections reveal; the largest correction was ${(plan.maxShift * 100).toFixed(1)} % of the width.`
  })
}

export function removeStabilization(): void {
  useEditor.getState().updateSelected('Remove stabilization', (c) => {
    if (!c.stab) return {}
    const keyframes = { ...c.keyframes }
    delete keyframes.x
    delete keyframes.y
    return { transform: { ...c.transform, scale: c.transform.scale / c.stab.zoom, x: c.stab.x, y: c.stab.y }, keyframes, stab: undefined }
  })
  set({ note: 'Stabilisation removed.' })
}

/** A click on the preview while picking: remembers which point of the picture it landed on. */
export function pickTrackPoint(px: number, py: number): void {
  const ctx = context()
  if (!ctx) return
  const lt = Math.max(0, Math.min(ctx.clip.duration, player.time - ctx.clip.start))
  const p = sourcePoint(ctx.clip, ctx.geometry, px, py, lt)
  usePreviewTool.setState({ pickingTrack: false, trackPick: { clipId: ctx.clip.id, x: p.x, y: p.y, t: lt, screenX: px, screenY: py } })
}

export function trackFromPick(): Promise<void> {
  return run('Tracking', async () => {
    const ctx = context()
    const pick = usePreviewTool.getState().trackPick
    if (!ctx || !pick || pick.clipId !== ctx.clip.id) return 'Pick a point on the picture first.'
    const { clip } = ctx
    // Follow forward from the picked moment to the end of the clip.
    const from = clip.sourceIn + pick.t * clip.speed
    const result = await window.api.motion.track({ path: ctx.path, sourceStart: from, sourceDuration: Math.max(0.2, (clip.duration - pick.t) * clip.speed), point: { x: pick.x, y: pick.y } })
    // Times are measured from `from`, so shift them onto the clip's own timeline.
    const shifted: Clip = { ...clip, sourceIn: from, duration: clip.duration - pick.t, start: clip.start + pick.t }
    const positions = trackedPositions(shifted, ctx.geometry, result.points, result.fps).map((p) => ({ ...p, t: p.t + pick.t }))
    set({ track: { clipId: clip.id, positions, lostAt: result.lostAt } })
    const seconds = positions.length ? positions[positions.length - 1].t - positions[0].t : 0
    return result.lostAt !== undefined ? `Followed the point for ${seconds.toFixed(1)} s, then lost it (the picture changed too much).` : `Followed the point for ${seconds.toFixed(1)} s.`
  })
}

/** Moves another clip along with the tracked point. */
export function attachToTrack(targetId: string): void {
  const { track } = useMotion.getState()
  const { project, apply } = useEditor.getState()
  if (!track || !project) return
  const source = findClip(project, track.clipId)?.clip
  const target = findClip(project, targetId)?.clip
  if (!source || !target) return
  const shift = source.start - target.start
  const keys = (axis: 'x' | 'y'): Keyframe[] =>
    track.positions
      .map((p) => ({ t: p.t + shift, value: p[axis], easing: 'linear' as const }))
      .filter((k) => k.t >= -1e-6 && k.t <= target.duration + 1e-6)
      .map((k) => ({ ...k, t: Math.max(0, k.t) }))
  const [x, y] = [keys('x'), keys('y')]
  if (!x.length) return set({ note: 'The tracked clip and that clip do not overlap in time.' })
  apply('Attach to tracked point', (p) => updateClip(p, targetId, { keyframes: { ...target.keyframes, x, y }, autoMotion: 'tracked' }))
  player.invalidate()
  set({ note: 'Attached. The clip now follows the tracked point.' })
}

export function reframeSelection(): Promise<void> {
  return run('Reframing', async () => {
    const ctx = context()
    if (!ctx) return 'Select one video clip first.'
    const result = await window.api.motion.focus({ path: ctx.path, ...sourceRange(ctx.clip) })
    const plan = planReframe({ ...ctx.clip, transform: { ...ctx.clip.transform, x: 0, y: 0, scale: 1 }, keyframes: {} }, ctx.geometry, result.points, result.fps)
    useEditor.getState().updateSelected('Auto reframe', (c) => ({ transform: { ...c.transform, scale: plan.scale, x: 0, y: 0 }, keyframes: { ...c.keyframes, x: plan.keyframes.x, y: plan.keyframes.y }, stab: undefined, autoMotion: 'reframe' as const }))
    player.invalidate()
    return 'Reframed: the picture fills the frame and a virtual camera follows the busiest part of the shot.'
  })
}

/** Fast-forward that still looks smooth: the clip is sped up with frame blending, silenced, then stabilised. */
export async function hyperlapseSelection(speed: number): Promise<void> {
  const { project, selection, apply } = useEditor.getState()
  if (!project || selection.length !== 1) return
  const id = selection[0]
  apply('Hyperlapse', (p) => updateClip(setClipSpeed(p, id, speed), id, { frameBlend: true, muted: true }))
  await stabilizeSelection(1.2)
}

// ---- Multicam ----

/** Moves the other selected clips so they line up with the first selected clip by sound. */
export async function syncSelectionByAudio(): Promise<string> {
  const { project, selection, apply } = useEditor.getState()
  if (!project || selection.length < 2) return 'Select two or more clips from different cameras first (Ctrl-click).'
  const clips = selection.map((id) => findClip(project, id)?.clip).filter((c): c is Clip => Boolean(c))
  const pathOf = (c: Clip): string | undefined => project.media.find((m) => m.id === c.assetId && (m.hasAudio || m.kind === 'audio'))?.path
  const [ref, ...rest] = clips
  const tracks = clips.map((c) => project.tracks.find((t) => t.clips.some((x) => x.id === c.id))?.id)
  if (new Set(tracks).size < clips.length) return 'Put each camera on its own track first (drag a clip onto another track), then line them up.'
  const refPath = pathOf(ref)
  if (!refPath) return 'The first selected clip has no sound to line up by.'
  const results: { id: string; lag: number; confidence: number }[] = []
  for (const c of rest) {
    const p = pathOf(c)
    if (!p) return 'Every selected clip needs sound to line up by.'
    results.push({ id: c.id, ...(await window.api.audio.sync(refPath, p)) })
  }
  const weak = results.filter((r) => r.confidence < 9)
  if (weak.length) return `Could not find a clear match for ${weak.length} of ${results.length} clip${results.length === 1 ? '' : 's'}: they may not have recorded the same sound. Nothing was moved.`
  apply('Sync clips by audio', (p) => alignBySync(p, ref.id, results))
  return `Lined up ${results.length} clip${results.length === 1 ? '' : 's'} with the first one by sound.`
}

/** Builds a Multicam track that shows the selected clips in turn. */
export function cutBetweenSelection(segmentSeconds: number): string {
  const { project, selection, apply } = useEditor.getState()
  if (!project) return ''
  const preview = multicamCut(project, selection, segmentSeconds)
  if (!preview.pieces) return 'Select two or more clips that overlap in time (line them up first), then try again.'
  apply('Multicam cut', (p) => multicamCut(p, selection, segmentSeconds).project)
  return `Made ${preview.pieces} cuts over ${preview.length.toFixed(1)} s. The cameras' own tracks are hidden; sound comes from the first one.`
}
