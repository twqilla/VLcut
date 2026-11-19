import { expect, test } from 'vitest'
import type { MediaAsset, Project } from '../src/shared/types'
import { clipFromAsset, makeTrack } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import { alignBySync, multicamCut } from '../src/shared/timeline/multicam'

const cam = (id: string): MediaAsset => ({ id, path: `/${id}.mp4`, name: `${id}.mp4`, kind: 'video', duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true, sizeBytes: 1 })

function rig() {
  const tracks = [makeTrack('video', 'A'), makeTrack('video', 'B'), makeTrack('video', 'C')]
  let p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [cam('a'), cam('b'), cam('c')], tracks }
  const clips = ['a', 'b', 'c'].map((id, i) => ({ ...clipFromAsset(cam(id), 0), start: 0 + i * 0.1 }))
  clips.forEach((c, i) => (p = ops.addClip(p, tracks[i].id, c)))
  return { p, clips }
}

test('aligning by sound makes the same moment line up on the timeline', () => {
  const { p, clips } = rig()
  // Camera B started recording 3 s before camera A: an event at x in A is at x + 3 in B, so lag = -3.
  const out = alignBySync(p, clips[0].id, [{ id: clips[1].id, lag: -3 }, { id: clips[2].id, lag: 1.5 }])
  const [a, b, c] = ['a', 'b', 'c'].map((id) => out.tracks.flatMap((t) => t.clips).find((x) => x.assetId === id)!)
  // Source moment 20 s of A and the matching 23 s of B must sit at the same timeline time.
  const timelineOf = (clip: typeof a, src: number): number => clip.start + (src - clip.sourceIn)
  expect(timelineOf(b, 23)).toBeCloseTo(timelineOf(a, 20), 6)
  expect(timelineOf(c, 18.5)).toBeCloseTo(timelineOf(a, 20), 6)
})

test('a multicam cut rotates through the angles, shows identical footage, and keeps one sound', () => {
  const { p, clips } = rig()
  const r = multicamCut(p, clips.map((c) => c.id), 4)
  expect(r.pieces).toBeGreaterThan(10)
  const track = r.project.tracks.find((t) => t.name === 'Multicam')!
  const pieces = [...track.clips].sort((a, b) => a.start - b.start)
  // Contiguous, covering the overlap (0.2 .. 60).
  expect(pieces[0].start).toBeCloseTo(0.2, 6)
  pieces.slice(1).forEach((c, i) => expect(c.start).toBeCloseTo(pieces[i].start + pieces[i].duration, 6))
  expect(pieces[pieces.length - 1].start + pieces[pieces.length - 1].duration).toBeCloseTo(60, 6)
  expect(pieces.map((c) => c.assetId).slice(0, 4)).toEqual(['a', 'b', 'c', 'a'])
  // Each piece shows the same source time its angle shows at that moment.
  for (const piece of pieces) {
    const angle = clips.find((c) => c.assetId === piece.assetId)!
    expect(ops.sourceTime(piece, piece.start + 1)).toBeCloseTo(ops.sourceTime(angle, piece.start + 1), 6)
    expect(piece.muted).toBe(true)
  }
  // The angles' own tracks are hidden; only the first keeps its sound.
  const [ta, tb, tc] = ['A', 'B', 'C'].map((n) => r.project.tracks.find((t) => t.name === n)!)
  expect([ta.hidden, tb.hidden, tc.hidden]).toEqual([true, true, true])
  expect([ta.muted, tb.muted, tc.muted]).toEqual([false, true, true])
  // New track is above the angles.
  expect(r.project.tracks.findIndex((t) => t.name === 'Multicam')).toBeLessThan(r.project.tracks.findIndex((t) => t.name === 'A'))
})

test('too few angles or no overlap changes nothing', () => {
  const { p, clips } = rig()
  expect(multicamCut(p, [clips[0].id], 4).project).toBe(p)
  const apart = ops.moveClip(p, clips[1].id, p.tracks[1].id, 100)
  expect(multicamCut(apart, clips.map((c) => c.id), 4).pieces).toBe(0)
})
