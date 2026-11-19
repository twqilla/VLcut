/**
 * High-level editing tools. Each takes a project and returns a new one, built
 * from the same timeline operations a person uses, so every result is ordinary,
 * editable timeline content. Editing styles and the AI assistant both call these.
 */
import type { Clip, Keyframe, MediaAsset, Project, TextProps, TimeRange, Track, Word } from '../types'
import { DEFAULT_TEXT, makeClip, makeTrack, newId, textClip } from '../timeline/model'
import * as ops from '../timeline/ops'
import { makeEffect } from '../effects/registry'
import { bestShots } from '../analysis/shots'
import type { StyleDef } from '../styles/styles'
import { musicMarks, toTimeline } from '../timeline/marks'

const EPS = 1e-4

// ---------- helpers ----------

const assetOf = (project: Project, clip: Clip): MediaAsset | undefined => project.media.find((m) => m.id === clip.assetId)
const sorted = (track: Track): Clip[] => [...track.clips].sort((a, b) => a.start - b.start)
const isPicture = (project: Project, clip: Clip): boolean => {
  const kind = assetOf(project, clip)?.kind
  return kind === 'video' || kind === 'image'
}

/** The track that carries the main footage: the video track with the most picture time. */
export function mainTrack(project: Project): Track | undefined {
  const score = (t: Track): number => t.clips.filter((c) => isPicture(project, c)).reduce((a, c) => a + c.duration, 0)
  return project.tracks.filter((t) => t.kind === 'video').sort((a, b) => score(b) - score(a))[0]
}

export { toTimeline }

/** Maps source ranges onto the timeline, clipped to what the clip shows. */
export function rangesToTimeline(clip: Clip, ranges: TimeRange[]): TimeRange[] {
  const lo = clip.sourceIn
  const hi = clip.sourceIn + clip.duration * clip.speed
  const out: TimeRange[] = []
  for (const r of ranges) {
    const [s, e] = [Math.max(lo, r.start), Math.min(hi, r.end)]
    if (e - s < EPS) continue
    const [a, b] = [toTimeline(clip, s)!, toTimeline(clip, e)!]
    out.push({ start: Math.min(a, b), end: Math.max(a, b) })
  }
  return out.sort((a, b) => a.start - b.start)
}

function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const out: TimeRange[] = []
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

function subtractRanges(from: TimeRange[], remove: TimeRange[]): TimeRange[] {
  let out = from
  for (const r of remove) out = out.flatMap((f) => (r.end <= f.start || r.start >= f.end ? [f] : [{ start: f.start, end: r.start }, { start: r.end, end: f.end }].filter((x) => x.end - x.start > EPS)))
  return out
}

/** Timeline times of musical beats, taken from the longest music clip on an audio track. */
export function timelineBeats(project: Project): number[] {
  let best: number[] = []
  for (const track of project.tracks) {
    if (track.kind !== 'audio') continue
    for (const clip of track.clips) {
      const beats = assetOf(project, clip)?.analysis?.beats ?? []
      const mapped = beats.map((b) => toTimeline(clip, b)).filter((t): t is number => t !== null)
      if (mapped.length > best.length) best = mapped.sort((a, b) => a - b)
    }
  }
  return best
}

// ---------- silence removal ----------

export interface SilenceOptions {
  /** Only pauses at least this long are cut. */
  minSilence: number
  /** Breathing room left on each side of a cut. */
  padding: number
}

/** Timeline ranges where the spoken footage is silent. */
export function silentRanges(project: Project, options: SilenceOptions): TimeRange[] {
  const silent: TimeRange[] = []
  const loud: TimeRange[] = []
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.muted) continue
    for (const clip of track.clips) {
      const asset = assetOf(project, clip)
      if (!asset?.hasAudio || !asset.analysis || clip.volume <= 0) continue
      const mine = rangesToTimeline(clip, asset.analysis.silences)
      silent.push(...mine)
      loud.push(...subtractRanges([{ start: clip.start, end: ops.clipEnd(clip) }], mine))
    }
  }
  return subtractRanges(mergeRanges(silent), mergeRanges(loud))
    .map((r) => ({ start: r.start + options.padding, end: r.end - options.padding }))
    .filter((r) => r.end - r.start >= options.minSilence)
}

