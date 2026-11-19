import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { detectBeats } from '../src/shared/analysis/beats'
import { hashDistance, markDuplicates } from '../src/shared/analysis/shots'
import { searchMedia } from '../src/shared/analysis/search'
import { analyzeAsset, parseSilences } from '../src/main/analysis/analyze'
import { probeMedia } from '../src/main/media/probe'

let dir: string
beforeAll(() => (dir = mkdtempSync(join(tmpdir(), 'vlcut-analysis-'))))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('detectBeats finds the tempo of a click track and rejects noise', () => {
  const rate = 11025
  const samples = new Float32Array(rate * 12)
  const period = 60 / 128
  for (let b = 0; b * period < 12; b++) {
    const at = Math.round(b * period * rate)
    for (let i = 0; i < 400 && at + i < samples.length; i++) samples[at + i] = Math.sin(i * 0.5) * Math.exp(-i / 80)
  }
  const result = detectBeats(samples, rate)
  expect(result.bpm).toBeGreaterThan(126)
  expect(result.bpm).toBeLessThan(130)
  expect(Math.abs(result.beats[4] - result.beats[3] - period)).toBeLessThan(0.02)
  // Each detected beat sits close to a real click.
  const offset = result.beats[2] % period
  expect(Math.min(offset, period - offset)).toBeLessThan(0.04)

  const steady = new Float32Array(rate * 8).map((_, i) => Math.sin(i * 0.2) * 0.3)
  expect(detectBeats(steady, rate).bpm).toBeNull()
})

test('parseSilences handles a trailing open range', () => {
  expect(parseSilences('silence_start: 1.5\nsilence_end: 2.5 | silence_duration: 1\nsilence_start: 9', 10)).toEqual([{ start: 1.5, end: 2.5 }, { start: 9, end: 10 }])
})

test('analyzeAsset finds cuts, silence, motion and duplicates in a real file', async () => {
  const file = join(dir, 'three-shots.mp4')
  // Shot 1: static dark colour bars (0-3s). Shot 2: moving test pattern (3-6s). Shot 3: the same static bars (6-9s).
  // Audio: tone for 0-4s, silence 4-7s, tone 7-9s.
  execFileSync('ffmpeg', ['-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'smptebars=s=640x360:r=25:d=3,eq=brightness=-0.38',
    '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=3',
    '-f', 'lavfi', '-i', 'smptebars=s=640x360:r=25:d=3,eq=brightness=-0.38',
    '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*330*t)*(lt(t,4)+gt(t,7))':d=9",
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1[v]', '-map', '[v]', '-map', '3:a', '-pix_fmt', 'yuv420p', file])
  const asset = await probeMedia(file)
  const analysis = await analyzeAsset(asset)

  expect(analysis.shots.map((s) => [Math.round(s.start), Math.round(s.end)])).toEqual([[0, 3], [3, 6], [6, 9]])
  expect(analysis.silences).toHaveLength(1)
  expect(analysis.silences[0].start).toBeCloseTo(4, 0)
  expect(analysis.silences[0].end).toBeCloseTo(7, 0)
  expect(analysis.loudness).toBeLessThan(0)
  const [a, b, c] = analysis.shots
  expect(a.tags).toContain('static')
  expect(a.tags).toContain('dark')
  expect(b.motion).toBeGreaterThan(a.motion)
  expect(b.tags).toContain('colorful')
  expect(b.score).toBeGreaterThan(a.score)
  expect(a.speech).toBeGreaterThan(0.9)
  expect(c.speech).toBeLessThan(0.8)
  expect(hashDistance(a.hash, c.hash)).toBeLessThanOrEqual(5)

  const [marked] = markDuplicates([{ ...asset, analysis }])
  expect(marked.analysis!.shots[2].duplicateOf).toEqual({ assetId: asset.id, shot: 0 })
  expect(marked.analysis!.shots[1].duplicateOf).toBeUndefined()

  const withWords = { ...marked, analysis: { ...marked.analysis!, transcript: [{ text: 'Hello', start: 1, end: 1.3 }, { text: 'big', start: 1.3, end: 1.5 }, { text: 'world.', start: 1.5, end: 2 }] } }
  expect(searchMedia([withWords], 'find the dark static shots')[0].shotIndex).toBe(0)
  expect(searchMedia([withWords], 'colorful moving clips')[0].shotIndex).toBe(1)
  expect(searchMedia([withWords], 'big world')[0]).toMatchObject({ time: 1.3 })
  expect(searchMedia([withWords], 'three')[0].reason).toContain('File name')
  expect(searchMedia([withWords], 'zebra')).toEqual([])
}, 60000)

test('camera movement is detected in real files and searchable', async () => {
  const make = (name: string, vf: string) => {
    const file = join(dir, name)
    // A detailed still (a fractal) moved by the filter, so only the camera moves.
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'mandelbrot=s=1280x720:r=24:end_scale=1:start_scale=1', '-t', '4', '-vf', vf, '-pix_fmt', 'yuv420p', file])
    return file
  }
  const cases: [string, string, string | undefined][] = [
    ['push.mp4', "scale=1280:720,zoompan=z='1+0.006*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=640x360:fps=24", 'push-in'],
    ['pull.mp4', "scale=1280:720,zoompan=z='1.6-0.006*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=640x360:fps=24", 'pull-out'],
    ['pan.mp4', "crop=640:360:'t*120':180", 'pan-right'],
    ['still.mp4', 'crop=640:360:320:180', undefined]
  ]
  const analysed = []
  for (const [name, vf, expected] of cases) {
    const asset = await probeMedia(make(name, vf))
    const analysis = await analyzeAsset(asset)
    expect(analysis.shots[0].camera, name).toBe(expected)
    analysed.push({ ...asset, analysis })
  }
  expect(searchMedia(analysed, 'find the clips where the camera moves towards the building')[0].asset.name).toBe('push.mp4')
  expect(searchMedia(analysed, 'camera pulls away')[0].asset.name).toBe('pull.mp4')
  expect(searchMedia(analysed, 'pan right')[0].asset.name).toBe('pan.mp4')
}, 120000)

