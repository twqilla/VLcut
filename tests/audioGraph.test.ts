import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { MediaAsset, Project } from '../src/shared/types'
import { clipFromAsset, makeTrack } from '../src/shared/timeline/model'
import { addClip, updateClip } from '../src/shared/timeline/ops'
import { buildAudioGraph, keyframeExpr } from '../src/shared/render/audioGraph'

let dir: string
let tone: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vlcut-audio-'))
  tone = join(dir, 'tone.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=4', tone])
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function project(): { p: Project; trackId: string; asset: MediaAsset } {
  const asset: MediaAsset = { id: 'a', path: tone, name: 'tone.wav', kind: 'audio', duration: 4, hasAudio: true, sizeBytes: 1 }
  const track = makeTrack('audio', 'A1')
  return { p: { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 320, height: 180, fps: 30 }, media: [asset], tracks: [track] }, trackId: track.id, asset }
}

/** Renders the graph with FFmpeg and returns [duration, mean volume in dB over a window]. */
function render(p: Project, from: number, to: number): { duration: number; meanDb: number } {
  const g = buildAudioGraph(p)!
  const out = join(dir, `out-${Math.random()}.wav`)
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...g.inputArgs, '-filter_complex', g.filter, '-map', g.output, out])
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString())
  const stats = execFileSync('ffmpeg', ['-v', 'info', '-ss', String(from), '-t', String(to - from), '-i', out, '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' as never })
  void stats
  const log = execFileSync('sh', ['-c', `ffmpeg -ss ${from} -t ${to - from} -i "${out}" -af volumedetect -f null - 2>&1`]).toString()
  return { duration, meanDb: Number(/mean_volume: (-?[\d.]+|-inf)/.exec(log)![1].replace('-inf', '-200')) }
}

test('no audible clips gives no graph', () => {
  expect(buildAudioGraph(project().p)).toBeNull()
})

test('clips are placed, sped up and mixed to the project length', () => {
  const { p, trackId, asset } = project()
  let q = addClip(p, trackId, clipFromAsset(asset, 1)) // 1s-5s
  const second = clipFromAsset(asset, 6)
  q = addClip(q, trackId, { ...second, speed: 2, duration: 2 }) // 6s-8s
  const r = render(q, 0, 0.9)
  expect(r.duration).toBeCloseTo(8, 1)
  expect(r.meanDb).toBeLessThan(-80) // silence before the first clip
  expect(render(q, 1.5, 4.5).meanDb).toBeGreaterThan(-25)
  expect(render(q, 5.1, 5.9).meanDb).toBeLessThan(-80) // gap
  expect(render(q, 6.2, 7.8).meanDb).toBeGreaterThan(-25)
})

test('volume keyframes and fades shape the level', () => {
  const { p, trackId, asset } = project()
  const clip = clipFromAsset(asset, 0)
  let q = addClip(p, trackId, clip)
  q = updateClip(q, clip.id, { keyframes: { volume: [{ t: 0, value: 1, easing: 'linear' }, { t: 2, value: 1, easing: 'hold' }, { t: 2.01, value: 0.05, easing: 'linear' }] } })
  const loud = render(q, 0.5, 1.5).meanDb
  const quiet = render(q, 2.5, 3.5).meanDb
  expect(loud - quiet).toBeGreaterThan(20)
  expect(keyframeExpr([{ t: 0, value: 0, easing: 'linear' }, { t: 2, value: 1, easing: 'linear' }])).toContain('if(lt(t,2)')
})
