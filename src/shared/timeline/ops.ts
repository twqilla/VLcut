/**
 * The timeline engine: pure functions that take a project and return a new one.
 * Nothing here mutates its input, which is what makes undo/redo and AI snapshots trivial.
 */
import type { AnimProp, Clip, Keyframe, MediaAsset, Project, Track, TrackKind } from '../types'
import { MIN_CLIP_DURATION, makeTrack, newId } from './model'
import { musicMarks } from './marks'
import { cubicBezier } from './keyframes'
import { transitionEase } from '../effects/more'

const EPS = 1e-6

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return { track, clip }
  }
  return undefined
}

export const clipEnd = (clip: Clip): number => clip.start + clip.duration

export function projectDuration(project: Project): number {
  return Math.max(0, ...project.tracks.flatMap((t) => t.clips.map(clipEnd)))
}

/** Where in the source file the clip is at timeline time `t`. */
export function sourceTime(clip: Clip, t: number): number {
  if (clip.freeze) return clip.sourceIn
  const local = t - clip.start
  return clip.reversed ? clip.sourceIn + (clip.duration - local) * clip.speed : clip.sourceIn + local * clip.speed
}

export function clipAt(track: Track, t: number): Clip | undefined {
  return track.clips.find((c) => t >= c.start - EPS && t < clipEnd(c) - EPS)
}

function mapTracks(project: Project, fn: (track: Track) => Track): Project {
  return { ...project, tracks: project.tracks.map(fn) }
}

function mapClip(project: Project, clipId: string, fn: (clip: Clip) => Clip): Project {
  return mapTracks(project, (t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) } : t))
}

/**
 * Earliest start >= `desired` where a clip of `duration` fits on the track
 * without overlapping another clip. `ignore` lists clips being moved.
 */
export function freeStart(track: Track, desired: number, duration: number, ignore: ReadonlySet<string> = new Set()): number {
  let start = Math.max(0, desired)
  const others = track.clips.filter((c) => !ignore.has(c.id)).sort((a, b) => a.start - b.start)
  for (const other of others) {
    if (start + duration <= other.start + EPS) break
    if (start < clipEnd(other) - EPS) start = clipEnd(other)
  }
  return start
}

export function addClip(project: Project, trackId: string, clip: Clip): Project {
  return mapTracks(project, (t) => (t.id === trackId ? { ...t, clips: [...t.clips, { ...clip, start: freeStart(t, clip.start, clip.duration) }] } : t))
}

export function updateClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  return mapClip(project, clipId, (c) => ({ ...c, ...patch }))
}

/** Moves a clip to a time and (optionally) another track of the same kind. */
export function moveClip(project: Project, clipId: string, trackId: string, start: number): Project {
  const found = findClip(project, clipId)
  const target = project.tracks.find((t) => t.id === trackId)
  if (!found || !target || target.kind !== found.track.kind || target.locked) return project
  const moved = { ...found.clip, start: freeStart(target, start, found.clip.duration, new Set([clipId])) }
  return mapTracks(project, (t) => {
    // Same track: replace in place, keeping the order of the other clips.
    if (t.id === trackId && t.id === found.track.id) return { ...t, clips: t.clips.map((c) => (c.id === clipId ? moved : c)) }
    const clips = t.clips.filter((c) => c.id !== clipId)
    return t.id === trackId ? { ...t, clips: [...clips, moved] } : clips.length === t.clips.length ? t : { ...t, clips }
  })
}

function shiftKeyframes(keyframes: Clip['keyframes'], by: number, duration: number): Clip['keyframes'] {
  const out: Clip['keyframes'] = {}
  for (const [prop, list] of Object.entries(keyframes) as [AnimProp, Keyframe[]][]) {
    const shifted = list.map((k) => ({ ...k, t: k.t - by })).filter((k) => k.t >= -EPS && k.t <= duration + EPS)
    if (shifted.length) out[prop] = shifted
  }
  return out
}

/** How much source the asset has; images and text are unbounded. */
function sourceLimit(clip: Clip, assets: MediaAsset[]): number {
  const asset = assets.find((a) => a.id === clip.assetId)
  return asset && asset.kind !== 'image' ? asset.duration : Infinity
}

