import { expect, test } from 'vitest'
import type { Analysis, MediaAsset, Project } from '../src/shared/types'
import { clipFromAsset, makeTrack } from '../src/shared/timeline/model'
import { addClip, clipEnd, projectDuration } from '../src/shared/timeline/ops'
import * as tools from '../src/shared/agent/tools'
import { extractJson, planRequest, runStep, validatePlan } from '../src/shared/agent/planner'
import { BUILTIN_STYLES, COLOUR_STYLES, findStyle } from '../src/shared/styles/styles'
import { effectSpec, EFFECTS, EFFECT_STACKS, makeEffect, TRANSITIONS, TEXT_ANIMATIONS, FONTS } from '../src/shared/effects/registry'
import { implementedEffects } from '../src/renderer/src/engine/effects'
import '../src/renderer/src/engine/effects2'
import '../src/renderer/src/engine/effects3'
import '../src/renderer/src/engine/effects4'

const shot = (start: number, end: number, score: number, extra = {}): Analysis['shots'][number] => ({ start, end, motion: 0.3, brightness: 0.5, saturation: 0.4, speech: 1, hash: `${start}`.padStart(16, '1'), score, tags: [], ...extra })
const talk: MediaAsset = {
  id: 'talk', path: '/talk.mp4', name: 'talk.mp4', kind: 'video', duration: 20, hasAudio: true, sizeBytes: 1,
  analysis: { version: 1, silences: [{ start: 4, end: 6 }, { start: 10, end: 10.3 }, { start: 15, end: 18 }], shots: [shot(0, 8, 0.9), shot(8, 14, 0.4), shot(14, 20, 0.7)], beats: [], bpm: null, loudness: -20,
    transcript: [{ text: 'Hello', start: 1, end: 1.4 }, { text: 'there.', start: 1.5, end: 2 }, { text: 'Second', start: 7, end: 7.5 }, { text: 'line', start: 7.6, end: 8 }] }
}
const broll: MediaAsset = { id: 'broll', path: '/b.mp4', name: 'b.mp4', kind: 'video', duration: 12, hasAudio: false, sizeBytes: 1, analysis: { version: 1, silences: [], shots: [shot(0, 6, 0.8), shot(6, 12, 0.95, { duplicateOf: { assetId: 'talk', shot: 0 } })], beats: [], bpm: null, loudness: null } }
const music: MediaAsset = { id: 'music', path: '/m.mp3', name: 'm.mp3', kind: 'audio', duration: 60, hasAudio: true, sizeBytes: 1, analysis: { version: 1, silences: [], shots: [], beats: Array.from({ length: 120 }, (_, i) => i * 0.5), bpm: 120, loudness: -12 } }
const whoosh: MediaAsset = { id: 'sfx', path: '/whoosh.wav', name: 'whoosh.wav', kind: 'audio', duration: 0.6, hasAudio: true, sizeBytes: 1, builtinSfx: 'whoosh' }

function project(withMusic = false): Project {
  const tracks = [makeTrack('text', 'Text 1'), makeTrack('video', 'Video 1'), makeTrack('audio', 'Audio 1')]
  let p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [talk, broll, music, whoosh], tracks }
  p = addClip(p, tracks[1].id, clipFromAsset(talk, 0))
  if (withMusic) p = addClip(p, tracks[2].id, clipFromAsset(music, 0))
  return p
}
const video = (p: Project) => [...p.tracks.find((t) => t.name === 'Video 1')!.clips].sort((a, b) => a.start - b.start)

test('every style references real effects, transitions, fonts and animations', () => {
  const transitions = new Set(TRANSITIONS.map((t) => t.type))
  const animations = new Set(TEXT_ANIMATIONS.map((t) => t.type))
  expect(BUILTIN_STYLES).toHaveLength(10)
  for (const style of BUILTIN_STYLES) {
    for (const e of [...style.look, ...style.clipEffects]) {
      const spec = effectSpec(e.type)
      expect(spec, `${style.id}:${e.type}`).toBeDefined()
      for (const key of Object.keys(e.params)) expect(spec!.params.map((p) => p.key), `${style.id}:${e.type}.${key}`).toContain(key)
    }
    for (const t of style.transitions.types) expect(transitions.has(t), `${style.id}:${t}`).toBe(true)
    for (const look of [style.title, style.caption]) {
      expect(FONTS).toContain(look.fontFamily)
      expect(animations.has(look.animation!)).toBe(true)
    }
  }
})

