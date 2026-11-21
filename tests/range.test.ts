import { expect, test } from 'vitest'
import { sliceProject } from '../src/shared/timeline/range'
import { clipFromAsset, makeTrack, textClip } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import type { MediaAsset, Project } from '../src/shared/types'

const asset: MediaAsset = { id: 'v', path: '/v.mp4', name: 'v.mp4', kind: 'video', duration: 30, width: 1920, height: 1080, fps: 30, hasAudio: true, sizeBytes: 1 }
function rig() {
  const v = makeTrack('video', 'V1'), t = makeTrack('text', 'T1')
  let p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [asset], tracks: [t, v] }
  const c1 = { ...clipFromAsset(asset, 0), duration: 10 }
  const c2 = { ...clipFromAsset(asset, 10), duration: 10, sourceIn: 5 }
  p = ops.addClip(ops.addClip(p, v.id, c1), v.id, c2)
  p = ops.addClip(p, t.id, textClip(4, { content: 'hi' }, 3))
  return { p, c1, c2 }
}
const all = (p: Project) => p.tracks.flatMap((t) => t.clips)

test('only the part between the marks remains, starting at zero, with the right footage', () => {
  const { p, c1, c2 } = rig()
  const s = sliceProject(p, 6, 14) // 4 s of the first clip, 4 s of the second
  expect(ops.projectDuration(s)).toBeCloseTo(8, 6)
  const clips = all(s).filter((c) => c.assetId).sort((a, b) => a.start - b.start)
  expect(clips.map((c) => [c.start, c.duration])).toEqual([[0, 4], [4, 4]])
  expect(clips[0].sourceIn).toBeCloseTo(6, 6) // the first clip's footage from 6 s on
  expect(clips[1].sourceIn).toBeCloseTo(5, 6) // the second still starts at its own beginning
  expect(c1.sourceIn).toBe(0); void c2
  // The title (4 s to 7 s) is inside and keeps its place relative to the start.
  expect(all(s).find((c) => c.text)!.start).toBeCloseTo(0, 6)
})

test('speed, a trim at both ends and clips outside the marks are handled', () => {
  const { p } = rig()
  const fast = ops.updateClip(p, all(p).find((c) => c.assetId)!.id, { speed: 2, duration: 5 })
  const s = sliceProject(fast, 1, 3)
  const first = all(s).filter((c) => c.assetId).sort((a, b) => a.start - b.start)[0]
  expect(first.duration).toBeCloseTo(2, 6)
  expect(first.sourceIn).toBeCloseTo(2, 6) // 1 s into a 2x clip is 2 s into the footage
  const middle = sliceProject(p, 12, 13)
  expect(all(middle).filter((c) => c.assetId)).toHaveLength(1)
  expect(all(middle).some((c) => c.text)).toBe(false)
  expect(ops.projectDuration(middle)).toBeCloseTo(1, 6)
  // A mark outside the timeline, or reversed marks, are limited sensibly; an empty region leaves the project alone.
  expect(ops.projectDuration(sliceProject(p, -5, 5))).toBeCloseTo(5, 6)
  expect(ops.projectDuration(sliceProject(p, 14, 6))).toBeCloseTo(8, 6)
  expect(sliceProject(p, 5, 5)).toBe(p)
})
