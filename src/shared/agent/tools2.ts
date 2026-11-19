/** More assistant tools: effects, colour, speed, text, compositing, fades, volume and trimming. All pure project-to-project functions. */
import type { BlendMode, Clip, MediaAsset, Project, TextProps, Track, VizProps } from '../types'
import { EFFECTS, effectSpec, makeEffect } from '../effects/registry'
import { DEFAULT_TEXT, makeClip, newId, textClip, vizClip } from '../timeline/model'
import type { OverlayInfo } from '../overlayCatalog'
import { buildLook, lookById } from '../color/looks'
import { encodeLut } from '../color/cube'
import { fillFrame } from './batch'
import * as ops from '../timeline/ops'
import { ensureTrack } from './tools'
import { audioEffectSpec, makeAudioEffect } from '../effects/audio'
import { TEXT_LOOKS } from './lexicon'

const isPictureClip = (project: Project, c: Clip): boolean => {
  if (c.text || c.shape) return true
  const kind = project.media.find((m) => m.id === c.assetId)?.kind
  return kind === 'video' || kind === 'image'
}

/** Clips a request applies to: the ones the user selected, otherwise every picture clip on the timeline. */
export function targetClips(project: Project, selection: readonly string[] = [], onlyMedia = false): Clip[] {
  const sel = new Set(selection)
  const all = project.tracks.filter((t) => t.kind !== 'audio').flatMap((t) => t.clips).filter((c) => isPictureClip(project, c) && (!onlyMedia || (!c.text && !c.shape)))
  const picked = all.filter((c) => sel.has(c.id))
  return picked.length ? picked : all
}

const mapClips = (project: Project, ids: Set<string>, fn: (c: Clip) => Clip): Project => ({ ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (ids.has(c.id) ? fn(c) : c)) })) })
const idsOf = (clips: Clip[]): Set<string> => new Set(clips.map((c) => c.id))

export interface Outcome { project: Project; count: number }

export function addEffectTo(project: Project, type: string, params: Record<string, number>, selection: readonly string[] = []): Outcome {
  if (!effectSpec(type)) return { project, count: 0 }
  const targets = targetClips(project, selection)
  return { project: mapClips(project, idsOf(targets), (c) => ({ ...c, effects: [...c.effects, makeEffect(type, params)] })), count: targets.length }
}

export function addStackTo(project: Project, effects: { type: string; params: Record<string, number> }[], selection: readonly string[] = []): Outcome {
  const targets = targetClips(project, selection)
  return { project: mapClips(project, idsOf(targets), (c) => ({ ...c, effects: [...c.effects, ...effects.map((e) => makeEffect(e.type, e.params))] })), count: targets.length }
}

export function clearEffects(project: Project, selection: readonly string[] = []): Outcome {
  const targets = targetClips(project, selection).filter((c) => c.effects.some((e) => e.origin !== 'style'))
  return { project: mapClips(project, idsOf(targets), (c) => ({ ...c, effects: c.effects.filter((e) => e.origin === 'style') })), count: targets.length }
}

/** Nudges the colour-adjust effect of each target (adding one if needed), keeping every value inside its range. */
export function adjustColor(project: Project, delta: Record<string, number>, selection: readonly string[] = []): Outcome {
  const spec = effectSpec('color')!
  const clamp = (key: string, v: number): number => {
    const p = spec.params.find((x) => x.key === key)!
    return Math.max(p.min, Math.min(p.max, Math.round(v * 1000) / 1000))
  }
  const targets = targetClips(project, selection)
  return {
    project: mapClips(project, idsOf(targets), (c) => {
      const existing = c.effects.find((e) => e.type === 'color' && e.origin !== 'style')
      const base = existing ?? makeEffect('color')
      const next = { ...base, params: { ...base.params, ...Object.fromEntries(Object.entries(delta).filter(([k]) => spec.params.some((p) => p.key === k)).map(([k, v]) => [k, clamp(k, (base.params[k] ?? 0) + v)])) } }
      return { ...c, effects: existing ? c.effects.map((e) => (e === existing ? next : e)) : [...c.effects, next] }
    }),
    count: targets.length
  }
}

