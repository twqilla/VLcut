import { expect, test } from 'vitest'
import { planReframe, planStabilization, sourcePoint, trackedPositions } from '../src/shared/timeline/motion'
import { makeClip } from '../src/shared/timeline/model'

const clip = (over: object = {}) => ({ ...makeClip({ assetId: 'a', start: 0, duration: 10, sourceIn: 0 }), ...over })
const wide = { projectW: 1080, projectH: 1920, assetW: 1920, assetH: 1080 }
const same = { projectW: 1920, projectH: 1080, assetW: 1920, assetH: 1080 }

test('stabilising zooms just enough to hide the edges and shifts the right way', () => {
  const offsets = Array.from({ length: 30 }, (_, i) => ({ x: i % 2 ? 0.02 : -0.02, y: 0 }))
  const plan = planStabilization(clip(), same, offsets, 15)
  expect(plan.zoom).toBeCloseTo(1.05, 2)
  expect(plan.keyframes.x).toHaveLength(30)
  // Content that must move right by 2 % of its width is moved right by 2 % x zoom of the frame.
  expect(plan.keyframes.x[1].value).toBeCloseTo(0.02 * 1.05, 3)
  expect(plan.keyframes.x[1].t).toBeCloseTo(1 / 15, 4)
})

test('time mapping follows the clip speed and direction', () => {
  const offsets = Array.from({ length: 31 }, () => ({ x: 0.01, y: 0 }))
  const fast = planStabilization(clip({ speed: 2 }), same, offsets, 15)
  expect(fast.keyframes.x[30].t).toBeCloseTo(1, 4)
  const back = planStabilization(clip({ reversed: true, duration: 2 }), same, offsets, 15)
  expect(back.keyframes.x[0].t).toBeCloseTo(0, 4)
  expect(back.keyframes.x[back.keyframes.x.length - 1].t).toBeCloseTo(2, 4) // the first analysed frame is shown last
})

test('a huge correction is limited by the maximum zoom', () => {
  const plan = planStabilization(clip(), same, [{ x: 0.4, y: 0 }, { x: -0.4, y: 0 }], 15, 1.3)
  expect(plan.zoom).toBeCloseTo(1.3, 3)
  expect(Math.abs(plan.keyframes.x[0].value)).toBeLessThan(0.4 * 1.3)
})

test('a tracked point maps to a frame position and a click maps back to the picture', () => {
  const c = clip({ transform: { x: 0, y: 0, scale: 1, rotation: 0 } })
  const spots = trackedPositions(c, same, [{ x: 0.5, y: 0.5 }, { x: 0.75, y: 0.25 }], 10)
  expect(spots[0]).toMatchObject({ t: 0, x: 0, y: 0 })
  expect(spots[1].x).toBeCloseTo(0.25, 5)
  expect(spots[1].y).toBeCloseTo(-0.25, 5)
  const click = sourcePoint(c, same, 0.25, -0.25, 0)
  expect(click.x).toBeCloseTo(0.75, 5)
  expect(click.y).toBeCloseTo(0.25, 5)
})

test('auto reframe covers a vertical frame with a wide shot and follows the subject', () => {
  const focus = [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }]
  const plan = planReframe(clip(), wide, focus, 3)
  // A 16:9 picture needs a big scale to fill 9:16 height.
  expect(plan.scale).toBeGreaterThan(3)
  const [a, b, c] = plan.keyframes.x.map((k) => k.value)
  expect(a).toBeGreaterThan(b)
  expect(b).toBeCloseTo(0, 5)
  expect(c).toBeLessThan(b)
  // The pan never reveals an edge: the picture is always at least as wide as the frame.
  const shownW = plan.scale * 1 // a 16:9 picture fitted in a 9:16 frame is exactly one frame wide at scale 1
  expect(Math.abs(a)).toBeLessThanOrEqual((shownW - 1) / 2 + 1e-6)
})
