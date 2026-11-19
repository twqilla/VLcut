import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'
import { AUDIO_EFFECTS, audioEffectFilters, makeAudioEffect } from '../src/shared/effects/audio'
import { buildAudioGraph } from '../src/shared/render/audioGraph'
import { clipFromAsset, makeTrack } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import type { MediaAsset, Project } from '../src/shared/types'

const RATE = 48000

/** Runs `filters` over stereo float samples (interleaved L,R) and returns the result. */
function process(samples: Float32Array, filters: string[]): Float32Array {
  const input = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  const args = ['-v', 'error', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', '-', ...(filters.length ? ['-af', filters.join(',')] : []), '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-']
  const r = spawnSync('ffmpeg', args, { input, maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${filters.join(',')}: ${r.stderr}`)
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength))
}
const tone = (hz: number, seconds: number, amp = 0.3, right = amp): Float32Array => {
  const out = new Float32Array(seconds * RATE * 2)
  for (let i = 0; i < seconds * RATE; i++) {
    const s = Math.sin((2 * Math.PI * hz * i) / RATE)
    out[i * 2] = s * amp
    out[i * 2 + 1] = s * right
  }
  return out
}
const rms = (x: Float32Array, from = 0, to = x.length): number => Math.sqrt(x.slice(from, to).reduce((a, b) => a + b * b, 0) / Math.max(1, to - from))
const channel = (x: Float32Array, c: number): number[] => Array.from({ length: x.length / 2 }, (_, i) => x[i * 2 + c])
const crossings = (x: number[]): number => x.reduce((a, v, i) => (i && x[i - 1] < 0 && v >= 0 ? a + 1 : a), 0)
const chain = (type: string, params: Record<string, number> = {}): string[] => audioEffectFilters([makeAudioEffect(type, params)])

test('every audio effect builds a filter chain that FFmpeg accepts, and keeps the clip length', () => {
  const input = tone(440, 1)
  for (const spec of AUDIO_EFFECTS) {
    const out = process(input, chain(spec.type))
    expect(out.length, spec.type).toBeGreaterThan(input.length * 0.9)
    // Echoes and reverb ring on after the sound ends; the export graph trims that tail to the clip.
    expect(out.length, spec.type).toBeLessThan(input.length + RATE * 2 * 1.3)
    expect(Number.isFinite(rms(out)), spec.type).toBe(true)
  }
})

test('tone controls change the loudness of the right frequencies', () => {
  const low = tone(60, 1)
  expect(rms(process(low, chain('bass', { amount: 12 })))).toBeGreaterThan(rms(low) * 2.5)
  const high = tone(10000, 1)
  expect(rms(process(high, chain('eq', { high: 12 })))).toBeGreaterThan(rms(high) * 2.5)
  expect(rms(process(high, chain('eq', { high: -12 })))).toBeLessThan(rms(high) * 0.4)
  expect(rms(process(tone(1000, 1), chain('eq', { mid: 12, midFreq: 1000 })))).toBeGreaterThan(rms(tone(1000, 1)) * 2.5)
})

test('echo and reverb add sound after the original has stopped', () => {
  const burst = new Float32Array(RATE * 2 * 2) // 2 s of silence with a short click at the start
  for (let i = 0; i < 200; i++) burst[i * 2] = burst[i * 2 + 1] = 0.8
  const tail = (x: Float32Array): number => rms(x, Math.round(0.25 * RATE) * 2, Math.round(1.5 * RATE) * 2)
  expect(tail(burst)).toBe(0)
  expect(tail(process(burst, chain('echo', { time: 300, repeats: 3 })))).toBeGreaterThan(0.002)
  expect(tail(process(burst, chain('reverb', { size: 0.8, mix: 0.8 })))).toBeGreaterThan(0.001)
  // The echoes arrive where the table says: a peak near 300 ms.
  const out = channel(process(burst, chain('echo', { time: 300, repeats: 2, mix: 1 })), 0)
  const window = (a: number, b: number): number => Math.max(...out.slice(Math.round(a * RATE), Math.round(b * RATE)).map(Math.abs))
  expect(window(0.28, 0.34)).toBeGreaterThan(0.2)
  expect(window(0.1, 0.25)).toBeLessThan(0.02)
})

test('compressor and limiter tame loud sound', () => {
  const loud = tone(300, 1, 0.9)
  const peak = (x: Float32Array): number => Math.max(...Array.from(x.slice(RATE / 2 * 2), Math.abs))
  expect(peak(process(loud, chain('limiter', { ceiling: -12 })))).toBeLessThan(0.3)
  const compressed = process(loud, chain('compressor', { threshold: -30, ratio: 10, makeup: 0 }))
  expect(rms(compressed, RATE)).toBeLessThan(rms(loud, RATE) * 0.7)
  expect(rms(process(tone(300, 1, 0.1), chain('distortion', { drive: 1 })))).toBeGreaterThan(rms(tone(300, 1, 0.1)) * 0.9)
})

test('pitch shift changes the pitch without changing the length', () => {
  const up = process(tone(400, 2), chain('pitch', { semitones: 12 }))
  expect(up.length / (2 * RATE)).toBeCloseTo(2, 1)
  const hz = crossings(channel(up, 0)) / (up.length / 2 / RATE)
  expect(hz).toBeGreaterThan(760)
  expect(hz).toBeLessThan(840)
  const down = process(tone(400, 2), chain('pitch', { semitones: -12 }))
  const hzDown = crossings(channel(down, 0)) / (down.length / 2 / RATE)
  expect(hzDown).toBeGreaterThan(180)
  expect(hzDown).toBeLessThan(220)
})

test('stereo tools: width, centre isolate and centre removal', () => {
  // A centred voice (same in both ears) plus a left-only instrument.
  const centre = tone(500, 1, 0.4)
  const left = tone(2000, 1, 0.4, 0)
  const mix = new Float32Array(centre.length)
  mix.forEach((_, i) => (mix[i] = centre[i] + left[i]))
  const removed = process(mix, chain('vocals', { mode: 1 }))
  const kept = process(mix, chain('vocals', { mode: 0 }))
  const at = (x: Float32Array, hz: number): number => { let s = 0; let c = 0; const l = channel(x, 0); l.forEach((v, i) => { s += v * Math.sin((2 * Math.PI * hz * i) / RATE); c += v * Math.cos((2 * Math.PI * hz * i) / RATE) }); return Math.hypot(s, c) / l.length }
  expect(at(removed, 500)).toBeLessThan(0.01) // centre voice gone
  expect(at(removed, 2000)).toBeGreaterThan(0.05) // side instrument stays
  expect(at(kept, 500)).toBeGreaterThan(0.15)
  expect(at(kept, 2000)).toBeLessThan(at(kept, 500))
  const mono = process(left, chain('width', { amount: 0 }))
  const [l, r] = [channel(mono, 0), channel(mono, 1)]
  expect(Math.max(...l.map((v, i) => Math.abs(v - r[i])))).toBeLessThan(1e-4)
})

test('voice changer presets run and the telephone preset removes bass', () => {
  expect(rms(process(tone(100, 1), chain('voice', { preset: 3 })))).toBeLessThan(rms(tone(100, 1)) * 0.3)
  expect(rms(process(tone(1000, 1), chain('voice', { preset: 3 })))).toBeGreaterThan(0.1)
  const robot = process(tone(300, 1), chain('voice', { preset: 2 }))
  expect(rms(robot)).toBeGreaterThan(0.05)
})

test('a clip with audio effects puts them in the export graph, in order, before the fades', () => {
  const asset: MediaAsset = { id: 'a', path: '/a.wav', name: 'a.wav', kind: 'audio', duration: 10, hasAudio: true, sizeBytes: 1 }
  const track = makeTrack('audio', 'A1')
  let project: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [asset], tracks: [track] }
  const clip = { ...clipFromAsset(asset, 0), fadeIn: 1, audioFx: [makeAudioEffect('bass'), makeAudioEffect('reverb')] }
  project = ops.addClip(project, track.id, clip)
  const filter = buildAudioGraph(project)!.filter
  expect(filter.indexOf('bass=g=')).toBeGreaterThan(-1)
  expect(filter.indexOf('bass=g=')).toBeLessThan(filter.indexOf('aecho'))
  expect(filter.indexOf('aecho')).toBeLessThan(filter.indexOf('afade=t=in'))
})
