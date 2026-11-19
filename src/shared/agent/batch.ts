/** Batch editing tools: do the same thing to every clip ("cut all clips to 7 seconds", "sort by length", "render each clip"). */
import type { Clip, ExportSettings, Project, Track } from '../types'
import { EXPORT_PRESETS, type ExportPreset } from '../render/presets'
import { newId } from '../timeline/model'
import * as ops from '../timeline/ops'
import { fitFractions } from '../timeline/motion'

const EPS = 1e-4

export interface Outcome { project: Project; count: number }

const isMedia = (project: Project, c: Clip): boolean => {
  const kind = project.media.find((m) => m.id === c.assetId)?.kind
  return kind === 'video' || kind === 'image'
}
const kindOf = (project: Project, c: Clip): string | undefined => project.media.find((m) => m.id === c.assetId)?.kind

/** The clips a batch request touches: the selection if there is one, otherwise every picture clip (plus sound clips when asked). */
export function batchTargets(project: Project, selection: readonly string[] = [], includeAudio = false): Clip[] {
  const sel = new Set(selection)
  const all = project.tracks.filter((t) => !t.locked).flatMap((t) => t.clips).filter((c) => isMedia(project, c) || (includeAudio && kindOf(project, c) === 'audio'))
  const picked = all.filter((c) => sel.has(c.id))
  return picked.length ? picked : all
}

export type KeepPart = 'start' | 'end' | 'middle'

/**
 * Shortens every target clip that is longer than `seconds` to exactly that length, keeping its start, end or middle.
 * With `extendPhotos`, still images are set to `seconds` whatever their length. Later clips on the same track slide left to keep the track closed up.
 */
export function trimClips(project: Project, seconds: number, keep: KeepPart, selection: readonly string[] = [], includeAudio = false, extendPhotos = false): Outcome {
  if (!(seconds > 0.05)) return { project, count: 0 }
  const targets = new Map(batchTargets(project, selection, includeAudio).map((c) => [c.id, c]))
  let count = 0
  const tracks: Track[] = project.tracks.map((t) => {
    if (!t.clips.some((c) => targets.has(c.id))) return t
    let shift = 0
    const clips = [...t.clips].sort((a, b) => a.start - b.start).map((c): Clip => {
      const moved = { ...c, start: c.start - shift }
      if (!targets.has(c.id)) return moved
      const isPhoto = kindOf(project, c) === 'image'
      let length = c.duration
      if (c.duration > seconds + EPS) length = seconds
      else if (extendPhotos && isPhoto && Math.abs(c.duration - seconds) > EPS) length = seconds
      if (Math.abs(length - c.duration) < EPS) return moved
      count++
      shift += c.duration - length
      const cut = (c.duration - length) * c.speed
      // Which part of the source stays: for a reversed clip the timeline start is the end of its source range.
      let sourceIn = c.sourceIn
      if (!isPhoto && length < c.duration) {
        const dropFromStart = keep === 'start' ? 0 : keep === 'end' ? cut : cut / 2
        sourceIn = c.reversed ? c.sourceIn + (cut - dropFromStart) : c.sourceIn + dropFromStart
      }
      return { ...moved, duration: length, sourceIn, fadeOut: Math.min(c.fadeOut, length), fadeIn: Math.min(c.fadeIn, length), keyframes: Object.fromEntries(Object.entries(c.keyframes).map(([k, list]) => [k, (list ?? []).filter((kf) => kf.t <= length + EPS)])) as Clip['keyframes'] }
    })
    return { ...t, clips }
  })
  return { project: count ? { ...project, tracks } : project, count }
}

/** Cuts every target clip into pieces of `seconds` (the last piece takes what is left; slivers under a quarter second are not cut off). */
export function splitEvery(project: Project, seconds: number, selection: readonly string[] = []): Outcome {
  if (!(seconds >= 0.25)) return { project, count: 0 }
  let next = project
  let count = 0
  for (const c of batchTargets(project, selection)) {
    let id = c.id
    for (let t = c.start + seconds; t < c.start + c.duration - 0.25; t += seconds) {
      const split = ops.splitClip(next, id, t)
      if (split === next) break
      const track = split.tracks.find((tr) => tr.clips.some((x) => x.id === id))!
      const following = track.clips.find((x) => x.id !== id && Math.abs(x.start - t) < 1e-3)
      if (!following) break
      next = split
      id = following.id
      count++
    }
  }
  return { project: next, count }
}