/** Drags the left edge of a clip to `newStart`. */
export function trimClipStart(project: Project, clipId: string, newStart: number): Project {
  const found = findClip(project, clipId)
  if (!found) return project
  const { clip, track } = found
  const end = clipEnd(clip)
  const prevEnd = Math.max(0, ...track.clips.filter((c) => c.id !== clipId && clipEnd(c) <= clip.start + EPS).map(clipEnd))
  // Source available before the current in point (after the out point when reversed).
  const headroom = clip.reversed ? (sourceLimit(clip, project.media) - (clip.sourceIn + clip.duration * clip.speed)) / clip.speed : clip.sourceIn / clip.speed
  const start = Math.min(end - MIN_CLIP_DURATION, Math.max(newStart, prevEnd, clip.start - headroom))
  const delta = start - clip.start
  return mapClip(project, clipId, (c) => ({
    ...c,
    start,
    duration: end - start,
    sourceIn: c.reversed ? c.sourceIn : Math.max(0, c.sourceIn + delta * c.speed),
    keyframes: shiftKeyframes(c.keyframes, delta, end - start)
  }))
}

/** Drags the right edge of a clip to `newEnd`. */
export function trimClipEnd(project: Project, clipId: string, newEnd: number): Project {
  const found = findClip(project, clipId)
  if (!found) return project
  const { clip, track } = found
  const nextStart = Math.min(Infinity, ...track.clips.filter((c) => c.id !== clipId && c.start >= clipEnd(clip) - EPS).map((c) => c.start))
  const tailroom = clip.reversed ? clip.sourceIn / clip.speed : (sourceLimit(clip, project.media) - clip.sourceIn) / clip.speed - clip.duration
  const end = Math.max(clip.start + MIN_CLIP_DURATION, Math.min(newEnd, nextStart, clipEnd(clip) + tailroom))
  const delta = end - clipEnd(clip)
  return mapClip(project, clipId, (c) => ({
    ...c,
    duration: end - c.start,
    sourceIn: c.reversed ? Math.max(0, c.sourceIn - delta * c.speed) : c.sourceIn
  }))
}

/** Cuts a clip in two at timeline time `t`. Returns the project unchanged if `t` is not inside the clip. */
export function splitClip(project: Project, clipId: string, t: number): Project {
  const found = findClip(project, clipId)
  if (!found) return project
  const { clip } = found
  const local = t - clip.start
  if (local < MIN_CLIP_DURATION || clip.duration - local < MIN_CLIP_DURATION) return project
  const rest = clip.duration - local
  const first: Clip = {
    ...clip,
    duration: local,
    sourceIn: clip.reversed ? clip.sourceIn + rest * clip.speed : clip.sourceIn,
    fadeOut: 0,
    keyframes: shiftKeyframes(clip.keyframes, 0, local)
  }
  const second: Clip = {
    ...clip,
    id: newId(),
    start: t,
    duration: rest,
    sourceIn: clip.reversed ? clip.sourceIn : clip.sourceIn + local * clip.speed,
    fadeIn: 0,
    transitionIn: undefined,
    effects: clip.effects.map((e) => ({ ...e, id: newId() })),
    keyframes: shiftKeyframes(clip.keyframes, local, rest),
    text: clip.text?.words ? { ...clip.text, words: clip.text.words.map((w) => ({ ...w, start: w.start - local, end: w.end - local })).filter((w) => w.end > 0) } : clip.text
  }
  if (first.text?.words) first.text = { ...first.text, words: first.text.words.filter((w) => w.start < local) }
  return mapTracks(project, (tr) => (tr.id === found.track.id ? { ...tr, clips: tr.clips.flatMap((c) => (c.id === clipId ? [first, second] : [c])) } : tr))
}

/** Splits every unlocked clip under time `t`. */
export function splitAt(project: Project, t: number, onlyClipIds?: ReadonlySet<string>): Project {
  let next = project
  for (const track of project.tracks) {
    if (track.locked) continue
    const clip = clipAt(track, t)
    if (clip && (!onlyClipIds || onlyClipIds.has(clip.id))) next = splitClip(next, clip.id, t)
  }
  return next
}