export function removeSilences(project: Project, options: SilenceOptions = { minSilence: 0.45, padding: 0.12 }): { project: Project; removed: number; cuts: number } {
  const ranges = silentRanges(project, options)
  let next = project
  // Music and sound-effect tracks keep playing straight through; only picture and text close up.
  for (const r of [...ranges].reverse()) next = ops.cutRange(next, r.start, r.end, (t) => t.kind !== 'audio')
  return { project: next, removed: ranges.reduce((a, r) => a + r.end - r.start, 0), cuts: ranges.length }
}

// ---------- montage ----------

export interface MontageOptions {
  duration: number
  shotLength: number
  /** Beats per shot when music with a detected tempo is on the timeline. */
  beatsPerShot?: number
}

/** Replaces the main track with a sequence cut from the best-rated shots in the library. */
export function buildMontage(project: Project, options: MontageOptions): { project: Project; shots: number } {
  const track = mainTrack(project)
  const ranked = bestShots(project)
  if (!track || !ranked.length) return { project, shots: 0 }

  const beats = timelineBeats(project)
  const interval = beats.length > 2 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0
  const shotLength = interval > 0 && options.beatsPerShot ? Math.max(interval, interval * options.beatsPerShot) : options.shotLength
  const wanted = Math.max(1, Math.round(options.duration / shotLength))

  // Take the best shots, then play them in shooting order so the result still tells the story.
  const order = new Map(project.media.map((m, i) => [m.id, i]))
  const picked = ranked.slice(0, wanted).sort((a, b) => order.get(a.asset.id)! - order.get(b.asset.id)! || a.shot.start - b.shot.start)

  let cursor = interval > 0 && beats[0] < interval ? beats[0] % interval : 0
  const clips: Clip[] = []
  for (const { asset, shot } of picked) {
    const available = shot.end - shot.start
    const length = Math.min(shotLength, available)
    // Cut from the middle of the shot, where framing has usually settled.
    const sourceIn = shot.start + (available - length) / 2
    clips.push(makeClip({ assetId: asset.id, start: cursor, duration: length, sourceIn }))
    cursor += length
  }
  const tracks = project.tracks.map((t) => (t.id === track.id ? { ...t, clips } : t))
  return { project: { ...project, tracks }, shots: clips.length }
}

// ---------- cutting to the music ----------

export interface AutoCutOptions {
  /** Cut on every beat, every 2nd, every 4th... or on each snare hit. */
  on: 'beats' | 'snares'
  every?: number
  /** Alternate a slight punch-in on neighbouring pieces so each cut is visible, as in beat edits. */
  punch?: boolean
}

/**
 * Cuts the footage on the main track at the beats (or snare hits) of the music.
 * Where there is only one long clip, this chops it into pieces that change on the beat.
 */
export function autoCutToBeat(project: Project, options: AutoCutOptions): { project: Project; cuts: number } {
  const marks = musicMarks(project)
  const every = Math.max(1, Math.round(options.every ?? 1))
  const times = options.on === 'snares' ? marks.snares : marks.beats.filter((_, i) => i % every === 0)
  const track = mainTrack(project)
  if (!track || !times.length) return { project, cuts: 0 }
  let next = project
  let cuts = 0
  for (const t of times) {
    const live = next.tracks.find((x) => x.id === track.id)!
    const clip = live.clips.find((c) => t > c.start + MIN_PIECE && t < ops.clipEnd(c) - MIN_PIECE)
    if (!clip) continue
    const split = ops.splitClip(next, clip.id, t)
    if (split !== next) {
      next = split
      cuts++
    }
  }
  if (cuts && options.punch !== false) {
    const pieces = sorted(next.tracks.find((x) => x.id === track.id)!).filter((c) => !c.keyframes.scale?.length && c.transform.scale === 1 && isPicture(next, c))
    pieces.forEach((c, i) => {
      if (i % 2 === 1) next = ops.updateClip(next, c.id, { transform: { ...c.transform, scale: 1.14 } })
    })
  }
  return { project: next, cuts }
}

const MIN_PIECE = 0.15

// ---------- audio removal ----------

/** Does this clip carry sound of its own (a clip of a video file that has an audio track)? */
function hasOwnSound(project: Project, clip: Clip, trackKind: string): boolean {
  const asset = assetOf(project, clip)
  return trackKind === 'video' && asset?.kind === 'video' && asset.hasAudio
}

/** Removes the sound from clips of video files (their picture stays). Music and sound-effect tracks are untouched. */
export function removeClipAudio(project: Project, clipIds?: ReadonlySet<string>): { project: Project; clips: number } {
  let clips = 0
  const next = {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (c.muted || (clipIds && !clipIds.has(c.id)) || !hasOwnSound(project, c, t.kind)) return c
        clips++
        return { ...c, muted: true }
      })
    }))
  }
  return { project: clips ? next : project, clips }
}

