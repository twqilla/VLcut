import { expect, test } from 'vitest'
import type { MediaAsset, Project } from '../src/shared/types'
import { clipFromAsset, makeTrack, normalizeProject } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import { propAt, sampleKeyframes, upsertKeyframe, fadeAt } from '../src/shared/timeline/keyframes'

const asset: MediaAsset = { id: 'a', path: '/a.mp4', name: 'a.mp4', kind: 'video', duration: 10, hasAudio: true, sizeBytes: 1 }

function fixture(): { project: Project; clipId: string; trackId: string } {
  const track = makeTrack('video', 'V1')
  const base: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [asset], tracks: [track, makeTrack('video', 'V2'), makeTrack('audio', 'A1')] }
  const clip = clipFromAsset(asset, 0)
  return { project: ops.addClip(base, track.id, clip), clipId: clip.id, trackId: track.id }
}

test('split keeps total duration and source continuity', () => {
  const { project, clipId } = fixture()
  const split = ops.splitClip(project, clipId, 4)
  const [a, b] = split.tracks[0].clips
  expect([a.duration, b.start, b.duration, b.sourceIn]).toEqual([4, 4, 6, 4])
  expect(project.tracks[0].clips).toHaveLength(1) // input untouched
  expect(ops.splitClip(project, clipId, 0)).toBe(project)
})

test('split of a reversed clip keeps the right source ranges', () => {
  const { project, clipId } = fixture()
  const reversed = ops.updateClip(project, clipId, { reversed: true })
  const [a, b] = ops.splitClip(reversed, clipId, 4).tracks[0].clips
  expect(ops.sourceTime(a, 0)).toBe(10)
  expect(ops.sourceTime(a, 4)).toBeCloseTo(ops.sourceTime(b, 4))
  expect(ops.sourceTime(b, 10)).toBe(0)
})

test('trim is limited by available source and neighbours', () => {
  const { project, clipId } = fixture()
  let p = ops.trimClipStart(project, clipId, 2)
  expect(ops.findClip(p, clipId)!.clip).toMatchObject({ start: 2, duration: 8, sourceIn: 2 })
  p = ops.trimClipStart(p, clipId, -5) // cannot reveal source before 0
  expect(ops.findClip(p, clipId)!.clip).toMatchObject({ start: 0, sourceIn: 0 })
  p = ops.trimClipEnd(p, clipId, 99) // cannot extend past the end of the file
  expect(ops.findClip(p, clipId)!.clip.duration).toBe(10)
  p = ops.trimClipEnd(p, clipId, 3)
  expect(ops.findClip(p, clipId)!.clip.duration).toBe(3)
})

test('clips never overlap on a track', () => {
  const { project, trackId } = fixture()
  const p = ops.addClip(project, trackId, clipFromAsset(asset, 5))
  expect(p.tracks[0].clips[1].start).toBe(10)
  const moved = ops.moveClip(p, p.tracks[0].clips[1].id, trackId, 3)
  expect(moved.tracks[0].clips.find((c) => c.id === p.tracks[0].clips[1].id)!.start).toBe(10)
})

test('move across tracks only between same kinds', () => {
  const { project, clipId } = fixture()
  const moved = ops.moveClip(project, clipId, project.tracks[1].id, 2)
  expect(moved.tracks[0].clips).toHaveLength(0)
  expect(moved.tracks[1].clips[0].start).toBe(2)
  expect(ops.moveClip(project, clipId, project.tracks[2].id, 2)).toBe(project)
})

test('cutRange ripples later material left', () => {
  const { project } = fixture()
  const cut = ops.cutRange(project, 2, 5)
  const clips = [...cut.tracks[0].clips].sort((a, b) => a.start - b.start)
  expect(clips.map((c) => [c.start, c.duration, c.sourceIn])).toEqual([[0, 2, 0], [2, 5, 5]])
  expect(ops.projectDuration(cut)).toBe(7)
})

