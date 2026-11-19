import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { saveRecording } from '../src/main/audio/recording'

test('a browser recording (WebM/Opus) becomes a 48 kHz stereo WAV asset and the temporary take is removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rec-'))
  try {
    const webm = join(dir, 'in.webm')
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-ac', '1', '-c:a', 'libopus', webm])
    const out = join(dir, 'out')
    const asset = await saveRecording(out, new Uint8Array(readFileSync(webm)), 3)
    expect(asset.kind).toBe('audio')
    expect(asset.name).toBe('Voice recording 3')
    expect(asset.duration).toBeGreaterThan(1.8)
    expect(asset.duration).toBeLessThan(2.3)
    expect(readdirSync(out).filter((f) => f.endsWith('.webm'))).toEqual([])
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', asset.path]).toString())
    expect(probe.streams[0]).toMatchObject({ sample_rate: '48000', channels: 2 })
    await expect(saveRecording(out, new Uint8Array(0), 1)).rejects.toThrow(/empty/)
    await expect(saveRecording(out, new Uint8Array([1, 2, 3, 4]), 1)).rejects.toThrow()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
