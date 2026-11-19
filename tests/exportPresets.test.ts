import { expect, test } from 'vitest'
import { EXPORT_PRESETS, applyPreset, presetFileName, shapeMismatch } from '../src/shared/render/presets'
import type { ExportSettings } from '../src/shared/types'
import { DEFAULT_INTERPOLINI } from '../src/shared/render/interpolini'

const base: ExportSettings = { outputPath: '/x.mp4', width: 1920, height: 1080, fps: 30, codec: 'h264', crf: 18, audioBitrateKbps: 192, normalizeAudio: false, motionBlur: { mode: 'off', amount: 0.75, samples: 16, weighting: 'gaussian', interpolini: DEFAULT_INTERPOLINI }, pixelScaling: false }

test('every preset gives valid, even frame sizes and sensible limits for any project shape', () => {
  for (const project of [{ width: 1920, height: 1080, fps: 30 }, { width: 1080, height: 1920, fps: 60 }, { width: 1080, height: 1080, fps: 120 }]) {
    for (const p of EXPORT_PRESETS) {
      const s = applyPreset(p, project, base)
      expect(s.width % 2 + s.height % 2, p.id).toBe(0)
      expect(Math.min(s.width, s.height), p.id).toBe(p.short)
      expect(s.fps).toBeLessThanOrEqual(p.maxFps ?? 1000)
      expect(s.crf).toBeGreaterThanOrEqual(12)
      expect(s.outputPath).toBe('/x.mp4') // other settings are left alone
    }
  }
  expect(new Set(EXPORT_PRESETS.map((p) => p.id)).size).toBe(EXPORT_PRESETS.length)
})

test('shapes: TikTok is vertical, square is square, "keep shape" follows the project', () => {
  const tiktok = applyPreset(EXPORT_PRESETS.find((p) => p.id === 'tiktok')!, { width: 1920, height: 1080, fps: 30 }, base)
  expect([tiktok.width, tiktok.height]).toEqual([1080, 1920])
  const square = applyPreset(EXPORT_PRESETS.find((p) => p.id === 'instagram-square')!, { width: 1920, height: 1080, fps: 30 }, base)
  expect([square.width, square.height]).toEqual([1080, 1080])
  const chat = applyPreset(EXPORT_PRESETS.find((p) => p.id === 'discord')!, { width: 1080, height: 1920, fps: 30 }, base)
  expect([chat.width, chat.height]).toEqual([720, 1280])
  expect(shapeMismatch(EXPORT_PRESETS.find((p) => p.id === 'tiktok')!, { width: 1920, height: 1080 })).toBe(true)
  expect(shapeMismatch(EXPORT_PRESETS.find((p) => p.id === 'discord')!, { width: 1920, height: 1080 })).toBe(false)
})

test('batch file names keep the folder and stay legal on Windows', () => {
  const p = EXPORT_PRESETS.find((x) => x.id === 'tiktok')!
  expect(presetFileName('C:\\Videos\\My film.mp4', p)).toBe('C:\\Videos\\My film - TikTok Reels Shorts.mp4')
  expect(presetFileName('/home/a/clip.mov', EXPORT_PRESETS[0])).toBe('/home/a/clip - YouTube 1080p.mp4')
  expect(presetFileName('noext', EXPORT_PRESETS[0])).toBe('noext - YouTube 1080p.mp4')
})