/** Deletes clips shorter than `seconds` and closes the gaps. */
export function removeShortClips(project: Project, seconds: number, selection: readonly string[] = []): Outcome {
  const short = new Set(batchTargets(project, selection, true).filter((c) => c.duration < seconds - EPS).map((c) => c.id))
  if (!short.size) return { project, count: 0 }
  const removed = ops.removeClips(project, short)
  const tracks = removed.tracks.map((t, i) => {
    const before = project.tracks[i]
    if (before.clips.length === t.clips.length) return t
    let cursor = 0
    const clips = [...t.clips].sort((a, b) => a.start - b.start).map((c) => {
      const gapBefore = before.clips.filter((x) => short.has(x.id) && x.start < c.start).reduce((a, x) => a + x.duration, 0)
      return { ...c, start: Math.max(cursor, c.start - gapBefore) }
    }).map((c) => { cursor = c.start + c.duration; return c })
    return { ...t, clips }
  })
  return { project: { ...removed, tracks }, count: short.size }
}

export type SortBy = 'length' | 'longest' | 'name' | 'shuffle'

/** Re-orders the clips of the main video track back to back, from time zero. */
export function sortClips(project: Project, by: SortBy, seed = 1): Outcome {
  const track = project.tracks.filter((t) => t.kind === 'video').sort((a, b) => b.clips.length - a.clips.length)[0]
  if (!track || track.clips.length < 2) return { project, count: 0 }
  const nameOf = (c: Clip): string => project.media.find((m) => m.id === c.assetId)?.name.toLowerCase() ?? ''
  const list = [...track.clips].sort((a, b) => a.start - b.start)
  if (by === 'length') list.sort((a, b) => a.duration - b.duration)
  else if (by === 'longest') list.sort((a, b) => b.duration - a.duration)
  else if (by === 'name') list.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }))
  else {
    let s = seed
    const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]] }
  }
  let cursor = Math.min(...track.clips.map((c) => c.start))
  const placed = list.map((c) => { const out = { ...c, start: cursor, transitionIn: undefined }; cursor += c.duration; return out })
  return { project: { ...project, tracks: project.tracks.map((t) => (t.id === track.id ? { ...t, clips: placed } : t)) }, count: placed.length }
}

/** A fade at the start and end of every target clip. */
export function fadeEach(project: Project, seconds: number, selection: readonly string[] = []): Outcome {
  const ids = new Set(batchTargets(project, selection, true).map((c) => c.id))
  let count = 0
  return { project: { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (ids.has(c.id) ? (count++, { ...c, fadeIn: Math.min(seconds, c.duration / 2), fadeOut: Math.min(seconds, c.duration / 2) }) : c)) })) }, count }
}

/** Scales every picture clip until it covers the whole frame (no bars), centred. */
export function fillFrame(project: Project, selection: readonly string[] = []): Outcome {
  let count = 0
  const ids = new Set(batchTargets(project, selection).map((c) => c.id))
  const tracks = project.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) => {
      const asset = project.media.find((m) => m.id === c.assetId)
      if (!ids.has(c.id) || !asset?.width || !asset.height) return c
      const { fw, fh } = fitFractions({ projectW: project.settings.width, projectH: project.settings.height, assetW: asset.width, assetH: asset.height })
      const scale = Math.max(1 / fw, 1 / fh)
      if (Math.abs(scale - c.transform.scale) < 1e-3) return c
      count++
      return { ...c, transform: { ...c.transform, scale, x: 0, y: 0 } }
    })
  }))
  return { project: count ? { ...project, tracks } : project, count }
}

export type RemovableKind = 'text' | 'captions' | 'shapes' | 'layers' | 'transitions' | 'visualizers' | 'audio'

/** Deletes every clip of one kind (or every transition). */
export function removeKind(project: Project, kind: RemovableKind): Outcome {
  let count = 0
  if (kind === 'transitions') {
    return { project: { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.transitionIn ? (count++, { ...c, transitionIn: undefined }) : c)) })) }, count }
  }
  const matches = (c: Clip): boolean =>
    kind === 'text' ? Boolean(c.text) && c.origin !== 'caption' : kind === 'captions' ? c.origin === 'caption' : kind === 'shapes' ? Boolean(c.shape) : kind === 'visualizers' ? Boolean(c.viz) : kind === 'layers' ? !c.text && !c.shape && !c.viz && !c.assetId : kindOf(project, c) === 'audio'
  const ids = new Set(project.tracks.filter((t) => !t.locked).flatMap((t) => t.clips).filter(matches).map((c) => c.id))
  count = ids.size
  return { project: count ? ops.removeClips(project, ids) : project, count }
}

// ---------------------------------------------------------------- rendering each clip, or the project, to a chosen configuration

export interface RenderSpec {
  presetId?: string
  /** Short side in pixels ("1080p" = 1080). */
  short?: number
  fps?: number
  codec?: ExportSettings['codec']
  crf?: number
}