test('speed change keeps the source range', () => {
  const { project, clipId } = fixture()
  const fast = ops.setClipSpeed(project, clipId, 2)
  const clip = ops.findClip(fast, clipId)!.clip
  expect(clip.duration).toBe(5)
  expect(ops.sourceTime(clip, 5)).toBe(10)
})

test('duplicate, copy and paste', () => {
  const { project, clipId } = fixture()
  const dup = ops.duplicateClips(project, new Set([clipId]))
  expect(dup.project.tracks[0].clips).toHaveLength(2)
  expect(ops.findClip(dup.project, dup.ids[0])!.clip.start).toBe(10)
  const pasted = ops.pasteClips(project, ops.copyClips(project, new Set([clipId])), 20)
  expect(ops.findClip(pasted.project, pasted.ids[0])!.clip.start).toBe(20)
})

test('keyframes interpolate and survive a split', () => {
  expect(sampleKeyframes([{ t: 0, value: 0, easing: 'linear' }, { t: 2, value: 10, easing: 'linear' }], 1)).toBe(5)
  expect(sampleKeyframes([{ t: 0, value: 0, easing: 'hold' }, { t: 2, value: 10, easing: 'linear' }], 1.9)).toBe(0)
  const { project, clipId } = fixture()
  const kfs = upsertKeyframe(upsertKeyframe(undefined, { t: 0, value: 1, easing: 'linear' }), { t: 10, value: 2, easing: 'linear' })
  const p = ops.updateClip(project, clipId, { keyframes: { scale: kfs } })
  expect(propAt(ops.findClip(p, clipId)!.clip, 'scale', 5)).toBe(1.5)
  expect(propAt(ops.findClip(p, clipId)!.clip, 'opacity', 5)).toBe(1)
})

test('fades, snapping and track operations', () => {
  const { project, clipId } = fixture()
  const clip = { ...ops.findClip(project, clipId)!.clip, fadeIn: 2, fadeOut: 2 }
  expect([fadeAt(clip, 1), fadeAt(clip, 5), fadeAt(clip, 9)]).toEqual([0.5, 1, 0.5])
  expect(ops.snapTime(4.95, [0, 5, 10], 0.1)).toBe(5)
  expect(ops.snapTime(4.5, [0, 5, 10], 0.1)).toBe(4.5)
  expect(ops.snapToFrame(1.01, 30)).toBeCloseTo(1)
  const withTrack = ops.addTrack(project, 'text')
  expect(withTrack.tracks[0].kind).toBe('text')
  expect(ops.moveTrack(withTrack, withTrack.tracks[0].id, 2).tracks[2].kind).toBe('text')
  expect(ops.removeTrack(withTrack, withTrack.tracks[0].id).tracks).toHaveLength(3)
})

test('normalizeProject upgrades Phase 1 project files', () => {
  const old = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1, height: 1, fps: 30 }, media: [], tracks: [{ id: 't', kind: 'video', name: 'V', clips: [{ id: 'c', assetId: 'a', start: 1, sourceIn: 0, duration: 2 }] }] } as unknown as Project
  const p = normalizeProject(old)
  expect(p.tracks[0]).toMatchObject({ muted: false, height: 56 })
  expect(p.tracks[0].clips[0]).toMatchObject({ id: 'c', speed: 1, opacity: 1, effects: [] })
})