test('search finds what is in the picture once shots are described', () => {
  const shot = (start: number, description?: string) => ({ start, end: start + 2, motion: 0.2, brightness: 0.5, saturation: 0.4, speech: 0, hash: '', score: 0.6, tags: ['gentle-motion'], description })
  const asset = { id: 'a', path: '/a.mp4', name: 'a.mp4', kind: 'video' as const, duration: 6, hasAudio: false, sizeBytes: 1,
    analysis: { version: 1 as const, silences: [], shots: [shot(0, 'A dog runs along a beach.'), { ...shot(2, 'A tall glass building at dusk.'), camera: 'push-in', tags: ['gentle-motion', 'push-in'] }, shot(4)], beats: [], bpm: null, loudness: null } }
  const hits = searchMedia([asset], 'find the clips where the camera moves towards the building')
  expect(hits[0].shotIndex).toBe(1)
  expect(hits[0].reason).toContain('glass building')
  expect(searchMedia([asset], 'dogs')[0].shotIndex).toBe(0)
  expect(searchMedia([asset], 'zebra')).toEqual([])
})

test('snare hits are found and kicks and hi-hats are not', async () => {
  // 120 BPM, 12 s: kick on beats 1 and 3, snare on beats 2 and 4 (every odd half-second), hats on eighth notes.
  const file = join(dir, 'groove.wav')
  const kick = "st(0,mod(t,1));0.9*sin(2*PI*(45+150*exp(-38*ld(0)))*ld(0))*exp(-6*ld(0))"
  const snare = "st(0,mod(t+0.5,1));0.6*(random(1)*2-1)*exp(-16*ld(0))+0.35*sin(2*PI*190*ld(0))*exp(-22*ld(0))"
  const hat = "st(0,mod(t,0.25));0.3*(random(2)*2-1)*exp(-130*ld(0))"
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc='${kick}':s=44100:d=12`, '-f', 'lavfi', '-i', `aevalsrc='${snare}':s=44100:d=12`, '-f', 'lavfi', '-i', `aevalsrc='${hat}':s=44100:d=12`,
    '-filter_complex', '[1]volume=1[sn];[2]highpass=f=7000[hh];[0][sn][hh]amix=inputs=3:normalize=0,alimiter=limit=0.95', file])
  // The snare expression above fires at t = 0.5, 1.5, 2.5 ...
  const wanted = Array.from({ length: 12 }, (_, i) => i + 0.5)
  const analysis = await analyzeAsset(await probeMedia(file))
  const snares = analysis.snares!
  const hits = wanted.filter((w) => snares.some((s) => Math.abs(s - w) <= 0.04))
  const stray = snares.filter((s) => !wanted.some((w) => Math.abs(s - w) <= 0.04))
  expect(hits.length).toBeGreaterThanOrEqual(10) // recall: at least 10 of the 12 snares
  expect(stray.length).toBeLessThanOrEqual(1) // precision: kicks (on the whole seconds) and hats are not reported
  expect(analysis.bpm).toBeGreaterThan(115)
  expect(analysis.bpm).toBeLessThan(125)
}, 120000)
