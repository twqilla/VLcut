import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { syncFiles } from '../src/main/audio/sync'

/** Two "cameras" hearing the same event: one started 2.4 s later, with a different level, filter and noise. */
test('real files recorded at different times line up to within a few milliseconds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-'))
  const a = join(dir, 'a.wav')
  const b = join(dir, 'b.mp3')
  // A talk-like signal: noise bursts modulated at syllable rate, with a tone that wanders.
  const expr = "random(0)*sin(2*PI*3.1*t)*sin(2*PI*0.37*t)+0.4*sin(2*PI*(220+60*sin(2*PI*0.2*t))*t)"
  const make = (out: string, extra: string[]): void => {
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=22050:d=30`, ...extra, out])
    if (r.status !== 0) throw new Error(String(r.stderr))
  }
  make(a, ['-ac', '2'])
  // Drop the first 2.4 s (camera B started later) and degrade it.
  make(b, ['-ac', '1', '-af', 'atrim=start=2.4,asetpts=PTS-STARTPTS,highpass=f=300,lowpass=f=3000,volume=0.4,aecho=0.8:0.7:40:0.3', '-b:a', '64k'])
  const r = await syncFiles(a, b)
  expect(r.lag).toBeGreaterThan(2.38)
  expect(r.lag).toBeLessThan(2.42)
  expect(r.confidence).toBeGreaterThan(10)
}, 120000)
