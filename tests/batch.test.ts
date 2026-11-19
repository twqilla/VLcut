import { expect, test } from 'vitest'
import type { MediaAsset, Project } from '../src/shared/types'
import { clipFromAsset, makeTrack } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import { clipStem, fadeEach, fillFrame, parseRenderSpec, removeKind, removeShortClips, singleClipProject, sortClips, specToSettings, splitEvery, trimClips } from '../src/shared/agent/batch'
import { DEFAULT_INTERPOLINI } from '../src/shared/render/interpolini'
import type { ExportSettings } from '../src/shared/types'

const vid = (id: string, d: number, name = `${id}.mp4`): MediaAsset => ({ id, path: `/${name}`, name, kind: 'video', duration: d, width: 1920, height: 1080, fps: 30, hasAudio: true, sizeBytes: 1 })
const photo: MediaAsset = { id: 'p', path: '/p.jpg', name: 'p.jpg', kind: 'image', duration: 0, width: 1000, height: 1000, hasAudio: false, sizeBytes: 1 }

function rig(durations = [12, 5, 20]): { p: Project; ids: string[] } {
  const t = makeTrack('video', 'V1')
  const media = durations.map((d, i) => vid(`v${i}`, d, `clip${i + 1}.mp4`))
  let p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [...media, photo], tracks: [t] }
  let cursor = 0
  const ids: string[] = []
  media.forEach((m) => { const c = { ...clipFromAsset(m, cursor), sourceIn: 3 }; c.duration = Math.min(c.duration, m.duration - 3); p = ops.addClip(p, t.id, c); ids.push(c.id); cursor += c.duration })
  return { p, ids }
}
const list = (p: Project) => [...p.tracks[0].clips].sort((a, b) => a.start - b.start)

test('"cut all clips to 7 seconds" shortens the long ones, leaves short ones, and closes the track up', () => {
  const { p } = rig([12, 5, 20]) // clips of 9, 2 and 17 seconds (each starts 3 s into its file)
  const r = trimClips(p, 7, 'start')
  expect(r.count).toBe(2)
  const [a, b, c] = list(r.project)
  expect([a.duration, b.duration, c.duration]).toEqual([7, 2, 7])
  expect([a.start, b.start, c.start]).toEqual([0, 7, 9]) // no gaps
  expect(a.sourceIn).toBe(3) // kept the beginning
  // Keeping the end or the middle moves where in the file the clip starts.
  expect(list(trimClips(p, 7, 'end').project)[0].sourceIn).toBe(5) // dropped 2 s from the start of 9
  expect(list(trimClips(p, 7, 'middle').project)[0].sourceIn).toBe(4)
  expect(list(trimClips(p, 7, 'end').project)[2].sourceIn).toBe(13)
})

test('trimming respects speed and reversed clips', () => {
  const { p, ids } = rig([30])
  const fast = ops.updateClip(p, ids[0], { speed: 2, duration: 10, sourceIn: 0 }) // 10 s on the timeline = 20 s of file
  expect(list(trimClips(fast, 4, 'end').project)[0].sourceIn).toBe(12) // dropped 6 s of timeline = 12 s of file
  const rev = ops.updateClip(p, ids[0], { reversed: true, sourceIn: 0, duration: 10 })
  // A reversed clip starts on the end of its range: keeping its first 4 timeline seconds keeps the top of the range.
  expect(list(trimClips(rev, 4, 'start').project)[0].sourceIn).toBe(6)
  expect(list(trimClips(rev, 4, 'end').project)[0].sourceIn).toBe(0)
})

test('photos can be set to an exact length, and only the selection is touched when there is one', () => {
  const t = makeTrack('video', 'V1')
  let p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [photo], tracks: [t] }
  const a = clipFromAsset(photo, 0)
  const b = clipFromAsset(photo, 5)
  p = ops.addClip(ops.addClip(p, t.id, a), t.id, b)
  const r = trimClips(p, 3, 'start', [], false, true)
  expect(list(r.project).map((c) => [c.start, c.duration])).toEqual([[0, 3], [3, 3]])
  const only = trimClips(p, 3, 'start', [b.id], false, true)
  expect(list(only.project).map((c) => c.duration)).toEqual([5, 3])
  expect(trimClips(p, 3, 'start').count).toBe(2) // longer photos are shortened even without the extend option
})

test('split every N seconds makes equal pieces that play the same footage', () => {
  const { p } = rig([12])
  const r = splitEvery(p, 3)
  const pieces = list(r.project)
  expect(pieces.map((c) => c.duration)).toEqual([3, 3, 3])
  expect(pieces.map((c) => c.sourceIn)).toEqual([3, 6, 9])
  expect(r.count).toBe(2)
  expect(splitEvery(p, 0.1).count).toBe(0)
})