test('removeSilences cuts padded pauses and ripples', () => {
  const r = tools.removeSilences(project())
  expect(r.cuts).toBe(2) // the 0.3 s pause is too short
  expect(r.removed).toBeCloseTo(2 - 0.24 + 3 - 0.24)
  expect(projectDuration(r.project)).toBeCloseTo(20 - r.removed)
  const withMusic = tools.removeSilences(project(true)).project
  expect(withMusic.tracks.find((t) => t.kind === 'audio')!.clips).toHaveLength(1) // music is not chopped
  expect(video(r.project).map((c) => c.sourceIn)).toEqual([0, 5.88, 17.88])
})

test('silence under another loud clip is not cut', () => {
  let p = project()
  const second = makeTrack('video', 'Video 2')
  p = { ...p, tracks: [...p.tracks, second] }
  p = addClip(p, second.id, { ...clipFromAsset(talk, 0), sourceIn: 6, duration: 4, start: 3 }) // loud 3-7 s
  expect(tools.silentRanges(p, { minSilence: 0.45, padding: 0.12 }).map((r) => Math.round(r.start))).toEqual([15])
})

test('buildMontage uses best shots in shooting order and skips duplicates', () => {
  const r = tools.buildMontage(project(), { duration: 6, shotLength: 2 })
  const clips = video(r.project)
  expect(clips.map((c) => c.assetId)).toEqual(['talk', 'talk', 'broll'])
  expect(clips.map((c) => c.sourceIn)).toEqual([3, 16, 2])
  expect(clipEnd(clips[2])).toBe(6)
})

test('syncCutsToBeats lands cuts on beats and keeps the sequence gapless', () => {
  let p = project(true)
  p = tools.removeSilences(p).project
  const r = tools.syncCutsToBeats(p, 2)
  const clips = video(r.project)
  for (const c of clips.slice(0, -1)) expect((clipEnd(c) * 1000) % 1000).toBe(0) // every 2 beats = whole seconds
  for (let i = 1; i < clips.length; i++) expect(clips[i].start).toBeCloseTo(clipEnd(clips[i - 1]))
  expect(r.moved).toBeGreaterThan(0)
})

test('duckMusic writes volume keyframes around speech', () => {
  const r = tools.duckMusic(project(true))
  const kfs = r.project.tracks.find((t) => t.kind === 'audio')!.clips[0].keyframes.volume!
  expect(r.clips).toBe(1)
  expect(kfs[0].value).toBeCloseTo(0.22) // speech starts at 0
  expect(Math.max(...kfs.map((k) => k.value))).toBe(1)
})

test('captions follow the edit and export to SRT', () => {
  const cut = tools.removeSilences(project()).project
  const r = tools.addCaptions(cut)
  const caps = r.project.tracks.find((t) => t.name === 'Captions')!.clips
  expect(caps.map((c) => c.text!.content)).toEqual(['Hello there.', 'Second line'])
  expect(caps[1].start).toBeCloseTo(7 - 1.76) // moved earlier by the removed pause
  expect(caps[0].text!.words![1]).toMatchObject({ text: 'there.', start: 0.5 })
  const srt = tools.exportSubtitles(r.project, 'srt')
  expect(srt).toContain('1\n00:00:01,000 --> 00:00:02,250\nHello there.')
  expect(tools.exportSubtitles(r.project, 'vtt').startsWith('WEBVTT')).toBe(true)
  const again = tools.addCaptions(r.project)
  expect(again.project.tracks.find((t) => t.name === 'Captions')!.clips).toHaveLength(2) // regenerated, not doubled
  const imported = tools.captionsFromSrt(project(), '1\n00:00:01,000 --> 00:00:03,000\nOne two\n\n2\n00:00:04,500 --> 00:00:05,000\n<i>Three</i>\n')
  expect(imported.captions).toBe(2)
})