test('rampSpeed plays the same footage with smoothly changing speed', () => {
  const { project, clipId, trackId } = fixture()
  const withNext = ops.addClip(project, trackId, clipFromAsset(asset, 10))
  const ramped = ops.rampSpeed(withNext, clipId, 1, 4, 8)
  expect(ops.rampSpeed(withNext, clipId, 1, 4).tracks[0].clips).toHaveLength(17) // sixteen pieces by default
  const clips = [...ramped.tracks[0].clips].sort((a, b) => a.start - b.start)
  expect(clips).toHaveLength(9)
  const pieces = clips.slice(0, 8)
  expect(pieces.reduce((sum, c) => sum + c.duration * c.speed, 0)).toBeCloseTo(10) // all 10 s of source
  expect(pieces[0].speed).toBe(1)
  expect(pieces[7].speed).toBe(4)
  for (let i = 1; i < 8; i++) {
    expect(pieces[i].start).toBeCloseTo(ops.clipEnd(pieces[i - 1]))
    expect(pieces[i].sourceIn).toBeCloseTo(ops.sourceTime(pieces[i - 1], ops.clipEnd(pieces[i - 1])))
    expect(pieces[i].speed).toBeGreaterThan(pieces[i - 1].speed)
  }
  expect(clips[8].start).toBeCloseTo(ops.clipEnd(pieces[7])) // the next clip moved up to stay adjoined
  expect(ops.clipEnd(pieces[7])).toBeLessThan(10)
  expect(ops.rampSpeed(ops.updateClip(project, clipId, { reversed: true }), clipId, 1, 2)).toMatchObject({ tracks: [{ clips: [{ reversed: true }] }, {}, {}] })
})