// ---------- pacing ----------

/** Sets new lengths for the main track's clips and closes the gaps (clips on other tracks are left alone). */
function retime(project: Project, track: Track, lengthFor: (clip: Clip, start: number) => number): Project {
  let next = project
  let cursor: number | null = null
  let previousEnd = 0
  for (const original of sorted(track)) {
    // Keep deliberate gaps between clips; only the clip lengths change.
    const gap = Math.max(0, original.start - previousEnd)
    const start: number = cursor === null ? original.start : cursor + (gap > 1e-3 ? gap : 0)
    previousEnd = ops.clipEnd(original)
    const wanted = Math.max(0.2, lengthFor(original, start))
    next = ops.updateClip(next, original.id, { start })
    // trimClipEnd respects how much source material exists.
    const withRoom = { ...next, tracks: next.tracks.map((t) => (t.id === track.id ? { ...t, clips: t.clips.filter((c) => c.id === original.id || c.start < start) } : t)) }
    const trimmed = ops.findClip(ops.trimClipEnd(withRoom, original.id, start + wanted), original.id)!.clip
    next = ops.updateClip(next, original.id, { duration: trimmed.duration, sourceIn: trimmed.sourceIn })
    cursor = start + trimmed.duration
  }
  return next
}

/** Shortens every shot on the main track by `factor` (0.75 = 25% faster) and closes the gaps. */
export function tightenPacing(project: Project, factor = 0.75, minLength = 0.8): Project {
  const track = mainTrack(project)
  if (!track) return project
  return retime(project, track, (clip) => (clip.duration <= minLength ? clip.duration : Math.max(minLength, clip.duration * factor)))
}

/** Moves each cut on the main track to the nearest musical beat. */
export function syncCutsToBeats(project: Project, beatsPerShot = 1): { project: Project; moved: number } {
  const beats = timelineBeats(project)
  return syncCutsTo(project, beats.length < 4 ? [] : beats.filter((_, i) => i % Math.max(1, Math.round(beatsPerShot)) === 0))
}

/** Moves each cut on the main track to the nearest snare hit. */
export function syncCutsToSnares(project: Project): { project: Project; moved: number } {
  return syncCutsTo(project, musicMarks(project).snares)
}

function syncCutsTo(project: Project, grid: number[]): { project: Project; moved: number } {
  const track = mainTrack(project)
  if (!track || grid.length < 2) return { project, moved: 0 }
  let moved = 0
  const next = retime(project, track, (clip, start) => {
    const end = start + clip.duration
    const candidates = grid.filter((b) => b > start + 0.25)
    if (!candidates.length) return clip.duration
    const target = candidates.reduce((a, b) => (Math.abs(b - end) < Math.abs(a - end) ? b : a))
    if (Math.abs(target - end) > EPS) moved++
    return target - start
  })
  return { project: next, moved }
}

// ---------- audio ----------

/** Lowers music under speech by writing volume keyframes on audio-track clips. */
export function duckMusic(project: Project, duckTo = 0.22, ramp = 0.35): { project: Project; clips: number } {
  const speech: TimeRange[] = []
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.muted) continue
    for (const clip of track.clips) {
      const asset = assetOf(project, clip)
      if (!asset?.hasAudio || !asset.analysis || clip.volume <= 0) continue
      speech.push(...subtractRanges([{ start: clip.start, end: ops.clipEnd(clip) }], rangesToTimeline(clip, asset.analysis.silences)))
    }
  }
  // Bridge short gaps so the music does not pump between words.
  const talk = mergeRanges(speech.map((r) => ({ start: r.start - ramp, end: r.end + 0.6 })))
  if (!talk.length) return { project, clips: 0 }
  let count = 0
  let next = project
  for (const track of project.tracks) {
    if (track.kind !== 'audio') continue
    for (const clip of track.clips) {
      if (assetOf(project, clip)?.builtinSfx) continue
      const full = clip.volume
      const kfs: Keyframe[] = [{ t: 0, value: full, easing: 'linear' }]
      for (const r of talk) {
        const [a, b] = [r.start - clip.start, r.end - clip.start]
        if (b <= 0 || a >= clip.duration) continue
        if (a <= 0) kfs[0] = { t: 0, value: full * duckTo, easing: 'linear' }
        else kfs.push({ t: a, value: full, easing: 'easeInOut' }, { t: Math.min(clip.duration, a + ramp), value: full * duckTo, easing: 'linear' })
        if (b < clip.duration) kfs.push({ t: b, value: full * duckTo, easing: 'easeInOut' }, { t: Math.min(clip.duration, b + ramp * 2), value: full, easing: 'linear' })
      }
      if (kfs.length > 1 || kfs[0].value !== full) {
        next = ops.updateClip(next, clip.id, { keyframes: { ...clip.keyframes, volume: kfs.sort((x, y) => x.t - y.t) } })
        count++
      }
    }
  }
  return { project: next, clips: count }
}