test('applyStyle is editable timeline content and re-styling replaces it', () => {
  let p = tools.removeSilences(project(true)).project
  p = tools.addCaptions(p).project
  const cinematic = tools.applyStyle(p, findStyle('cinematic')!, { sfx: { swell: { ...whoosh, builtinSfx: 'swell' } } })
  const look = cinematic.tracks.find((t) => t.name === 'Look')!
  expect(look.clips[0].effects.map((e) => e.type)).toContain('letterbox')
  expect(look.clips[0].duration).toBeCloseTo(projectDuration(cinematic))
  expect(cinematic.tracks.findIndex((t) => t.name === 'Look')).toBeLessThan(cinematic.tracks.findIndex((t) => t.name === 'Video 1'))
  expect(video(cinematic).filter((c) => c.transitionIn).length).toBe(2)
  expect(video(cinematic)[0].effects[0]).toMatchObject({ type: 'slowZoom', origin: 'style' })
  expect(video(cinematic)[1].effects[0].params.amount).toBeLessThan(0) // alternates direction
  expect(cinematic.tracks.find((t) => t.name === 'Style SFX')!.clips).toHaveLength(2)
  expect(cinematic.tracks.find((t) => t.name === 'Captions')!.clips[0].text).toMatchObject({ fontFamily: 'Cormorant Garamond', content: 'Hello there.' })
  expect(cinematic.tracks.find((t) => t.kind === 'audio' && t.name === 'Audio 1')!.clips[0].keyframes.volume).toBeDefined()

  const hype = tools.applyStyle(cinematic, findStyle('hype')!)
  expect(hype.tracks.filter((t) => t.name === 'Look')).toHaveLength(1)
  expect(hype.tracks.find((t) => t.name === 'Look')!.clips[0].effects.map((e) => e.type)).not.toContain('letterbox')
  expect(video(hype)[0].effects.map((e) => e.type)).toEqual(['zoomPulse', 'shake'])
  expect(hype.tracks.find((t) => t.name === 'Style SFX')).toBeUndefined()

  const stripped = tools.stripStyle(hype)
  expect(stripped.tracks.find((t) => t.name === 'Look')).toBeUndefined()
  expect(video(stripped).every((c) => !c.transitionIn && c.effects.length === 0)).toBe(true)
})

test('planner understands the example requests', () => {
  const p = project(true)
  const tool = (text: string) => planRequest(text, p).steps.map((s) => s.tool)
  expect(tool('Make this video more cinematic.')).toEqual(['applyStyle'])
  expect(planRequest('Make this video more cinematic.', p).steps[0].args.styleId).toBe('cinematic')
  expect(tool('Remove all unnecessary pauses.')).toEqual(['removeSilences'])
  expect(tool('Create dynamic subtitles.')).toEqual(['addCaptions'])
  expect(planRequest('Make the first 5 seconds more interesting.', p).steps[0]).toMatchObject({ tool: 'energizeIntro', args: { seconds: 5 } })
  expect(planRequest('Use the best clips and create a 30-second montage.', p).steps[0]).toMatchObject({ tool: 'buildMontage', args: { duration: 30 } })
  expect(tool('Add transitions that match the music.')).toEqual(['syncToBeats', 'addTransitions'])
  expect(tool('Make the pacing faster.')).toEqual(['removeSilences', 'changePacing'])
  expect(planRequest('Give me three different versions.', p).variants!.map((v) => v.name)).toEqual(['Cinematic', 'Hype', 'Editorial'])
  expect(tool('make it vertical for tiktok with a vintage look and captions')).toEqual(['setFormat', 'applyStyle', 'addCaptions'])
  const unknown = planRequest('what is the weather', p)
  expect(unknown.steps).toHaveLength(0)
  expect(unknown.notes[0]).toContain('I can')
  expect(planRequest('add captions', { ...p, media: [broll] }).notes[0]).toContain('transcript')
})

