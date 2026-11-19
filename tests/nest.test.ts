import { expect, test } from 'vitest'
import { applyNest, planNest, unnest } from '../src/shared/timeline/nest'
import { clipFromAsset, makeTrack, textClip } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import type { MediaAsset, Project } from '../src/shared/types'

const vid = (id: string, d: number): MediaAsset => ({ id, path: `/${id}.mp4`, name: `${id}.mp4`, kind: 'video', duration: d, width: 1920, height: 1080, fps: 30, hasAudio: true, sizeBytes: 1 })
const rendered: MediaAsset = { ...vid('nested1', 6), path: '/nested1.mp4' }

function rig() {
  const v = makeTrack('video', 'V1'), t = makeTrack('text', 'T1'), a = makeTrack('audio', 'A1')
  const [m1, m2, m3] = [vid('a', 8), vid('b', 8), vid('c', 8)]
  let p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [m1, m2, m3], tracks: [t, v, a] }
  const c1 = clipFromAsset(m1, 2), c2 = clipFromAsset(m2, 2 + c1.duration), c3 = clipFromAsset(m3, 20)
  const title = textClip(3, { content: 'Hi' }, 2)
  p = [[v.id, c1], [v.id, c2], [v.id, c3], [t.id, title]].reduce((acc, [id, c]) => ops.addClip(acc, id as string, c as never), p)
  return { p, v, t, c1, c2, c3, title }
}

test('nesting plans the range, a sub-project starting at zero, and the track', () => {
  const { p, v, c1, c2, title } = rig()
  const r = planNest(p, [c1.id, c2.id, title.id])
  expect(r.ok).toBe(true)
  if (!r.ok) return
  expect(r.plan.t0).toBe(2)
  expect(r.plan.duration).toBeCloseTo(c1.duration + c2.duration, 6)
  expect(r.plan.hasPicture).toBe(true)
  expect(r.plan.trackId).toBe(v.id) // the picture track
  const starts = r.plan.sub.tracks.flatMap((t) => t.clips.map((c) => c.start)).sort((a, b) => a - b)
  expect(starts[0]).toBe(0)
  expect(r.plan.sub.media.map((m) => m.id).sort()).toEqual(['a', 'b'])
  expect(r.plan.sub.tracks.flatMap((t) => t.clips)).toHaveLength(3) // other clips on those tracks are not included
  expect(planNest(p, []).ok).toBe(false)
})

test('nesting replaces the clips with one, and unnesting puts back exactly the same clips', () => {
  const { p, c1, c2, c3, title } = rig()
  const r = planNest(p, [c1.id, c2.id, title.id])
  if (!r.ok) throw new Error('plan')
  const { project: nested, clipId } = applyNest(p, r.plan, rendered)
  const all = nested.tracks.flatMap((t) => t.clips)
  expect(all.map((c) => c.id).sort()).toEqual([c3.id, clipId].sort()) // only the untouched clip and the nested one remain
  const clip = all.find((c) => c.id === clipId)!
  expect(clip.start).toBe(2)
  expect(clip.duration).toBeCloseTo(r.plan.duration, 6)
  expect(nested.media.find((m) => m.id === 'nested1')?.nested?.tracks.flatMap((t) => t.clips)).toHaveLength(3)
  const back = unnest(nested, clipId)!
  const restored = back.project.tracks.flatMap((t) => t.clips)
  expect(restored.map((c) => c.id).sort()).toEqual([c1.id, c2.id, c3.id, title.id].sort())
  for (const o of [c1, c2, title]) expect(restored.find((c) => c.id === o.id)).toEqual(o)
  expect(back.project.media.some((m) => m.id === 'nested1')).toBe(false) // the rendered file is no longer used
})

test('moving the nested clip moves the restored group with it', () => {
  const { p, c1, c2 } = rig()
  const r = planNest(p, [c1.id, c2.id])
  if (!r.ok) throw new Error('plan')
  const { project: nested, clipId } = applyNest(p, r.plan, rendered)
  const moved = ops.updateClip(nested, clipId, { start: 30 })
  const back = unnest(moved, clipId)!
  const restored = back.project.tracks.flatMap((t) => t.clips).filter((c) => c.id === c1.id || c.id === c2.id).sort((a, b) => a.start - b.start)
  expect(restored[0].start).toBeCloseTo(30, 6)
  expect(restored[1].start).toBeCloseTo(30 + c1.duration, 6)
})

test('a group with only text has no picture, so it is blended with Screen; nested clips cannot be nested again', () => {
  const { p, title } = rig()
  const r = planNest(p, [title.id])
  if (!r.ok) throw new Error('plan')
  expect(r.plan.hasPicture).toBe(false)
  const { project: nested, clipId } = applyNest(p, r.plan, rendered)
  expect(ops.findClip(nested, clipId)!.clip.blend).toBe('screen')
  const again = planNest(nested, [clipId])
  expect(again.ok).toBe(false)
  expect(unnest(nested, 'nope')).toBeNull()
})

test('a locked track gets a new track instead of being written to', () => {
  const { p, v, c1, c2 } = rig()
  const r = planNest(p, [c1.id, c2.id])
  if (!r.ok) throw new Error('plan')
  const { project: nested, clipId } = applyNest(p, r.plan, rendered)
  const locked = ops.updateTrack(nested, v.id, { locked: true })
  const back = unnest(locked, clipId)!
  expect(back.project.tracks.find((t) => t.id === v.id)!.clips.map((c) => c.id)).not.toContain(c1.id)
  expect(back.project.tracks.flatMap((t) => t.clips).filter((c) => c.id === c1.id || c.id === c2.id)).toHaveLength(2)
})