// ---------- captions ----------

/** Deletes every caption (the ones made from speech or imported from a subtitle file) and the Captions track if it is left empty. */
export function removeCaptions(project: Project): { project: Project; count: number } {
  let count = 0
  const tracks = project.tracks
    .map((t) => ({ ...t, clips: t.clips.filter((c) => { if (c.origin === 'caption') { count++; return false } return true }) }))
    .filter((t, i) => !(t.kind === 'text' && t.name === 'Captions' && t.clips.length === 0 && project.tracks[i].clips.length > 0))
  return { project: count ? { ...project, tracks } : project, count }
}

/** Forgets the recognised speech of a file (the captions already made from it stay until removed). */
export function forgetTranscript(project: Project, assetId: string): Project {
  const asset = project.media.find((m) => m.id === assetId)
  if (!asset?.analysis?.transcript) return project
  return { ...project, media: project.media.map((m) => (m.id === assetId ? { ...m, analysis: { ...m.analysis!, transcript: undefined, language: undefined } } : m)) }
}

export interface CaptionOptions {
  /** Only use the speech of these files (all files with recognised speech when not given). */
  assetIds?: string[]
  /** Longest caption, in words. */
  maxWords: number
  /** A pause this long always starts a new caption. */
  maxGap: number
}

export function ensureTrack(project: Project, kind: Track['kind'], name: string, position: 'top' | 'bottom' | 'aboveVideo'): { project: Project; track: Track } {
  const existing = project.tracks.find((t) => t.kind === kind && t.name === name)
  if (existing) return { project, track: existing }
  const track = makeTrack(kind, name)
  const tracks = [...project.tracks]
  if (position === 'top') tracks.unshift(track)
  else if (position === 'bottom') tracks.push(track)
  else tracks.splice(Math.max(0, tracks.findIndex((t) => t.kind === 'video')), 0, track)
  return { project: { ...project, tracks }, track }
}

/** Builds word-timed caption clips from the transcripts of the footage on the timeline. */
export function addCaptions(project: Project, look: Partial<TextProps> = {}, y = 0.3, options: CaptionOptions = { maxWords: 7, maxGap: 0.7 }): { project: Project; captions: number } {
  const words: Word[] = []
  for (const track of project.tracks) {
    if (track.kind === 'text' || track.muted) continue
    for (const clip of track.clips) {
      const transcript = assetOf(project, clip)?.analysis?.transcript
      if (!transcript || clip.reversed || (options.assetIds && (!clip.assetId || !options.assetIds.includes(clip.assetId)))) continue
      for (const w of transcript) {
        const start = toTimeline(clip, w.start)
        const end = toTimeline(clip, w.end)
        if (start !== null && end !== null && end > start) words.push({ text: w.text, start, end })
      }
    }
  }
  words.sort((a, b) => a.start - b.start)

  // Group into captions: break on long pauses, sentence ends and the word limit.
  const groups: Word[][] = []
  let cur: Word[] = []
  for (const w of words) {
    const prev = cur[cur.length - 1]
    if (prev && (w.start - prev.end > options.maxGap || cur.length >= options.maxWords || /[.!?]$/.test(prev.text))) {
      groups.push(cur)
      cur = []
    }
    cur.push(w)
  }
  if (cur.length) groups.push(cur)

  let base = { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.origin !== 'caption') })) }
  if (!groups.length) return { project: base, captions: 0 }
  const ensured = ensureTrack(base, 'text', 'Captions', 'top')
  base = ensured.project
  const clips = groups.map((group, i) => {
    const start = group[0].start
    const nextStart = groups[i + 1]?.[0].start ?? Infinity
    const end = Math.min(group[group.length - 1].end + 0.25, nextStart)
    const clip = textClip(start, { ...DEFAULT_TEXT, fontSize: 0.05, animation: 'words', wordsPerPage: 0, ...look, content: group.map((w) => w.text).join(' '), words: group.map((w) => ({ text: w.text, start: w.start - start, end: w.end - start })) }, Math.max(0.2, end - start))
    return { ...clip, origin: 'caption' as const, transform: { ...clip.transform, y } }
  })
  return { project: { ...base, tracks: base.tracks.map((t) => (t.id === ensured.track.id ? { ...t, clips: [...t.clips, ...clips] } : t)) }, captions: clips.length }
}