test('runStep reports what happened and leaves the input untouched', () => {
  const p = project(true)
  const frozen = JSON.stringify(p)
  const r = runStep(p, { tool: 'removeSilences', args: {}, description: '' })
  expect(r.summary).toBe('Removed 2 pauses, 4.5 s in total.')
  expect(r.changed).toBe(true)
  expect(runStep(r.project, { tool: 'removeSilences', args: {}, description: '' })).toMatchObject({ changed: false, summary: 'Found no pauses long enough to cut.' })
  expect(runStep(p, { tool: 'setFormat', args: { width: 1080, height: 1920 }, description: '' }).project.settings).toMatchObject({ width: 1080, height: 1920 })
  expect(runStep(project(), { tool: 'changePacing', args: { factor: 0.5 }, description: '' }).summary).toBe('Timeline went from 20.0 s to 10.0 s.')
  expect(runStep(r.project, { tool: 'addTransitions', args: { type: 'whip' }, description: '' }).summary).toBe('Added 2 transitions.')
  expect(runStep(p, { tool: 'denoise', args: {}, description: '' }).project.tracks[1].clips[0].denoise).toBe(true)
  expect(JSON.stringify(p)).toBe(frozen)
})

test('language-model plans are validated', () => {
  const reply = 'Sure! Here is the plan:\n```json\n[{"tool":"applyStyle","args":{"styleId":"hype"}},{"tool":"formatDisk"},{"tool":"applyStyle","args":{"styleId":"nope"}},{"tool":"removeSilences","args":{"x":{"a":1}}}]\n```'
  expect(validatePlan(extractJson(reply)).map((s) => [s.tool, s.args])).toEqual([['applyStyle', { styleId: 'hype' }], ['removeSilences', {}]])
  expect(validatePlan(extractJson('no json here'))).toEqual([])
})

test('every effect has drawing code and every stack uses real effects and parameters', () => {
  const implemented = implementedEffects()
  expect(EFFECTS.length).toBe(77)
  for (const e of EFFECTS) expect(implemented.has(e.type), e.type).toBe(true)
  expect(EFFECT_STACKS.length).toBeGreaterThanOrEqual(14)
  for (const stack of EFFECT_STACKS) {
    for (const e of stack.effects) {
      const spec = effectSpec(e.type)
      expect(spec, `${stack.name}:${e.type}`).toBeDefined()
      for (const [key, value] of Object.entries(e.params)) {
        const param = spec!.params.find((p) => p.key === key)
        expect(param, `${stack.name}:${e.type}.${key}`).toBeDefined()
        expect(value >= param!.min && value <= param!.max, `${stack.name}:${e.type}.${key}=${value}`).toBe(true)
      }
      expect(makeEffect(e.type, e.params).params).toMatchObject(e.params)
    }
  }
})

// ---------- cutting to the music, snares, removing audio ----------

const song: MediaAsset = { id: 'song', path: '/song.mp3', name: 'song.mp3', kind: 'audio', duration: 60, hasAudio: true, sizeBytes: 1,
  analysis: { version: 1, silences: [], shots: [], bpm: 120, loudness: -12, beats: Array.from({ length: 40 }, (_, i) => i * 0.5), snares: Array.from({ length: 20 }, (_, i) => 0.5 + i) } }

function withSong(): Project {
  const p = project(false)
  const audio = p.tracks.find((t) => t.kind === 'audio')!
  return addClip({ ...p, media: [...p.media, song] }, audio.id, clipFromAsset(song, 0))
}