export function removeClips(project: Project, clipIds: ReadonlySet<string>): Project {
  return mapTracks(project, (t) => (t.clips.some((c) => clipIds.has(c.id)) ? { ...t, clips: t.clips.filter((c) => !clipIds.has(c.id)) } : t))
}

function cloneClip(clip: Clip, start: number): Clip {
  return { ...structuredClone(clip), id: newId(), start, effects: clip.effects.map((e) => ({ ...structuredClone(e), id: newId() })) }
}

/** Duplicates clips right after themselves. Returns the new project and the new clip ids. */
export function duplicateClips(project: Project, clipIds: ReadonlySet<string>): { project: Project; ids: string[] } {
  const ids: string[] = []
  let next = project
  for (const id of clipIds) {
    const found = findClip(next, id)
    if (!found) continue
    const copy = cloneClip(found.clip, clipEnd(found.clip))
    ids.push(copy.id)
    next = addClip(next, found.track.id, copy)
  }
  return { project: next, ids }
}

export interface ClipboardEntry {
  clip: Clip
  trackKind: TrackKind
  trackId: string
}

export function copyClips(project: Project, clipIds: ReadonlySet<string>): ClipboardEntry[] {
  return project.tracks.flatMap((t) => t.clips.filter((c) => clipIds.has(c.id)).map((clip) => ({ clip, trackKind: t.kind, trackId: t.id })))
}

/** Pastes copied clips so the earliest one starts at `at`, keeping their relative timing. */
export function pasteClips(project: Project, entries: ClipboardEntry[], at: number): { project: Project; ids: string[] } {
  if (!entries.length) return { project, ids: [] }
  const origin = Math.min(...entries.map((e) => e.clip.start))
  const ids: string[] = []
  let next = project
  for (const entry of entries) {
    const track = next.tracks.find((t) => t.id === entry.trackId && !t.locked) ?? next.tracks.find((t) => t.kind === entry.trackKind && !t.locked)
    if (!track) continue
    const copy = cloneClip(entry.clip, at + entry.clip.start - origin)
    ids.push(copy.id)
    next = addClip(next, track.id, copy)
  }
  return { project: next, ids }
}

/**
 * Removes the time range [from, to) and closes the gap (a ripple delete).
 * Locked tracks, and tracks rejected by `include`, are left exactly as they are.
 */
export function cutRange(project: Project, from: number, to: number, include: (track: Track) => boolean = () => true): Project {
  if (to - from < EPS) return project
  const affected = (t: Track): boolean => !t.locked && include(t)
  let next = project
  for (const time of [from, to]) {
    for (const track of project.tracks) {
      if (!affected(track)) continue
      const clip = clipAt(next.tracks.find((t) => t.id === track.id)!, time)
      if (clip) next = splitClip(next, clip.id, time)
    }
  }
  return mapTracks(next, (t) => {
    if (!affected(t)) return t
    return {
      ...t,
      clips: t.clips
        .filter((c) => !(c.start >= from - EPS && clipEnd(c) <= to + EPS))
        .map((c) => (c.start >= to - EPS ? { ...c, start: c.start - (to - from) } : c))
    }
  })
}

/** Changes playback speed, keeping the same stretch of source material. */
export function setClipSpeed(project: Project, clipId: string, speed: number): Project {
  const found = findClip(project, clipId)
  if (!found) return project
  const { clip, track } = found
  const clamped = Math.min(16, Math.max(0.1, speed))
  const nextStart = Math.min(Infinity, ...track.clips.filter((c) => c.start >= clipEnd(clip) - EPS && c.id !== clipId).map((c) => c.start))
  const wanted = (clip.duration * clip.speed) / clamped
  const duration = Math.min(wanted, nextStart - clip.start)
  const scale = wanted / clip.duration
  const keyframes: Clip['keyframes'] = {}
  for (const [prop, list] of Object.entries(clip.keyframes) as [AnimProp, Keyframe[]][]) keyframes[prop] = list.map((k) => ({ ...k, t: k.t * scale })).filter((k) => k.t <= duration + EPS)
  return mapClip(project, clipId, (c) => ({ ...c, speed: clamped, duration, keyframes }))
}

