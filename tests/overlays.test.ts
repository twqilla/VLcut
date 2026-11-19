import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { OVERLAY_CATALOG, searchOverlays } from '../src/shared/overlayCatalog'
import { ensureOverlays, OVERLAY_IDS, overlayFile } from '../src/main/media/overlays'

test('the overlay catalogue and the recipes list the same clips', () => {
  expect([...OVERLAY_IDS].sort()).toEqual(OVERLAY_CATALOG.map((o) => o.id).sort())
  expect(searchOverlays('leak').length).toBeGreaterThanOrEqual(3)
  expect(searchOverlays('', 'Flashes').length).toBe(2)
})

/** Mean brightness (0-255) of frame `at` seconds in, as a 16x9 gray sample. */
function brightness(file: string, at: number): number {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 })
  const px = r.stdout as Buffer
  return px.reduce((a, b) => a + b, 0) / Math.max(1, px.length)
}

test('every overlay renders, has the right length, and looks like what it should', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ov-'))
  try {
    const assets = await ensureOverlays(dir, OVERLAY_IDS)
    expect(assets).toHaveLength(OVERLAY_CATALOG.length)
    const lum: Record<string, number[]> = {}
    for (const a of assets) {
      const info = OVERLAY_CATALOG.find((o) => o.id === a.builtinOverlay)!
      expect(a.kind).toBe('video')
      expect(a.width).toBe(1280)
      expect(Math.abs(a.duration - info.seconds), info.id).toBeLessThan(0.3)
      lum[info.id] = [0.05, info.seconds / 2, info.seconds - 0.1].map((t) => brightness(overlayFile(dir, info.id), Math.max(0, t)))
    }
    // Light is added to the picture, so overlays that should be mostly dark are dark, and none is empty.
    for (const id of ['leakWarm', 'leakCool', 'leakRainbow', 'filmBurn', 'streak', 'glitchBars', 'vhsNoise']) {
      expect(Math.max(...lum[id]), `${id} has some light`).toBeGreaterThan(3)
      expect(Math.min(...lum[id]), `${id} is not a flat wash`).toBeLessThan(140)
    }
    expect(lum.dust[1], 'dust is mostly black').toBeLessThan(20)
    expect(lum.dust[1], 'dust has specks').toBeGreaterThan(0.05)
    expect(Math.abs(lum.grain[1] - 128), 'grain is neutral grey').toBeLessThan(14)
    expect(lum.flash[0], 'a flash starts bright').toBeGreaterThan(5)
    expect(lum.flash[2], 'and ends black').toBeLessThan(5)
    expect(lum.flash[0]).toBeGreaterThan(lum.flash[2])
    // Light leaks move: two moments of the clip differ.
    expect(Math.abs(lum.leakWarm[0] - lum.leakWarm[1]) + Math.abs(lum.streak[0] - lum.streak[1])).toBeGreaterThan(0.5)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 240000)