test('split screen crops and places clips to fill their cells exactly', async () => {
  const { cellsFor, fitToCell, splitScreen } = await import('../src/shared/timeline/layout')
  // A 16:9 source in the left half of a 16:9 frame: crop the sides, fill the half.
  const left = fitToCell(16 / 9, 16 / 9, cellsFor('left-right', 2)[0])
  expect(left.crop.left).toBeCloseTo(0.25)
  expect(left.crop.top).toBe(0)
  expect(left.transform).toMatchObject({ x: -0.25, y: 0 })
  expect(left.transform.scale).toBeCloseTo(1) // half-width picture, already full height
  // Top half: crop top and bottom instead.
  const top = fitToCell(16 / 9, 16 / 9, cellsFor('top-bottom', 2)[0])
  expect(top.crop.top).toBeCloseTo(0.25)
  expect(top.transform).toMatchObject({ x: 0, y: -0.25 })
  expect(top.transform.scale).toBeCloseTo(1)
  // Four clips in a grid: no crop needed, each at half size.
  const cell = fitToCell(16 / 9, 16 / 9, cellsFor('grid', 4)[3])
  expect(cell.crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  expect(cell.transform).toMatchObject({ x: 0.25, y: 0.25, scale: 0.5 })

  const { project, clipId } = fixture()
  const second = clipFromAsset({ ...asset, width: 1920, height: 1080 }, 0)
  const two = ops.addClip(project, project.tracks[1].id, second)
  const done = splitScreen({ ...two, media: [{ ...asset, width: 1920, height: 1080 }] }, [clipId, second.id], 'left-right')
  expect(ops.findClip(done, clipId)!.clip.transform.x).toBe(-0.25)
  expect(ops.findClip(done, second.id)!.clip.transform.x).toBe(0.25)
  expect(splitScreen(two, [clipId], 'left-right')).toBe(two) // needs at least two clips
})


test('a clip can be pointed at a blurred copy and sent back to the original', async () => {
  const { blurRangeFor, swapInBlurred, removeBlur, sourceOf, BLUR_MARGIN } = await import('../src/shared/timeline/blur')
  const { DEFAULT_INTERPOLINI } = await import('../src/shared/render/interpolini')
  const original: MediaAsset = { ...asset, id: 'orig', fps: 30, duration: 10 }
  const { project, clipId } = fixture()
  let p: Project = { ...project, media: [original] }
  p = ops.updateClip(p, clipId, { sourceIn: 4, duration: 2, speed: 1, assetId: 'orig' })
  const clip = ops.findClip(p, clipId)!.clip

  // The part that gets blurred is the used part plus a margin, on a frame boundary.
  const range = blurRangeFor(original, 4, clip)
  expect(range.start).toBeCloseTo(4 - BLUR_MARGIN, 2)
  expect(range.end).toBeCloseTo(6 + BLUR_MARGIN, 2)
  expect(blurRangeFor(original, 0.2, clip).start).toBe(0) // never before the start of the file
  expect(blurRangeFor(original, 9, { duration: 3, speed: 1 }).end).toBe(10) // nor past its end
  expect(blurRangeFor(original, 4, { duration: 2, speed: 2 }).end).toBeCloseTo(8 + BLUR_MARGIN, 2) // speed uses more footage

  const blurred: MediaAsset = { ...original, id: 'blur1', name: 'a · blurred', path: '/cache/b.mp4', duration: 3, blurredFrom: { assetId: 'orig', start: range.start, end: range.end, settings: DEFAULT_INTERPOLINI, blendFps: 30 } }
  const swapped = swapInBlurred(p, clipId, blurred)
  const after = ops.findClip(swapped, clipId)!.clip
  expect(after.assetId).toBe('blur1')
  expect(after.sourceIn).toBeCloseTo(4 - range.start) // the same moment, now measured inside the copy
  expect(swapped.media.map((m) => m.id)).toEqual(['orig', 'blur1']) // the original stays
  expect(ops.findClip(swapped, clipId)!.clip.start).toBe(clip.start)
  expect(sourceOf(swapped, after)).toMatchObject({ sourceIn: 4, asset: { id: 'orig' } })

  // Back to the original puts everything exactly where it was.
  const back = ops.findClip(removeBlur(swapped, clipId), clipId)!.clip
  expect(back).toMatchObject({ assetId: 'orig', sourceIn: 4, duration: 2 })
  // Re-blurring a blurred clip starts from the original, not from the copy.
  const blurred2: MediaAsset = { ...blurred, id: 'blur2', blurredFrom: { ...blurred.blurredFrom!, start: 3.5, end: 7, settings: { ...DEFAULT_INTERPOLINI, intensity: 2 } } }
  const twice = swapInBlurred(swapped, clipId, blurred2)
  expect(ops.findClip(twice, clipId)!.clip).toMatchObject({ assetId: 'blur2', sourceIn: 0.5 })
  expect(sourceOf(twice, ops.findClip(twice, clipId)!.clip)!.sourceIn).toBe(4)
  // A clip that is not blurred is left alone by removeBlur, and a copy whose original is gone cannot be reverted.
  expect(removeBlur(p, clipId)).toEqual(p)
  expect(removeBlur({ ...swapped, media: [blurred] }, clipId).tracks[0].clips.find((c) => c.id === clipId)!.assetId).toBe('blur1')
})

test('freeze frame cuts the clip, holds the exact frame and moves later clips along', () => {
  const { project, clipId, trackId } = fixture()
  const later = clipFromAsset(asset, 10)
  const withLater = ops.addClip(project, trackId, later)
  const frozen = ops.freezeFrame(withLater, clipId, 4, 2)
  const clips = [...frozen.tracks[0].clips].sort((a, b) => a.start - b.start)
  expect(clips).toHaveLength(4)
  const [before, still, after, last] = clips
  expect([before.start, before.duration]).toEqual([0, 4])
  expect(still).toMatchObject({ start: 4, duration: 2, freeze: true, muted: true, speed: 1 })
  expect(ops.sourceTime(still, 4)).toBe(4)
  expect(ops.sourceTime(still, 5.9)).toBe(4) // the same frame all the way through
  expect(after.start).toBe(6)
  expect(after.sourceIn).toBe(4) // footage carries on from where it was held
  expect(last.start).toBe(12) // later clips shifted by the hold
  expect(ops.freezeFrame(withLater, clipId, 0, 2)).toBe(withLater) // nothing to freeze at the very start
  // Reversed clips freeze on the frame that was actually showing.
  const rev = ops.updateClip(project, clipId, { reversed: true })
  const f2 = ops.freezeFrame(rev, clipId, 2, 1).tracks[0].clips.find((c) => c.freeze)!
  expect(f2.sourceIn).toBeCloseTo(8, 5)
})

test('speed ramp shapes: bell goes slow in the middle and returns, steady is monotonic', () => {
  const { project, clipId } = fixture()
  const bell = ops.rampSpeed(project, clipId, 1, 0.25, 16, 'bell').tracks[0].clips
  const speeds = bell.map((c) => c.speed)
  expect(speeds[0]).toBeCloseTo(1, 2)
  expect(speeds[speeds.length - 1]).toBeCloseTo(1, 2)
  expect(Math.min(...speeds)).toBeLessThan(0.35)
  expect(speeds.indexOf(Math.min(...speeds))).toBeGreaterThan(5)
  // The same footage plays: total source span is unchanged.
  expect(bell.reduce((a, c) => a + c.duration * c.speed, 0)).toBeCloseTo(10, 5)
  const steady = ops.rampSpeed(project, clipId, 1, 3, 16).tracks[0].clips.map((c) => c.speed)
  expect(steady.every((v, i) => i === 0 || v >= steady[i - 1])).toBe(true)
  const easeIn = ops.rampSpeed(project, clipId, 1, 3, 16, 'easeIn').tracks[0].clips.map((c) => c.speed)
  expect(easeIn[8]).toBeLessThan(steady[8]) // eases in: still slow around the middle
})

test('custom Bézier easing matches the standard curves and can overshoot', async () => {
  const { cubicBezier } = await import('../src/shared/timeline/keyframes')
  // CSS "ease-in-out" (0.42, 0, 0.58, 1) is symmetric and slow at both ends.
  expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 3)
  expect(cubicBezier(0.42, 0, 0.58, 1, 0.1)).toBeLessThan(0.1)
  expect(cubicBezier(0, 0, 1, 1, 0.3)).toBeCloseTo(0.3, 4) // straight line
  expect(cubicBezier(0.3, 1.6, 0.7, 1.6, 0.6)).toBeGreaterThan(1) // overshoots past the target
  expect(cubicBezier(0.3, 0, 0.7, 1, 0)).toBe(0)
  expect(cubicBezier(0.3, 0, 0.7, 1, 1)).toBe(1)
  // Used by keyframes: halfway between 0 and 100 with an ease-out curve is already past 50.
  const v = sampleKeyframes([{ t: 0, value: 0, easing: 'bezier', bezier: [0, 0, 0.58, 1] }, { t: 1, value: 100, easing: 'linear' }], 0.5)
  expect(v).toBeGreaterThan(60)
})

