import { expect, test } from 'vitest'
import type { MediaAsset, Project } from '../src/shared/types'
import { clipFromAsset, makeTrack } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import { makeEffect } from '../src/shared/effects/registry'
import { makeAudioEffect } from '../src/shared/effects/audio'
import { applyLook, captureLook, sanitizeLook } from '../src/shared/templates'
import { applyTranslation, captionLines, evenWords, parseTranslation, translateCaptions, translationPrompt } from '../src/shared/agent/translate'
import { textClip } from '../src/shared/timeline/model'

const asset: MediaAsset = { id: 'a', path: '/a.mp4', name: 'a.mp4', kind: 'video', duration: 10, hasAudio: true, sizeBytes: 1 }
const rig = (): { p: Project; id: string; id2: string } => {
  const t = makeTrack('video', 'V1')
  let p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [asset], tracks: [t] }
  const a = clipFromAsset(asset, 0)
  const b = clipFromAsset(asset, 20)
  p = ops.addClip(ops.addClip(p, t.id, a), t.id, b)
  return { p, id: a.id, id2: b.id }
}

test('a look survives a round trip through a file and applies to other clips', () => {
  const { p, id, id2 } = rig()
  const styled = ops.updateClip(p, id, { effects: [makeEffect('bloom', { amount: 0.9 }), makeEffect('vignette')], audioFx: [makeAudioEffect('reverb')], blend: 'screen', transitionIn: { type: 'whip', duration: 0.4 } })
  const look = captureLook(ops.findClip(styled, id)!.clip, '  Dreamy  ')
  const file = JSON.parse(JSON.stringify(look))
  const clean = sanitizeLook(file)!
  expect(clean.look.name).toBe('Dreamy')
  const applied = applyLook(styled, [id2], clean.look)
  const target = ops.findClip(applied.project, id2)!.clip
  expect(applied.count).toBe(1)
  expect(target.effects.map((e) => [e.type, e.params.amount])).toEqual([['bloom', 0.9], ['vignette', 0.5]])
  expect(target.audioFx![0].type).toBe('reverb')
  expect([target.blend, target.transitionIn]).toEqual(['screen', { type: 'whip', duration: 0.4 }])
  expect(new Set([...(target.effects.map((e) => e.id)), ...ops.findClip(applied.project, id)!.clip.effects.map((e) => e.id)]).size).toBe(4) // fresh ids
})

test('look files from strangers are cleaned: unknown effects dropped, values forced into range', () => {
  const r = sanitizeLook({ format: 'vlcut-look', name: '<b>x</b>', effects: [{ type: 'bloom', params: { amount: 99, radius: -5, evil: 1 } }, { type: 'formatDisk', params: {} }, { type: 'lut', params: {} }, 'junk'], audioFx: [{ type: 'bass', params: { amount: 1e9 } }, { type: 'nope' }], blend: 'evil', transition: { type: 'x; drop', duration: 1 } })!
  expect(r.dropped).toBe(4)
  expect(r.look.effects).toHaveLength(1)
  expect(r.look.effects[0].params).toEqual({ amount: 1, threshold: 0.6, radius: 2 })
  expect(r.look.audioFx[0].params.amount).toBe(18)
  expect(r.look.blend).toBeUndefined()
  expect(r.look.transition).toBeUndefined()
  expect(r.look.name).not.toMatch(/[<>]/)
  expect(sanitizeLook({ format: 'something else' })).toBeNull()
  expect(sanitizeLook({ format: 'vlcut-look', effects: [] })).toBeNull() // empty looks are not looks
  expect(sanitizeLook('x')).toBeNull()
})

function captioned(): { p: Project; ids: string[] } {
  const { p } = rig()
  const t = makeTrack('text', 'Captions')
  const clips = [textClip(0, { content: 'Hello there', words: [{ text: 'Hello', start: 0, end: 0.5 }, { text: 'there', start: 0.5, end: 1 }] }, 2), textClip(3, { content: 'How are you' }, 2)].map((c) => ({ ...c, origin: 'caption' as const }))
  return { p: { ...p, tracks: [...p.tracks, { ...t, clips }] }, ids: clips.map((c) => c.id) }
}

test('captions are translated line by line, keeping timing, look and word timing', async () => {
  const { p } = captioned()
  expect(captionLines(p).map((l) => l.text)).toEqual(['Hello there', 'How are you'])
  const r = await translateCaptions(p, 'Spanish', async (prompt) => {
    expect(prompt).toContain('Spanish')
    return 'Sure:\n```json\n["Hola", "¿Cómo estás tú?"]\n```'
  })
  expect(r.translated).toBe(2)
  const [a, b] = captionLines(r.project)
  expect([a.text, b.text]).toEqual(['Hola', '¿Cómo estás tú?'])
  const clip = r.project.tracks.flatMap((t) => t.clips).find((c) => c.text?.content === 'Hola')!
  expect(clip.duration).toBe(2)
  expect(clip.text!.words).toEqual([{ text: 'Hola', start: 0, end: 2 }])
  expect(evenWords('a b c d', 2).map((w) => w.start)).toEqual([0, 0.5, 1, 1.5])
})

test('replies are understood in different formats, and a bad reply leaves the captions alone', async () => {
  expect(parseTranslation('["a","b"]', 2)).toEqual(['a', 'b'])
  expect(parseTranslation('1. Uno\n2. Dos', 2)).toEqual(['Uno', 'Dos'])
  expect(parseTranslation('["only one"]', 2)).toBeNull()
  expect(parseTranslation('I cannot do that', 2)).toBeNull()
  const { p } = captioned()
  let calls = 0
  const r = await translateCaptions(p, 'French', async () => { calls++; return 'sorry' })
  expect(calls).toBe(2) // one retry
  expect([r.translated, r.failed]).toEqual([0, 2])
  expect(captionLines(r.project).map((l) => l.text)).toEqual(['Hello there', 'How are you'])
  expect(translationPrompt([{ id: '1', text: 'x' }], 'German')).toContain('German')
  expect(applyTranslation(p, [], []).tracks.length).toBe(p.tracks.length)
})