export function setSpeed(project: Project, speed: number, selection: readonly string[] = []): Outcome {
  const targets = targetClips(project, selection, true).filter((c) => !c.freeze)
  let next = project
  for (const c of targets) next = ops.setClipSpeed(next, c.id, speed)
  return { project: next, count: targets.length }
}

export function reverseClips(project: Project, selection: readonly string[] = []): Outcome {
  const targets = targetClips(project, selection, true)
  return { project: mapClips(project, idsOf(targets), (c) => ({ ...c, reversed: !c.reversed })), count: targets.length }
}

/** Ramps the first target clip's speed, or the longest one when nothing is selected. */
export function speedRamp(project: Project, from: number, to: number, shape: ops.RampShape, selection: readonly string[] = []): Outcome {
  const targets = targetClips(project, selection, true).filter((c) => !c.reversed && !c.freeze)
  const clip = selection.length ? targets[0] : [...targets].sort((a, b) => b.duration - a.duration)[0]
  return clip ? { project: ops.rampSpeed(project, clip.id, from, to, 16, shape), count: 1 } : { project, count: 0 }
}

export function freezeAt(project: Project, at: number | undefined, hold: number, selection: readonly string[] = []): Outcome {
  const targets = targetClips(project, selection, true).filter((c) => !c.freeze)
  const clip = at === undefined ? targets[0] : targets.find((c) => at > c.start && at < c.start + c.duration)
  if (!clip) return { project, count: 0 }
  const t = at ?? clip.start + clip.duration / 2
  const next = ops.freezeFrame(project, clip.id, t, hold)
  return { project: next, count: next === project ? 0 : 1 }
}

export function fadeEnds(project: Project, where: 'in' | 'out' | 'both', seconds: number): Outcome {
  const track = project.tracks.filter((t) => t.kind === 'video').sort((a, b) => b.clips.length - a.clips.length)[0]
  if (!track?.clips.length) return { project, count: 0 }
  const clips = [...track.clips].sort((a, b) => a.start - b.start)
  const [first, last] = [clips[0], clips[clips.length - 1]]
  let count = 0
  const next = mapClips(project, new Set([first.id, last.id]), (c) => {
    const patch: Partial<Clip> = {}
    if (c.id === first.id && where !== 'out') { patch.fadeIn = Math.min(seconds, c.duration); count++ }
    if (c.id === last.id && where !== 'in') { patch.fadeOut = Math.min(seconds, c.duration); count++ }
    return { ...c, ...patch }
  })
  return { project: next, count }
}

export function setVolume(project: Project, who: 'music' | 'video' | 'all', level: number): Outcome {
  let count = 0
  const next: Project = {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        const asset = project.media.find((m) => m.id === c.assetId)
        if (!asset || !(asset.hasAudio || asset.kind === 'audio') || asset.builtinSfx) return c
        const isMusic = t.kind === 'audio' && !asset.analysis?.transcript?.length
        if ((who === 'music' && !isMusic) || (who === 'video' && asset.kind !== 'video')) return c
        count++
        return { ...c, volume: Math.max(0, Math.min(2, level)), keyframes: { ...c.keyframes, volume: undefined } }
      })
    }))
  }
  return { project: count ? next : project, count }
}

/** Shortens the whole timeline to `seconds` by removing everything after it. */
export function trimTo(project: Project, seconds: number): Outcome {
  const end = ops.projectDuration(project)
  if (seconds <= 0 || seconds >= end - 1e-3) return { project, count: 0 }
  return { project: ops.cutRange(project, seconds, end + 1), count: 1 }
}

/** Closes every gap on every unlocked track by sliding clips left. */
export function closeGaps(project: Project): Outcome {
  let count = 0
  const tracks = project.tracks.map((t) => {
    if (t.locked || t.kind === 'audio') return t
    let cursor = 0
    const clips = [...t.clips].sort((a, b) => a.start - b.start).map((c) => {
      if (c.start > cursor + 1e-3) count++
      const moved = c.start > cursor + 1e-3 ? { ...c, start: cursor } : c
      cursor = moved.start + moved.duration
      return moved
    })
    return { ...t, clips }
  })
  return { project: count ? { ...project, tracks } : project, count }
}