const QUALITY_WORDS: [RegExp, number][] = [[/\b(highest|best|lossless-ish|master)\b/, 14], [/\bhigh quality\b/, 18], [/\b(medium|balanced)\b/, 23], [/\b(small file|smallest|low quality|compressed)\b/, 29]]
const PRESET_WORDS: [RegExp, string][] = [
  [/\b(tiktok|reels?|shorts?)\b/, 'tiktok'], [/\binstagram (square)\b|\bsquare\b/, 'instagram-square'], [/\binstagram (portrait|4:5)\b|\b4:5\b/, 'instagram-portrait'], [/\byoutube (4k|uhd)\b/, 'youtube-4k'], [/\byoutube\b/, 'youtube-1080'],
  [/\b(twitter|x\.com|tweet)\b/, 'x'], [/\b(discord|chat|small file|whatsapp|telegram)\b/, 'discord'], [/\b(quick|preview|draft)\b/, 'web-480'], [/\b(archive|master)\b/, 'master']
]

/** Reads "1080p 60fps h265", "4k", "for youtube", "small file" and the like out of a request. */
export function parseRenderSpec(text: string): RenderSpec {
  const t = text.toLowerCase()
  const spec: RenderSpec = {}
  for (const [re, id] of PRESET_WORDS) if (re.test(t)) { spec.presetId = id; break }
  const res = /\b(144|240|360|480|540|720|1080|1440|2160)\s*p\b|\b(4k|uhd|2k|full ?hd|hd)\b/.exec(t)
  if (res) spec.short = res[1] ? Number(res[1]) : ({ '4k': 2160, uhd: 2160, '2k': 1440, fullhd: 1080, 'full hd': 1080, hd: 720 } as Record<string, number>)[res[2]]
  const fps = /\b(\d{2,3})\s*fps\b|\b(\d{2,3})\s*frames per second\b|\b1080p(\d{2,3})\b/.exec(t)
  if (fps) spec.fps = Number(fps[1] ?? fps[2] ?? fps[3])
  if (/\b(h\.?265|hevc)\b/.test(t)) spec.codec = 'h265'
  else if (/\b(h\.?264|avc|mp4)\b/.test(t)) spec.codec = 'h264'
  for (const [re, crf] of QUALITY_WORDS) if (re.test(t)) { spec.crf = crf; break }
  return spec
}

const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2)

/** Export settings from a spec, a base (current settings) and the project's shape. A preset gives the starting point; explicit words override it. */
export function specToSettings(spec: RenderSpec, project: { width: number; height: number; fps: number }, base: ExportSettings): ExportSettings {
  const preset: ExportPreset | undefined = EXPORT_PRESETS.find((p) => p.id === spec.presetId)
  const aspect = preset?.aspect ?? project.width / project.height
  const short = spec.short ?? preset?.short ?? Math.min(project.width, project.height)
  const [width, height] = aspect >= 1 ? [even(short * aspect), even(short)] : [even(short), even(short / aspect)]
  return {
    ...base,
    width,
    height,
    fps: spec.fps ?? (preset?.maxFps ? Math.min(project.fps, preset.maxFps) : project.fps),
    codec: spec.codec ?? preset?.codec ?? base.codec,
    crf: spec.crf ?? preset?.crf ?? base.crf,
    videoBitrateKbps: undefined,
    audioBitrateKbps: preset?.audioKbps ?? base.audioBitrateKbps,
    normalizeAudio: preset?.normalize ?? base.normalizeAudio
  }
}

export function describeSpec(spec: RenderSpec): string {
  const preset = EXPORT_PRESETS.find((p) => p.id === spec.presetId)
  return [preset?.name, spec.short ? `${spec.short}p` : '', spec.fps ? `${spec.fps} fps` : '', spec.codec === 'h265' ? 'H.265' : spec.codec === 'h264' ? 'H.264' : '', spec.crf ? (spec.crf <= 16 ? 'highest quality' : spec.crf >= 28 ? 'small file' : 'quality ' + spec.crf) : ''].filter(Boolean).join(', ') || 'the current settings'
}

/** A project holding only one clip (moved to time zero, with no transition), ready to be rendered on its own. Sound comes with it. */
export function singleClipProject(project: Project, clipId: string): Project | null {
  const found = ops.findClip(project, clipId)
  if (!found) return null
  const clip: Clip = { ...found.clip, start: 0, transitionIn: undefined }
  const track = { ...found.track, clips: [clip] }
  const asset = project.media.find((m) => m.id === clip.assetId)
  return { ...project, id: newId(), name: asset?.name ?? project.name, tracks: [track], media: project.media.filter((m) => m.id === clip.assetId) }
}

/** File name stem for the nth clip: "03 - clipname". */
export function clipStem(project: Project, clip: Clip, index: number, total: number): string {
  const name = (project.media.find((m) => m.id === clip.assetId)?.name ?? 'clip').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '').trim() || 'clip'
  return `${String(index + 1).padStart(String(total).length, '0')} - ${name}`
}