/**
 * Speed ramp: replaces a clip with `steps` short pieces whose speed moves smoothly
 * from `from` to `to`. The same footage plays; later clips on the track shift to stay adjoined.
 * Pieces are ordinary clips, so the ramp can be adjusted or undone piece by piece.
 */
export type RampShape = 'linear' | 'easeIn' | 'easeOut' | 'smooth' | 'bell'

export const RAMP_SHAPES: { id: RampShape; name: string; at: (u: number) => number }[] = [
  { id: 'linear', name: 'Steady change', at: (u) => u },
  { id: 'easeIn', name: 'Ease in (changes late)', at: (u) => u * u * u },
  { id: 'easeOut', name: 'Ease out (changes early)', at: (u) => 1 - (1 - u) ** 3 },
  { id: 'smooth', name: 'Smooth S-curve', at: (u) => u * u * (3 - 2 * u) },
  { id: 'bell', name: 'Bell (peaks in the middle)', at: (u) => Math.sin(Math.PI * u) ** 2 }
]

/**
 * Freezes the picture at time `t` of a clip for `hold` seconds: the clip is cut there, a still of that
 * exact frame (silent) is put in, and everything after it on the track moves later by the same amount.
 */
export function freezeFrame(project: Project, clipId: string, t: number, hold = 2): Project {
  const found = findClip(project, clipId)
  if (!found || found.clip.speed <= 0) return project
  const { clip, track } = found
  if (t <= clip.start + EPS || t >= clipEnd(clip) - EPS) return project
  const source = sourceTime(clip, t)
  const split = splitClip(project, clipId, t)
  const still: Clip = {
    ...clip,
    id: newId(),
    start: t,
    duration: hold,
    sourceIn: source,
    speed: 1,
    reversed: false,
    freeze: true,
    muted: true,
    fadeIn: 0,
    fadeOut: 0,
    transitionIn: undefined,
    keyframes: {},
    frameBlend: undefined,
    stab: undefined,
    effects: clip.effects.map((e) => ({ ...e, id: newId() }))
  }
  return mapTracks(split, (tr) => (tr.id !== track.id ? tr : { ...tr, clips: [...tr.clips.map((c) => (c.start >= t - EPS ? { ...c, start: c.start + hold } : c)), still] }))
}

export function rampSpeed(project: Project, clipId: string, from: number, to: number, steps = 16, shape: RampShape = 'linear'): Project {
  const found = findClip(project, clipId)
  if (!found || found.clip.reversed || steps < 2) return project
  const { clip, track } = found
  const clampSpeed = (v: number): number => Math.min(16, Math.max(0.1, v))
  const sourceSpan = clip.duration * clip.speed
  const piece = sourceSpan / steps
  const pieces: Clip[] = []
  let start = clip.start
  for (let i = 0; i < steps; i++) {
    const bend = (RAMP_SHAPES.find((s) => s.id === shape) ?? RAMP_SHAPES[0]).at
    const speed = clampSpeed(from + (to - from) * bend(i / (steps - 1)))
    const duration = piece / speed
    pieces.push({
      ...clip,
      id: i === 0 ? clip.id : newId(),
      start,
      duration,
      sourceIn: clip.sourceIn + piece * i,
      speed,
      fadeIn: i === 0 ? Math.min(clip.fadeIn, duration) : 0,
      fadeOut: i === steps - 1 ? Math.min(clip.fadeOut, duration) : 0,
      transitionIn: i === 0 ? clip.transitionIn : undefined,
      keyframes: {},
      effects: clip.effects.map((e) => (i === 0 ? e : { ...e, id: newId() }))
    })
    start += duration
  }
  const shift = start - clipEnd(clip)
  return mapTracks(project, (t) =>
    t.id !== track.id ? t : { ...t, clips: t.clips.flatMap((c) => (c.id === clipId ? pieces : [c.start >= clipEnd(clip) - EPS ? { ...c, start: c.start + shift } : c])) }
  )
}