/** Adds a sound effect to clips that have sound: the selection, else music / speech / everything as asked. */
export function addAudioEffectTo(project: Project, type: string, params: Record<string, number>, who: 'music' | 'video' | 'all', selection: readonly string[] = []): Outcome {
  if (!audioEffectSpec(type)) return { project, count: 0 }
  const sel = new Set(selection)
  let count = 0
  const next: Project = {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        const asset = project.media.find((m) => m.id === c.assetId)
        if (!asset || !(asset.hasAudio || asset.kind === 'audio') || asset.builtinSfx || c.muted || c.freeze) return c
        if (sel.size) { if (!sel.has(c.id)) return c } else if ((who === 'music' && t.kind !== 'audio') || (who === 'video' && asset.kind !== 'video')) return c
        count++
        return { ...c, audioFx: [...(c.audioFx ?? []), makeAudioEffect(type, params)] }
      })
    }))
  }
  return { project: count ? next : project, count }
}

/** Adds an audio visualiser layer over the length of the longest sound on the timeline. */
export function addVisualizer(project: Project, style: VizProps['style'], color?: string): Outcome {
  const sounds = project.tracks.flatMap((t) => t.clips).filter((c) => project.media.find((m) => m.id === c.assetId)?.kind === 'audio')
  const longest = [...sounds].sort((a, b) => b.duration - a.duration)[0]
  const start = longest?.start ?? 0
  const duration = longest?.duration ?? Math.max(1, ops.projectDuration(project) || 10)
  const ensured = ensureTrack(project, 'video', 'Visualizer', 'top')
  const clip = vizClip(start, { style, ...(color ? { color } : {}) }, duration)
  return { project: ops.addClip(ensured.project, ensured.track.id, clip), count: 1 }
}

export type Placement = 'top' | 'center' | 'bottom'

export function addTextOverlay(project: Project, opts: { content: string; look?: string; animation?: string; font?: string; place?: Placement; start?: number; duration?: number; color?: string }): Outcome {
  const base: Partial<TextProps> = { ...(opts.look ? TEXT_LOOKS[opts.look]?.look : {}), ...(opts.animation ? { animation: opts.animation } : {}), ...(opts.font ? { fontFamily: opts.font } : {}), ...(opts.color ? { color: opts.color } : {}) }
  const end = ops.projectDuration(project)
  const duration = Math.max(0.5, Math.min(opts.duration ?? 3, Math.max(0.5, end || 3)))
  const start = Math.max(0, Math.min(opts.start ?? 0.3, Math.max(0, end - duration)))
  const y = { top: -0.34, center: 0, bottom: 0.32 }[opts.place ?? (opts.look === 'lowerThird' ? 'bottom' : 'center')]
  const ensured = ensureTrack(project, 'text', 'Text', 'top')
  const clip = textClip(start, { ...DEFAULT_TEXT, ...base, content: opts.content }, duration)
  const placed = { ...clip, transform: { ...clip.transform, y } }
  return { project: { ...ensured.project, tracks: ensured.project.tracks.map((t: Track) => (t.id === ensured.track.id ? { ...t, clips: [...t.clips, placed] } : t)) }, count: 1 }
}

export function makePipClips(project: Project, corner: 'tl' | 'tr' | 'bl' | 'br', selection: readonly string[] = []): Outcome {
  // With no selection, the top-most video clip becomes the picture-in-picture.
  const picks = selection.length ? targetClips(project, selection, true) : (() => {
    const top = project.tracks.filter((t) => t.kind === 'video').find((t) => t.clips.some((c) => !c.text && !c.shape))
    return top ? top.clips.filter((c) => !c.text && !c.shape) : []
  })()
  const sx = corner === 'tl' || corner === 'bl' ? -1 : 1
  const sy = corner === 'tl' || corner === 'tr' ? -1 : 1
  return {
    project: mapClips(project, idsOf(picks), (c) => ({ ...c, transform: { ...c.transform, scale: 0.34, x: sx * 0.31, y: sy * 0.3 }, effects: [...c.effects.filter((e) => e.type !== 'roundedCorners' && e.type !== 'dropShadow'), makeEffect('roundedCorners'), makeEffect('dropShadow')] })),
    count: picks.length
  }
}

