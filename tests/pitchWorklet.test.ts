import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

type Processor = { process(i: Float32Array[][], o: Float32Array[][], p: Record<string, Float32Array>): boolean }

/** Loads the real worklet source with stand-ins for the worklet globals, the way the browser would. */
function makeProcessor(): Processor {
  const registered: Record<string, new () => Processor> = {}
  const source = readFileSync(join(__dirname, '../src/renderer/src/engine/pitchWorklet.js'), 'utf8')
  new Function('AudioWorkletProcessor', 'registerProcessor', source)(class {}, (name: string, c: new () => Processor) => (registered[name] = c))
  return new registered['vlcut-pitch']()
}

/** Frequency of a signal, from its rising zero crossings. */
function frequency(x: Float32Array, rate: number): number {
  const crossings: number[] = []
  for (let i = 1; i < x.length; i++) if (x[i - 1] <= 0 && x[i] > 0) crossings.push(i - x[i] / (x[i] - x[i - 1]))
  return ((crossings.length - 1) * rate) / (crossings[crossings.length - 1] - crossings[0])
}

function run(semitones: number, hz: number, seconds = 1, rate = 48000): { out: Float32Array; peakIn: number } {
  const p = makeProcessor()
  const n = Math.floor(rate * seconds)
  const out = new Float32Array(n)
  const params = { semitones: new Float32Array([semitones]) }
  for (let at = 0; at < n; at += 128) {
    const block = new Float32Array(128).map((_, i) => 0.5 * Math.sin((2 * Math.PI * hz * (at + i)) / rate))
    const o = [new Float32Array(128), new Float32Array(128)]
    p.process([[block, block]], [o], params)
    out.set(o[0], at)
  }
  return { out, peakIn: 0.5 }
}

test('shifting up and down moves the pitch by the right ratio', () => {
  for (const s of [3, 7, 12, -5, -12]) {
    const { out } = run(s, 440)
    const measured = frequency(out.slice(12000), 48000)
    const wanted = 440 * 2 ** (s / 12)
    expect(Math.abs(measured / wanted - 1), `${s} semitones: ${measured.toFixed(1)} Hz, wanted ${wanted.toFixed(1)}`).toBeLessThan(0.05)
  }
})

test('zero semitones keeps the pitch, and the level stays about the same without dropouts', () => {
  const { out } = run(0, 440)
  expect(Math.abs(frequency(out.slice(12000), 48000) / 440 - 1)).toBeLessThan(0.01)
  for (const s of [0, 4, -7]) {
    const o = run(s, 300).out.slice(14000)
    let peak = 0
    for (const v of o) peak = Math.max(peak, Math.abs(v))
    expect(peak, `${s} peak`).toBeGreaterThan(0.4)
    expect(peak, `${s} peak`).toBeLessThan(0.62)
    // No dropouts: every 10 ms stretch has signal.
    for (let at = 0; at + 480 < o.length; at += 480) expect(Math.max(...o.slice(at, at + 480).map(Math.abs)), `${s} dropout at ${at}`).toBeGreaterThan(0.1)
  }
})

test('mono input works and silence stays silent', () => {
  const p = makeProcessor()
  const o = [new Float32Array(128), new Float32Array(128)]
  p.process([[new Float32Array(128)]], [o], { semitones: new Float32Array([5]) })
  expect(Math.max(...o[0].map(Math.abs))).toBe(0)
  p.process([[]], [o], { semitones: new Float32Array([5]) }) // nothing connected
  expect(p.process([[new Float32Array(128).fill(0.3)]], [o], { semitones: new Float32Array([0]) })).toBe(true)
})