test('autoCutToBeat chops the main track on the beat, on every Nth beat, or on snares', async () => {
  const { autoCutToBeat } = tools
  const everyBeat = autoCutToBeat(withSong(), { on: 'beats', every: 1, punch: false })
  const pieces = video(everyBeat.project)
  expect(everyBeat.cuts).toBe(39) // 20 s of footage, a beat every 0.5 s, none at 0 or at the end
  expect(pieces.map((c) => c.duration).every((d) => Math.abs(d - 0.5) < 1e-6)).toBe(true)
  expect(pieces[1].sourceIn).toBeCloseTo(0.5) // the footage continues, it is only cut
  const bars = autoCutToBeat(withSong(), { on: 'beats', every: 4, punch: false })
  expect(video(bars.project).map((c) => c.start).slice(0, 4)).toEqual([0, 2, 4, 6])
  const snares = autoCutToBeat(withSong(), { on: 'snares', punch: true })
  const hit = video(snares.project)
  expect(hit.slice(0, 3).map((c) => c.start)).toEqual([0, 0.5, 1.5]) // snares at 0.5, 1.5, 2.5...
  expect(hit.map((c) => c.transform.scale).slice(0, 4)).toEqual([1, 1.14, 1, 1.14]) // alternate punch-in
  expect(autoCutToBeat(project(false), { on: 'beats' }).cuts).toBe(0) // no music, nothing to cut to
})

test('syncCutsToSnares moves existing cuts onto snare hits', () => {
  let p = withSong()
  const clip = video(p)[0]
  p = tools.removeSilences(ops_split(p, clip.id, 3.2)).project
  const r = tools.syncCutsToSnares(p)
  expect(r.moved).toBeGreaterThan(0)
  const cutAt = video(r.project)[0].duration
  expect([2.5, 3.5].some((s) => Math.abs(s - cutAt) < 1e-6)).toBe(true)
})

import { splitClip as ops_split } from '../src/shared/timeline/ops'
import { musicMarks } from '../src/shared/timeline/marks'
import { snapPoints } from '../src/shared/timeline/ops'

test('music marks follow the music clip and feed snapping', () => {
  const p = withSong()
  const marks = musicMarks(p)
  expect(marks.beats.slice(0, 3)).toEqual([0, 0.5, 1])
  expect(marks.snares.slice(0, 2)).toEqual([0.5, 1.5])
  expect(snapPoints(p).includes(1.5)).toBe(false) // marks are opt-in
  expect(snapPoints(p, new Set(), { snares: true }).includes(1.5)).toBe(true)
  expect(snapPoints(p, new Set(), { beats: true }).includes(1.0)).toBe(true)
  // Sound-effect clips are never mistaken for the music.
  const sfx = { ...whoosh, analysis: song.analysis }
  const only = { ...project(false), media: [...project(false).media.filter((m) => m.id !== 'sfx'), sfx] }
  expect(musicMarks(addClip(only, only.tracks.find((t) => t.kind === 'audio')!.id, clipFromAsset(sfx, 0))).beats).toEqual([])
})

test('removeClipAudio mutes video clips only, and the planner understands the request', async () => {
  const p = withSong()
  const r = tools.removeClipAudio(p)
  expect(r.clips).toBe(1)
  expect(video(r.project)[0].muted).toBe(true)
  expect(r.project.tracks.find((t) => t.kind === 'audio')!.clips[0].muted).toBeUndefined() // music untouched
  expect(tools.removeClipAudio(r.project).clips).toBe(0)
  const { buildAudioGraph } = await import('../src/shared/render/audioGraph')
  expect(buildAudioGraph(project(false))).not.toBeNull()
  expect(buildAudioGraph(tools.removeClipAudio(project(false)).project)).toBeNull() // the only sound was the clip's own
  const { losslessPlan } = await import('../src/shared/render/lossless')
  const plain = project(false)
  expect(losslessPlan(plain)).toMatchObject({ ok: true, dropAudio: false })
  expect(losslessPlan(tools.removeClipAudio(plain).project)).toMatchObject({ ok: true, dropAudio: true })

  const say = (t: string) => planRequest(t, withSong()).steps.map((s) => `${s.tool}${s.args.on ? ':' + s.args.on : ''}`)
  expect(say('remove the audio from the clips')).toEqual(['removeAudio'])
  expect(say('mute the footage')).toEqual(['removeAudio'])
  expect(say('automatically cut to the beat')).toEqual(['autoCutToBeat:beats'])
  expect(say('auto cut it on the snares')).toEqual(['autoCutToBeat:snares'])
  expect(say('cut every 4 beats')).toEqual(['autoCutToBeat:beats'])
  expect(say('snap the cuts to the snare')).toEqual(['syncToSnares'])
  expect(say('sync the cuts to the beat')).toEqual(['syncToBeats'])
  const noMusic = planRequest('cut to the beat', project(false))
  expect(noMusic.steps).toHaveLength(0)
  expect(noMusic.notes[0]).toContain('music')
  expect(runStep(withSong(), { tool: 'autoCutToBeat', args: { on: 'beats', every: 2 }, description: '' }).summary).toBe('Made 19 cuts on the beat.')
})