/** Parses SubRip (.srt) text into captions with evenly spread word timings. */
export function parseSrt(srt: string): { start: number; end: number; text: string }[] {
  const time = (s: string): number => {
    const [h, m, rest] = s.trim().split(':')
    return Number(h) * 3600 + Number(m) * 60 + Number(rest.replace(',', '.'))
  }
  return srt.replace(/\r/g, '').split(/\n{2,}/).flatMap((block) => {
    const lines = block.trim().split('\n')
    const at = lines.findIndex((l) => l.includes('-->'))
    if (at < 0) return []
    const [from, to] = lines[at].split('-->')
    const text = lines.slice(at + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    return text ? [{ start: time(from), end: time(to), text }] : []
  })
}

export function captionsFromSrt(project: Project, srt: string, look: Partial<TextProps> = {}, y = 0.3): { project: Project; captions: number } {
  const cues = parseSrt(srt)
  if (!cues.length) return { project, captions: 0 }
  const ensured = ensureTrack(project, 'text', 'Captions', 'top')
  const clips = cues.map((cue) => {
    const parts = cue.text.split(/\s+/)
    const each = (cue.end - cue.start) / parts.length
    const clip = textClip(cue.start, { ...DEFAULT_TEXT, fontSize: 0.05, animation: 'words', ...look, content: cue.text, words: parts.map((text, i) => ({ text, start: i * each, end: (i + 1) * each })) }, cue.end - cue.start)
    return { ...clip, origin: 'caption' as const, transform: { ...clip.transform, y } }
  })
  let next = ensured.project
  for (const clip of clips) next = ops.addClip(next, ensured.track.id, clip)
  return { project: next, captions: clips.length }
}

const srtTime = (t: number, sep: string): string => {
  const ms = Math.round(t * 1000)
  const p = (v: number, n = 2): string => String(v).padStart(n, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`
}

/** Exports the timeline's caption and text clips as SubRip or WebVTT. */
export function exportSubtitles(project: Project, format: 'srt' | 'vtt'): string {
  const clips = project.tracks.filter((t) => t.kind === 'text' && !t.hidden).flatMap((t) => t.clips).filter((c) => c.text).sort((a, b) => a.start - b.start)
  const sep = format === 'srt' ? ',' : '.'
  const body = clips.map((c, i) => {
    const text = c.text!.words?.length ? c.text!.words.map((w) => w.text).join(' ') : c.text!.content.replace(/\*/g, '')
    return `${format === 'srt' ? `${i + 1}\n` : ''}${srtTime(c.start, sep)} --> ${srtTime(ops.clipEnd(c), sep)}\n${text}`
  })
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + body.join('\n\n') + '\n'
}

// ---------- hook ----------

/** Adds punch-in zooms and a flash to the first seconds so the opening grabs attention. */
export function energizeIntro(project: Project, seconds = 5): Project {
  const track = mainTrack(project)
  if (!track) return project
  let next = project
  let first = true
  for (const clip of sorted(track)) {
    if (clip.start >= seconds || !isPicture(project, clip)) continue
    const span = Math.min(clip.duration, seconds - clip.start)
    // A hard punch-in every ~1.4 s, alternating framing, reads as fast cutting without losing words.
    const kfs: Keyframe[] = []
    const levels = [1, 1.16, 1.06, 1.24]
    for (let i = 0, t = 0; t < span; i++, t += 1.4) kfs.push({ t, value: clip.transform.scale * levels[i % levels.length], easing: 'hold' })
    kfs.push({ t: span, value: clip.transform.scale, easing: 'linear' })
    next = ops.updateClip(next, clip.id, {
      keyframes: { ...clip.keyframes, scale: kfs },
      transitionIn: first && !clip.transitionIn ? { type: 'flash', duration: 0.3 } : clip.transitionIn
    })
    first = false
  }
  return next
}

// ---------- styles ----------

export interface StyleContext {
  /** Built-in sound effects already imported into the project, by name. */
  sfx?: Record<string, MediaAsset>
}

/** Removes everything a previous style added, leaving the user's own edits. */
export function stripStyle(project: Project): Project {
  return {
    ...project,
    tracks: project.tracks
      .filter((t) => !(t.name === 'Look' || t.name === 'Style SFX') || t.clips.some((c) => c.origin !== 'style'))
      .map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.origin !== 'style').map((c) => ({
          ...c,
          effects: c.effects.filter((e) => e.origin !== 'style'),
          transitionIn: c.transitionIn?.origin === 'style' ? undefined : c.transitionIn
        }))
      }))
  }
}

export function applyStyle(project: Project, style: StyleDef, context: StyleContext = {}): Project {
  let next = stripStyle(project)

  // 1. Pacing: land cuts on the beat when the style asks for it and music is present.
  if (style.pacing.beatSync) next = syncCutsToBeats(next, style.pacing.beatsPerShot).project

  // 2. Camera movement and transitions on every picture clip.
  const cuts: number[] = []
  next = {
    ...next,
    tracks: next.tracks.map((track) => {
      if (track.kind !== 'video') return track
      const ordered = sorted(track)
      let n = 0
      return {
        ...track,
        clips: track.clips.map((clip) => {
          if (!isPicture(next, clip)) return clip
          const index = ordered.findIndex((c) => c.id === clip.id)
          const flip = index % 2 === 1
          const effects = style.clipEffects.map((e) => ({
            ...makeEffect(e.type, Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, flip && style.alternate?.includes(k) ? -v : v]))),
            origin: 'style' as const
          }))
          const prev = ordered[index - 1]
          const adjoining = prev && Math.abs(ops.clipEnd(prev) - clip.start) < 1e-3
          let transitionIn = clip.transitionIn
          if (adjoining && !transitionIn && style.transitions.types.length) {
            const duration = Math.min(style.transitions.duration, clip.duration / 2, prev.duration / 2)
            transitionIn = { type: style.transitions.types[n++ % style.transitions.types.length], duration, origin: 'style' }
            cuts.push(clip.start)
          }
          return { ...clip, effects: [...clip.effects, ...effects], transitionIn }
        })
      }
    })
  }

  // 3. The look: one effects layer over all the footage.
  const duration = ops.projectDuration(next)
  if (style.look.length && duration > 0) {
    const ensured = ensureTrack(next, 'video', 'Look', 'aboveVideo')
    const layer: Clip = { ...makeClip({ assetId: null, start: 0, duration }), origin: 'style', effects: style.look.map((e) => ({ ...makeEffect(e.type, e.params), origin: 'style' as const })) }
    next = { ...ensured.project, tracks: ensured.project.tracks.map((t) => (t.id === ensured.track.id ? { ...t, clips: [layer] } : t)) }
  }

  // 4. Typography: titles and captions take the style's type system. Wording and timing are kept.
  next = {
    ...next,
    tracks: next.tracks.map((track) => track.kind !== 'text' ? track : {
      ...track,
      clips: track.clips.map((clip) => {
        if (!clip.text) return clip
        const isCaption = clip.origin === 'caption'
        const look = isCaption ? style.caption : style.title
        return { ...clip, text: { ...clip.text, ...look }, transform: isCaption ? { ...clip.transform, y: style.captionY } : clip.transform }
      })
    })
  }

  // 5. Sound design: a sound on every transition, fades at the ends, music under speech.
  const sfx = style.transitionSfx ? context.sfx?.[style.transitionSfx] : undefined
  if (sfx && cuts.length) {
    const ensured = ensureTrack(next, 'audio', 'Style SFX', 'bottom')
    next = ensured.project
    const lead = Math.min(0.15, sfx.duration / 3)
    for (const cut of cuts) next = ops.addClip(next, ensured.track.id, { ...makeClip({ assetId: sfx.id, start: Math.max(0, cut - lead), duration: sfx.duration }), volume: style.sfxVolume, origin: 'style' })
  }
  const main = mainTrack(next)
  if (main?.clips.length) {
    const ordered = sorted(main)
    const [first, last] = [ordered[0], ordered[ordered.length - 1]]
    if (style.audio.fadeIn && !first.fadeIn) next = ops.updateClip(next, first.id, { fadeIn: Math.min(style.audio.fadeIn, first.duration / 2) })
    if (style.audio.fadeOut && !last.fadeOut) next = ops.updateClip(next, last.id, { fadeOut: Math.min(style.audio.fadeOut, last.duration / 2) })
  }
  if (style.audio.duckMusic) next = duckMusic(next).project
  return next
}

export { newId }