export function addTrack(project: Project, kind: TrackKind): Project {
  const label = { video: 'Video', audio: 'Audio', text: 'Text' }[kind]
  const track = makeTrack(kind, `${label} ${project.tracks.filter((t) => t.kind === kind).length + 1}`)
  // Picture and text tracks stack on top; audio tracks go below.
  return { ...project, tracks: kind === 'audio' ? [...project.tracks, track] : [track, ...project.tracks] }
}

export function removeTrack(project: Project, trackId: string): Project {
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId) }
}

export function updateTrack(project: Project, trackId: string, patch: Partial<Omit<Track, 'id' | 'kind' | 'clips'>>): Project {
  return mapTracks(project, (t) => (t.id === trackId ? { ...t, ...patch } : t))
}

export function moveTrack(project: Project, trackId: string, toIndex: number): Project {
  const from = project.tracks.findIndex((t) => t.id === trackId)
  if (from < 0) return project
  const tracks = [...project.tracks]
  const [track] = tracks.splice(from, 1)
  tracks.splice(Math.max(0, Math.min(tracks.length, toIndex)), 0, track)
  return { ...project, tracks }
}

/** Returns the candidate closest to `time` if within `threshold`, else `time`. */
export function snapTime(time: number, candidates: number[], threshold: number): number {
  let best = time
  let bestDistance = threshold
  for (const c of candidates) {
    const d = Math.abs(c - time)
    if (d <= bestDistance) {
      best = c
      bestDistance = d
    }
  }
  return best
}

/** Clip edges (and 0) that other clips can snap to. */
export function snapPoints(project: Project, ignore: ReadonlySet<string> = new Set(), marks?: { beats?: boolean; snares?: boolean }): number[] {
  const points = [0, ...project.tracks.flatMap((t) => t.clips.filter((c) => !ignore.has(c.id)).flatMap((c) => [c.start, clipEnd(c)]))]
  if (marks?.beats || marks?.snares) {
    const m = musicMarks(project)
    if (marks.beats) points.push(...m.beats)
    if (marks.snares) points.push(...m.snares)
  }
  return points
}

/** Rounds a time to the nearest frame boundary. */
export function snapToFrame(time: number, fps: number): number {
  return Math.round(time * fps) / fps
}

export interface ActiveClip {
  track: Track
  clip: Clip
  /** 'outgoing' = the previous clip, still drawn underneath while the next one transitions in. */
  role: 'main' | 'outgoing'
  /** Transition progress 0-1 for the pair, when one is running. */
  progress?: number
}

/**
 * Timing curve of a transition: a cubic Bézier from (0,0) to (1,1) whose handles sit at `easeIn` along the start
 * and `1 - easeOut` along the end. Both 0 is a straight line; a transition without either keeps its own curve.
 */
export function shapeTransitionProgress(p: number, tr: { type?: string; easeIn?: number; easeOut?: number }): number {
  const base = tr.type ? transitionEase(tr.type) : undefined
  if (tr.easeIn === undefined && tr.easeOut === undefined && !base) return p
  const a = Math.min(1, Math.max(0, tr.easeIn ?? base?.[0] ?? 0))
  const b = Math.min(1, Math.max(0, tr.easeOut ?? base?.[1] ?? 0))
  return cubicBezier(a, 0, 1 - b, 1, p)
}

/** Every clip that contributes to the frame at time `t`, bottom track first. */
export function activeClips(project: Project, t: number): ActiveClip[] {
  const out: ActiveClip[] = []
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]
    const clip = clipAt(track, t)
    if (!clip) continue
    const tr = clip.transitionIn
    if (tr && tr.duration > 0 && t - clip.start < tr.duration) {
      const progress = shapeTransitionProgress(Math.max(0, Math.min(1, (t - clip.start) / tr.duration)), tr)
      const prev = track.clips.find((c) => c.id !== clip.id && Math.abs(clipEnd(c) - clip.start) < 1e-3)
      if (prev) out.push({ track, clip: prev, role: 'outgoing', progress })
      out.push({ track, clip, role: 'main', progress })
    } else out.push({ track, clip, role: 'main' })
  }
  return out
}