test('every transition has its own behaviour, not the fade fallback', async () => {
  const { transitionFrame } = await import('../src/renderer/src/engine/transitions')
  expect(TRANSITIONS.length).toBe(48)
  const fade = JSON.stringify(transitionFrame('fade', 0.4))
  for (const t of TRANSITIONS.filter((x) => x.type !== 'fade' && x.type !== 'smoothFade')) {
    expect(JSON.stringify(transitionFrame(t.type, 0.4)), t.type).not.toBe(fade)
  }
  // Every transition starts on the outgoing picture and ends on the incoming one.
  for (const t of TRANSITIONS) {
    const [a, b] = [transitionFrame(t.type, 0), transitionFrame(t.type, 1)]
    expect(a.incoming.alpha ?? 1, `${t.type} start`).toBeLessThanOrEqual(1)
    expect(b.incoming.alpha ?? 1, `${t.type} end`).toBeGreaterThan(0.9)
  }
})

test('colour styles only grade: no shakes, pulses, zooms, transitions, sounds or type changes', () => {
  expect(COLOUR_STYLES.length).toBeGreaterThanOrEqual(BUILTIN_STYLES.length + 20)
  expect(new Set(COLOUR_STYLES.map((s) => s.name)).size).toBe(COLOUR_STYLES.length) // every style has its own name
  const banned = ['shake', 'zoomPulse', 'slowZoom', 'glitch', 'flicker', 'rgbSplit']
  for (const s of COLOUR_STYLES) {
    expect(s.look.some((e) => banned.includes(e.type)), s.id).toBe(false)
    expect(s.clipEffects, s.id).toEqual([])
    expect(s.transitions.types, s.id).toEqual([])
    expect(s.description, s.id).not.toMatch(/shake|pulse|transition|whip|zoom|dissolve|cut|push/i)
  }
  let p = tools.addCaptions(tools.removeSilences(project(true)).project).project
  const before = JSON.stringify(video(p))
  const styled = tools.applyStyle(p, COLOUR_STYLES.find((s) => s.id === 'hype')!)
  expect(styled.tracks.find((t) => t.name === 'Look')!.clips[0].effects.length).toBeGreaterThan(0)
  expect(JSON.stringify(video(styled))).toBe(before) // the footage clips are untouched
  expect(styled.tracks.find((t) => t.name === 'Style SFX')).toBeUndefined()
  expect(styled.tracks.find((t) => t.name === 'Captions')!.clips[0].text!.fontFamily).toBe(p.tracks.find((t) => t.name === 'Captions')!.clips[0].text!.fontFamily)
  p = tools.stripStyle(styled)
  expect(p.tracks.find((t) => t.name === 'Look')).toBeUndefined()
})

test('removing pauses never cuts through recognised speech, even where it is quiet', () => {
  const p = project()
  const quiet = { ...talk, analysis: { ...talk.analysis!, transcript: [...talk.analysis!.transcript!, { text: 'whispered', start: 4.6, end: 5.2 }] } }
  const withQuiet = { ...p, media: p.media.map((m) => (m.id === 'talk' ? quiet : m)) }
  const before = tools.silentRanges(p, { minSilence: 0.45, padding: 0.12 })
  const after = tools.silentRanges(withQuiet, { minSilence: 0.45, padding: 0.12 })
  expect(before.some((r) => r.start < 5 && r.end > 5)).toBe(true) // without the words, the 4 to 6 s pause is cut through the middle
  expect(after.every((r) => !(r.start < 5.2 && r.end > 4.6))).toBe(true) // with them, nothing is cut inside 4.6 to 5.2 s
})
