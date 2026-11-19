import { expect, test } from 'vitest'
import { decimate, estimateShift, focusPath, smooth, stabilizationOffsets, trackPoint } from '../src/shared/analysis/motion'

const W = 160
const H = 90

/** A smooth random-looking picture, sampled at any (fractional) position so it can be shifted by exact amounts. */
function field(seed: number): (x: number, y: number) => number {
  const phases = Array.from({ length: 7 }, (_, i) => [0.05 + ((i * 37 + seed * 13) % 17) * 0.017, 0.04 + ((i * 53 + seed * 7) % 19) * 0.015, (i * 1.7 + seed) % 6.28])
  return (x, y) => 128 + phases.reduce((a, [fx, fy, ph], i) => a + 18 * Math.sin(x * fx + ph) * Math.cos(y * fy + ph * 0.7 + i), 0)
}
/** Detailed texture (value noise with ~4 px features), like real footage rather than smooth gradients. */
function texture(seed: number): (x: number, y: number) => number {
  const h = (i: number, j: number): number => { let n = (i * 374761393 + j * 668265263 + seed * 2147483) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
  return (x, y) => {
    const [gx, gy] = [x / 4, y / 4]
    const [i, j] = [Math.floor(gx), Math.floor(gy)]
    const [fx, fy] = [gx - i, gy - j]
    const [u, v] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)]
    return 40 + 175 * (h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v)
  }
}
function render(f: (x: number, y: number) => number, ox: number, oy: number, blob?: { x: number; y: number }): Uint8Array {
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = f(x - ox, y - oy)
      if (blob) v += 90 * Math.exp(-((x - blob.x) ** 2 + (y - blob.y) ** 2) / 30)
      out[y * W + x] = Math.max(0, Math.min(255, v))
    }
  return out
}

test('a shift of the whole picture is measured to a fraction of a pixel', () => {
  const f = field(1)
  for (const [dx, dy] of [[3, -2], [0, 0], [-5.4, 1.5], [2.5, 4.25]]) {
    const s = estimateShift(render(f, 0, 0), render(f, dx, dy), W, H)
    expect(s.dx, `dx for ${dx},${dy}`).toBeCloseTo(dx, 0)
    expect(Math.abs(s.dx - dx)).toBeLessThan(0.35)
    expect(Math.abs(s.dy - dy)).toBeLessThan(0.35)
    expect(s.confidence).toBeGreaterThan(0.2)
  }
})

test('a large moving subject does not drag the background estimate away', () => {
  const f = field(5)
  // Background shifts by (2, -1); a big bright block sweeps across the middle at a different speed.
  const a = render(f, 0, 0)
  const b = render(f, 2, -1)
  for (let y = 25; y < 65; y++) for (let x = 50; x < 110; x++) { a[y * W + x] = 230; b[y * W + x] = 30 }
  const s = estimateShift(a, b, W, H)
  expect(Math.abs(s.dx - 2)).toBeLessThan(0.5)
  expect(Math.abs(s.dy + 1)).toBeLessThan(0.5)
})

test('stabilising a jittery pan removes the jitter but keeps the pan', () => {
  const f = field(2)
  const frames = 60
  // Camera pans steadily right (0.5 px/frame) with a random shake of +-3 px.
  const truth: [number, number][] = Array.from({ length: frames }, (_, i) => [i * 0.5 + Math.sin(i * 2.9) * 3, Math.cos(i * 3.7) * 2.5])
  const imgs = truth.map(([x, y]) => render(f, x, y))
  const shifts = imgs.slice(1).map((b, i) => estimateShift(imgs[i], b, W, H, 8))
  const offsets = stabilizationOffsets(shifts, 8)
  // After correction, the remaining wobble must be far smaller than the shake.
  const residual = truth.map(([x, y], i) => [x + offsets[i].x, y + offsets[i].y])
  const wobble = (v: number[]) => { const s = smooth(v, 6); return Math.sqrt(v.reduce((a, b, i) => a + (b - s[i]) ** 2, 0) / v.length) }
  expect(wobble(truth.map((t) => t[0]))).toBeGreaterThan(1.5)
  expect(wobble(residual.map((r) => r[0]))).toBeLessThan(0.7)
  expect(wobble(residual.map((r) => r[1]))).toBeLessThan(0.7)
  // The deliberate pan is still there: the last frame is still well to the right of the first.
  expect(residual[frames - 12][0] - residual[12][0]).toBeGreaterThan(15)
})

test('a tracked point follows a patch of picture, and gives up when the picture changes', () => {
  const f = texture(3)
  const frames = Array.from({ length: 30 }, (_, i) => render(f, i * 1.5, i * -0.8))
  const result = trackPoint(frames, W, H, { x: 70, y: 45 })
  expect(result.lostAt).toBeUndefined()
  expect(result.points).toHaveLength(30)
  const end = result.points[29]
  expect(Math.abs(end.x - (70 + 43.5))).toBeLessThan(2)
  expect(Math.abs(end.y - (45 - 23.2))).toBeLessThan(2)
  const cut = [...frames.slice(0, 5), ...Array.from({ length: 5 }, () => render(texture(99), 0, 0))]
  expect(trackPoint(cut, W, H, { x: 70, y: 45 }).lostAt).toBeGreaterThanOrEqual(5)
})

test('the focus path follows a moving subject and decimate keeps the ends', () => {
  const f = field(4)
  const frames = Array.from({ length: 40 }, (_, i) => render(f, 0, 0, { x: 30 + i * 2.5, y: 45 }))
  const path = focusPath(frames, W, H, 3)
  expect(path[5].x).toBeLessThan(path[35].x)
  expect(path[35].x).toBeGreaterThan(0.55)
  expect(path[5].x).toBeLessThan(0.45)
  const items = Array.from({ length: 100 }, (_, i) => i)
  const kept = decimate(items, 20)
  expect(kept.length).toBeLessThanOrEqual(21)
  expect(kept[0]).toBe(0)
  expect(kept[kept.length - 1]).toBe(99)
})
