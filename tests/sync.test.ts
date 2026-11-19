import { expect, test } from 'vitest'
import { syncOffset } from '../src/shared/analysis/sync'

const RATE = 8000
/** Speech-like test sound: random bursts with some tonal content. */
function sound(seconds: number, seed: number): Float32Array {
  let s = seed
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = (rnd() * 2 - 1) * (0.4 + 0.6 * Math.abs(Math.sin(i / 900))) + 0.3 * Math.sin(i * (0.02 + seed * 0.0007 + 0.01 * Math.sin(i / (3000 + seed * 37))) + seed)
  return out
}
const shift = (x: Float32Array, seconds: number, total: number): Float32Array => {
  const out = new Float32Array(Math.round(total * RATE))
  const k = Math.round(seconds * RATE)
  for (let i = 0; i < out.length; i++) out[i] = x[i + k] ?? 0
  return out
}

test('finds how far apart two recordings of the same sound are', () => {
  const a = sound(20, 7)
  // b started 1.37 s later than a, so an event at x in a is at x - 1.37 in b.
  const b = shift(a, 1.37, 18)
  const r = syncOffset(a, b, RATE)
  expect(r.lag).toBeCloseTo(1.37, 2)
  expect(r.confidence).toBeGreaterThan(15)
  // And the other way round.
  expect(syncOffset(b, a, RATE).lag).toBeCloseTo(-1.37, 2)
})

test('still works with a different microphone: other level, added noise, other tone colour', () => {
  const a = sound(20, 11)
  const b = shift(a, -2.5, 20).map((v, i) => v * 0.3 + 0.05 * Math.sin(i * 0.9) + 0.08 * (((i * 2654435761) >>> 0) / 4294967296 - 0.5))
  const r = syncOffset(a, Float32Array.from(b), RATE)
  expect(r.lag).toBeCloseTo(-2.5, 2)
  expect(r.confidence).toBeGreaterThan(10)
})

test('unrelated recordings are reported as a weak match', () => {
  const r = syncOffset(sound(20, 1), sound(20, 99), RATE)
  expect(r.confidence).toBeLessThan(8)
})