test('rotoscoping: polygon corners glide between keys and edits are recorded as keys', async () => {
  const { maskPointsAt, withMaskKey, withMaskPoint, withoutKeys } = await import('../src/shared/timeline/mask')
  const mask = { shape: 'polygon' as const, x: 0, y: 0, width: 1, height: 1, feather: 0, invert: false, points: [[-0.2, -0.2], [0.2, -0.2], [0, 0.2]] as [number, number][] }
  // Without keys, editing changes the plain shape.
  expect(withMaskPoint(mask, 1, 2, [0, 0.3]).points![2]).toEqual([0, 0.3])
  expect(maskPointsAt(mask, 5)).toEqual(mask.points)
  // Key the shape at 0 s, then move a corner at 2 s: that creates a second key and the corner glides.
  const k0 = withMaskKey(mask, 0)
  const k2 = withMaskPoint(k0, 2, 0, [0.2, 0.2])
  expect(k2.keys).toHaveLength(2)
  expect(maskPointsAt(k2, 0)[0]).toEqual([-0.2, -0.2])
  expect(maskPointsAt(k2, 1)[0][0]).toBeCloseTo(0, 5) // halfway between -0.2 and 0.2
  expect(maskPointsAt(k2, 1)[0][1]).toBeCloseTo(0, 5)
  expect(maskPointsAt(k2, 9)[0]).toEqual([0.2, 0.2]) // held after the last key
  expect(maskPointsAt(k2, 1)[1]).toEqual([0.2, -0.2]) // other corners did not move
  // Keys with the wrong number of corners are ignored rather than crashing.
  const extra = { ...k2, points: [...k2.points!, [0.5, 0.5] as [number, number]] }
  expect(maskPointsAt(extra, 1)).toEqual(extra.points)
  expect(withoutKeys(k2).keys).toBeUndefined()
})