test('short clips are removed and the gap closes; sorting re-lays clips back to back', () => {
  const { p } = rig([12, 3, 20]) // 9 s, a 0 s?? -> media of 3 s gives 0-length: use 5 below
  const q = rig([12, 5, 20]).p // 9, 2, 17
  const r = removeShortClips(q, 3)
  expect(list(r.project).map((c) => [c.start, c.duration])).toEqual([[0, 9], [9, 17]])
  expect(r.count).toBe(1)
  void p
  const byLength = sortClips(q, 'length')
  expect(list(byLength.project).map((c) => c.duration)).toEqual([2, 9, 17])
  expect(list(byLength.project).map((c) => c.start)).toEqual([0, 2, 11])
  expect(list(sortClips(q, 'longest').project).map((c) => c.duration)).toEqual([17, 9, 2])
  expect(list(sortClips(q, 'name').project).map((c) => c.assetId)).toEqual(['v0', 'v1', 'v2'])
  const a = list(sortClips(q, 'shuffle', 7).project).map((c) => c.assetId)
  expect([...a].sort()).toEqual(['v0', 'v1', 'v2'])
  expect(list(sortClips(q, 'shuffle', 7).project).map((c) => c.assetId)).toEqual(a) // same seed, same order
})

test('fades, fill-frame and removing kinds of clips', () => {
  const { p } = rig([12, 5, 20])
  const f = fadeEach(p, 0.5)
  expect(list(f.project).every((c) => c.fadeIn === 0.5 && c.fadeOut === 0.5)).toBe(true)
  expect(list(fadeEach(p, 5).project)[1].fadeIn).toBe(1) // never more than half the clip
  const t = makeTrack('video', 'V1')
  let sq: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1080, height: 1920 }, media: [photo], tracks: [t] } as unknown as Project
  sq = ops.addClip(sq, t.id, clipFromAsset(photo, 0))
  expect(list(fillFrame(sq).project)[0].transform.scale).toBeCloseTo(1920 / 1080, 2) // a square photo needs 1.78x to cover a 9:16 frame
  const withText = { ...p, tracks: [...p.tracks, { ...makeTrack('text', 'T'), clips: [{ ...clipFromAsset(photo, 0), assetId: null, text: { content: 'x' } as never, id: 'tx' }] }] }
  expect(removeKind(withText, 'text').count).toBe(1)
  expect(removeKind(withText, 'text').project.tracks[1].clips).toHaveLength(0)
  const trans = ops.updateClip(p, list(p)[1].id, { transitionIn: { type: 'fade', duration: 0.5 } })
  expect(removeKind(trans, 'transitions').count).toBe(1)
})

const base: ExportSettings = { outputPath: '', width: 1920, height: 1080, fps: 30, codec: 'h264', crf: 18, audioBitrateKbps: 192, normalizeAudio: false, motionBlur: { mode: 'off', amount: 0.75, samples: 16, weighting: 'gaussian', interpolini: DEFAULT_INTERPOLINI }, pixelScaling: false }

test('render settings are read from everyday wording', () => {
  expect(parseRenderSpec('render all clips at 1080p 60fps h265')).toEqual({ short: 1080, fps: 60, codec: 'h265' })
  expect(parseRenderSpec('export each clip in 4k')).toEqual({ short: 2160 })
  expect(parseRenderSpec('render every clip for tiktok')).toEqual({ presetId: 'tiktok' })
  expect(parseRenderSpec('export as a small file for discord')).toMatchObject({ presetId: 'discord', crf: 29 })
  expect(parseRenderSpec('render 720p HEVC highest quality')).toEqual({ short: 720, codec: 'h265', crf: 14 })
  expect(parseRenderSpec('render all clips')).toEqual({})
  const s = specToSettings({ short: 1080, fps: 60, codec: 'h265' }, { width: 1920, height: 1080, fps: 30 }, base)
  expect([s.width, s.height, s.fps, s.codec, s.crf]).toEqual([1920, 1080, 60, 'h265', 18])
  const v = specToSettings({ presetId: 'tiktok', fps: 24 }, { width: 1920, height: 1080, fps: 60 }, base)
  expect([v.width, v.height, v.fps]).toEqual([1080, 1920, 24]) // a preset sets the shape; words override its details
  const vertical = specToSettings({ short: 720 }, { width: 1080, height: 1920, fps: 30 }, base)
  expect([vertical.width, vertical.height]).toEqual([720, 1280])
})

test('each clip can be rendered on its own, with a tidy file name', () => {
  const { p, ids } = rig([12, 5, 20])
  const one = singleClipProject(p, ids[2])!
  expect(one.tracks).toHaveLength(1)
  expect(one.tracks[0].clips).toHaveLength(1)
  expect(one.tracks[0].clips[0].start).toBe(0)
  expect(one.media.map((m) => m.id)).toEqual(['v2'])
  expect(ops.projectDuration(one)).toBe(17)
  expect(clipStem(p, list(p)[1], 1, 12)).toBe('02 - clip2')
  expect(clipStem(p, list(p)[0], 0, 120)).toBe('001 - clip1')
  expect(singleClipProject(p, 'nope')).toBeNull()
})
