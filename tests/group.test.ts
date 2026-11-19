import { expect, test } from 'vitest'
import { applyGroupOp, boundsOf, withValues } from '../src/shared/timeline/group'
import { clipFromAsset } from '../src/shared/timeline/model'
import type { MediaAsset } from '../src/shared/types'

const centre = { x: 0, y: 0 }

test('the group box is the smallest upright box around turned rectangles', () => {
  expect(boundsOf([])).toBeNull()
  const b = boundsOf([{ cx: 100, cy: 100, w: 40, h: 20, rotation: 0 }, { cx: 300, cy: 200, w: 40, h: 20, rotation: 0 }])!
  expect(b).toMatchObject({ cx: 200, cy: 150, w: 240, h: 120 })
  const turned = boundsOf([{ cx: 0, cy: 0, w: 100, h: 20, rotation: 90 }])!
  expect(turned.w).toBeCloseTo(20, 5)
  expect(turned.h).toBeCloseTo(100, 5)
})

test('growing a group scales positions about its centre and sizes together', () => {
  const a = applyGroupOp({ x: 0.2, y: 0.1, scale: 1, rotation: 0 }, { factor: 2 }, centre, 16 / 9)
  expect(a).toMatchObject({ x: 0.4, y: 0.2, scale: 2 })
  const b = applyGroupOp({ x: 0.3, y: 0.3, scale: 0.5, rotation: 10 }, { factor: 0.5 }, { x: 0.1, y: 0.1 }, 1)
  expect(b.x).toBeCloseTo(0.2, 6)
  expect(b.y).toBeCloseTo(0.2, 6)
  expect(b.scale).toBeCloseTo(0.25, 6)
  expect(b.rotation).toBe(10)
})

test('turning a group moves positions on a circle in pixel space and adds to each rotation', () => {
  // A clip a quarter frame-width to the right turns 90 degrees to a quarter frame-width below (in pixels), whatever the aspect.
  const aspect = 2
  const r = applyGroupOp({ x: 0.25, y: 0, scale: 1, rotation: 5 }, { degrees: 90 }, centre, aspect)
  expect(r.x).toBeCloseTo(0, 6)
  expect(r.y).toBeCloseTo(0.25 * aspect, 6) // 0.25 of the width, as a fraction of the height
  expect(r.rotation).toBe(95)
  // Distance from the centre in pixels is kept at any angle.
  for (const deg of [15, 40, 133, -70]) {
    const o = applyGroupOp({ x: 0.3, y: 0.1, scale: 1, rotation: 0 }, { degrees: deg }, centre, aspect)
    expect(Math.hypot(o.x, o.y / aspect)).toBeCloseTo(Math.hypot(0.3, 0.1 / aspect), 6)
  }
})

test('sliding adds the same offset to every clip, and the operations compose from the start values, not the last ones', () => {
  const s = { x: 0.1, y: -0.2, scale: 1, rotation: 0 }
  const slid = applyGroupOp(s, { dx: 0.05, dy: 0.1 }, centre, 1)
  expect(slid.x).toBeCloseTo(0.15, 9)
  expect(slid.y).toBeCloseTo(-0.1, 9)
  const once = applyGroupOp(s, { factor: 1.5 }, centre, 1)
  const again = applyGroupOp(s, { factor: 1.5 }, centre, 1)
  expect(again).toEqual(once) // repeated moves of one drag do not compound
  expect(applyGroupOp(s, {}, centre, 1)).toEqual(s)
})

test('values go into keyframes when the property is animated and into the transform otherwise', () => {
  const asset: MediaAsset = { id: 'v', path: '/v.mp4', name: 'v', kind: 'video', duration: 10, width: 1920, height: 1080, hasAudio: false, sizeBytes: 1 }
  const clip = { ...clipFromAsset(asset, 0), keyframes: { x: [{ t: 0, value: 0, easing: 'linear' as const }] } }
  const r = withValues(clip, { x: 0.3, y: 0.2 }, 4)
  expect(r.keyframes.x).toHaveLength(2)
  expect(r.keyframes.x!.some((k) => k.t === 4 && k.value === 0.3)).toBe(true)
  expect(r.transform.y).toBe(0.2)
  expect(r.transform.x).toBe(clip.transform.x) // an animated property's base value is left alone
})