export function setBlendMode(project: Project, mode: BlendMode, selection: readonly string[] = []): Outcome {
  const targets = targetClips(project, selection)
  return { project: mapClips(project, idsOf(targets), (c) => ({ ...c, blend: mode === 'normal' ? undefined : mode, ...(mode === 'screen' ? { opacity: Math.min(c.opacity, 0.7) } : {}) })), count: targets.length }
}

/** Slow push-in or drift on every still image, alternating directions so a slideshow does not feel mechanical. */
export function kenBurnsOnImages(project: Project): Outcome {
  let n = 0
  const next: Project = {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        const asset = project.media.find((m) => m.id === c.assetId)
        if (asset?.kind !== 'image' || c.effects.some((e) => e.type === 'kenBurns')) return c
        const dir = n++ % 2 ? -1 : 1
        return { ...c, effects: [...c.effects, makeEffect('kenBurns', { startZoom: 1, endZoom: 1.22, startX: -0.04 * dir, endX: 0.04 * dir, startY: 0.02, endY: -0.02 })] }
      })
    }))
  }
  return { project: n ? next : project, count: n }
}

export function setProjectFps(project: Project, fps: number): Outcome {
  const clean = Math.max(1, Math.min(1000, Math.round(fps)))
  return clean === project.settings.fps ? { project, count: 0 } : { project: { ...project, settings: { ...project.settings, fps: clean } }, count: 1 }
}

export { EFFECTS, newId }

// ---------------------------------------------------------------- overlays and colour looks from the library

/** Puts an overlay clip (light leak, grain, flash...) on its own track above the picture, scaled to fill the frame. With `cover` it repeats from `at` to the end of the timeline. */
export function addOverlay(project: Project, asset: MediaAsset, info: OverlayInfo, at: number, cover: boolean): { project: Project; count: number } {
  const end = ops.projectDuration(project)
  if (end <= 0 && !cover && at < 0) return { project, count: 0 }
  const ensured = ensureTrack(project, 'video', 'Overlays', 'aboveVideo')
  let next = ensured.project
  const ids: string[] = []
  const stop = cover ? Math.max(end, at + asset.duration) : at + asset.duration
  for (let t = at; t < stop - 0.05 && ids.length < 400; t += asset.duration) {
    const clip = { ...makeClip({ assetId: asset.id, start: t, duration: Math.min(asset.duration, stop - t) }), blend: info.blend, opacity: info.opacity, origin: 'style' as const }
    next = ops.addClip(next, ensured.track.id, clip)
    ids.push(clip.id)
  }
  return { project: fillFrame(next, ids).project, count: ids.length }
}

/** Gives picture clips a built-in colour look (a lookup table made from a formula) with an intensity. Replaces a look applied earlier. */
export function applyLook(project: Project, lookId: string, intensity: number, selection: readonly string[] = []): Outcome {
  const look = lookById(lookId)
  const table = buildLook(lookId)
  if (!look || !table) return { project, count: 0 }
  const targets = targetClips(project, selection, true)
  if (!targets.length) return { project, count: 0 }
  const lutId = `look-${lookId}`
  const luts = project.luts?.some((l) => l.id === lutId) ? project.luts : [...(project.luts ?? []), { id: lutId, name: look.name, size: table.size, data: encodeLut(table) }]
  const amount = Math.min(1, Math.max(0, intensity))
  const ids = new Set(targets.map((c) => c.id))
  const next: Project = {
    ...project,
    luts,
    tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (ids.has(c.id) ? { ...c, effects: [...c.effects.filter((e) => !(e.type === 'lut' && e.ref?.startsWith('look-'))), { ...makeEffect('lut', { amount }), ref: lutId }] } : c)) }))
  }
  return { project: next, count: targets.length }
}

/** Removes any built-in look from the picture clips. */
export function removeLooks(project: Project, selection: readonly string[] = []): Outcome {
  const targets = targetClips(project, selection, true).filter((c) => c.effects.some((e) => e.type === 'lut' && e.ref?.startsWith('look-')))
  const ids = new Set(targets.map((c) => c.id))
  return { project: { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (ids.has(c.id) ? { ...c, effects: c.effects.filter((e) => !(e.type === 'lut' && e.ref?.startsWith('look-'))) } : c)) })) }, count: targets.length }
}
