import { expect, test } from 'vitest'
import { addCaptions, forgetTranscript, removeCaptions } from '../src/shared/agent/tools'
import { clipFromAsset, makeTrack } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import type { MediaAsset, Project } from '../src/shared/types'

const talk = (id: string): MediaAsset => ({ id, path: `/${id}.mp4`, name: `${id}.mp4`, kind: 'video', duration: 10, width: 1920, height: 1080, fps: 30, hasAudio: true, sizeBytes: 1, analysis: { version: 1, silences: [], shots: [], beats: [], bpm: null, loudness: null, transcript: [{ text: `hello-${id}`, start: 0.5, end: 1 }, { text: 'there', start: 1.1, end: 1.6 }] } })

function rig() {
  const v = makeTrack('video', 'V1'), v2 = makeTrack('video', 'V2')
  let p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [talk('a'), talk('b')], tracks: [v2, v] }
  p = ops.addClip(p, v.id, clipFromAsset(p.media[0], 0))
  p = ops.addClip(p, v2.id, clipFromAsset(p.media[1], 0))
  return p
}
const captions = (p: Project) => p.tracks.flatMap((t) => t.clips).filter((c) => c.origin === 'caption')

test('captions can be limited to the files you chose', () => {
  const p = rig()
  expect(captions(addCaptions(p, {}, 0.3).project).map((c) => c.text!.content).join(' ')).toContain('hello-a')
  const onlyB = addCaptions(p, {}, 0.3, { maxWords: 7, maxGap: 0.7, assetIds: ['b'] }).project
  expect(captions(onlyB).map((c) => c.text!.content).join(' ')).toBe('hello-b there')
  expect(addCaptions(p, {}, 0.3, { maxWords: 7, maxGap: 0.7, assetIds: [] }).captions).toBe(0)
})

test('all captions can be removed again (and the Captions track goes with them)', () => {
  const made = addCaptions(rig(), {}, 0.3).project
  expect(captions(made).length).toBeGreaterThan(0)
  expect(made.tracks.some((t) => t.name === 'Captions')).toBe(true)
  const r = removeCaptions(made)
  expect(r.count).toBe(captions(made).length)
  expect(captions(r.project)).toHaveLength(0)
  expect(r.project.tracks.some((t) => t.name === 'Captions')).toBe(false)
  expect(r.project.tracks.flatMap((t) => t.clips)).toHaveLength(2) // the footage is untouched
  expect(removeCaptions(r.project).count).toBe(0)
  expect(removeCaptions(r.project).project).toBe(r.project)
})

test('hand-made text on a Captions track is not deleted, only real captions', () => {
  const made = addCaptions(rig(), {}, 0.3).project
  const track = made.tracks.find((t) => t.name === 'Captions')!
  const mine = { ...track.clips[0], id: 'mine', origin: undefined }
  const mixed = ops.addClip(made, track.id, { ...mine, start: 8 })
  const r = removeCaptions(mixed)
  expect(r.project.tracks.find((t) => t.name === 'Captions')!.clips.map((c) => c.id)).toEqual(['mine'])
})

test('a file’s recognised speech can be forgotten, so it is recognised again or left out', () => {
  const p = rig()
  const f = forgetTranscript(p, 'a')
  expect(f.media.find((m) => m.id === 'a')!.analysis!.transcript).toBeUndefined()
  expect(f.media.find((m) => m.id === 'b')!.analysis!.transcript).toHaveLength(2)
  expect(captions(addCaptions(f, {}, 0.3).project).map((c) => c.text!.content).join(' ')).toBe('hello-b there')
  expect(forgetTranscript(f, 'a')).toBe(f)
  expect(forgetTranscript(p, 'zzz')).toBe(p)
})
