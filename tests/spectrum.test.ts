import { expect, test } from 'vitest'
import { bandEdges, spectrumOf } from '../src/shared/analysis/spectrum'

const RATE = 22050
const sine = (hz: number, seconds: number, amp = 0.5): Float32Array => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE))

test('a pure tone lights up the band that contains its frequency', () => {
  const s = spectrumOf(sine(1000, 1), RATE, 30, 48)
  expect(s.bands).toBe(48)
  expect(s.data.length).toBe(30 * 48)
  const edges = bandEdges(48, RATE)
  const bin = Math.round(1000 / (RATE / 1024))
  const expected = edges.findIndex((e, i) => i < 48 && bin >= e && bin < edges[i + 1])
  const frame = Array.from(s.data.slice(15 * 48, 16 * 48))
  expect(frame.indexOf(Math.max(...frame))).toBe(expected)
  expect(Math.max(...frame)).toBeGreaterThan(180)
  // Far-away bands stay quiet.
  expect(frame[0]).toBeLessThan(60)
  expect(frame[47]).toBeLessThan(60)
})

test('silence is dark, loud is brighter than quiet, and low tones land in low bands', () => {
  const quiet = spectrumOf(sine(440, 1, 0.01), RATE)
  const loud = spectrumOf(sine(440, 1, 0.8), RATE)
  const silent = spectrumOf(new Float32Array(RATE), RATE)
  expect(Math.max(...silent.data)).toBe(0)
  expect(Math.max(...loud.data)).toBeGreaterThan(Math.max(...quiet.data) + 50)
  const peakBand = (hz: number): number => { const f = Array.from(spectrumOf(sine(hz, 1), RATE).data.slice(15 * 48, 16 * 48)); return f.indexOf(Math.max(...f)) }
  expect(peakBand(100)).toBeLessThan(peakBand(1000))
  expect(peakBand(1000)).toBeLessThan(peakBand(8000))
})

test('bands are in order and every band has at least one bin', () => {
  const edges = bandEdges(64, RATE)
  expect(edges).toHaveLength(65)
  edges.slice(1).forEach((e, i) => expect(e).toBeGreaterThan(edges[i]))
})
