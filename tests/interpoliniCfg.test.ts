import { expect, test } from 'vitest'
import { blendWeights, cfgToInterpolini, DEFAULT_INTERPOLINI, describeBlend, interpoliniSettingArgs, interpoliniToCfg, normalizeInterpolini, sourceRate } from '../src/shared/render/interpolini'
import { explainExit, VC_REDIST_URL } from '../src/shared/winExit'

const vegasOff = normalizeInterpolini({ ...DEFAULT_INTERPOLINI, interpolate: false, weighting: 'vegas', intensity: 1 })

test('the Vegas-style setup: interpolation off, blending on, intensity 1, Vegas weighting, target = the export rate', () => {
  const args = interpoliniSettingArgs(vegasOff, 60).join(' ')
  expect(args).toContain('interpolation.enabled=no')
  expect(args).toContain('blending.enabled=yes')
  expect(args).toContain('blending.fps=60')
  expect(args).toContain('blending.intensity=1')
  expect(args).toContain('blending.weighting=vegas')
  // 240 fps footage blended down to 60: five frames with the two outer ones at half weight.
  expect(sourceRate(vegasOff, 240)).toBe(240)
  const w = blendWeights(240, 60, 1, 'vegas')
  expect(w).toHaveLength(5)
  expect(w.map((x) => Math.round(x * 8))).toEqual([1, 2, 2, 2, 1])
  expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
  // An odd ratio is an even blend of that many frames.
  expect(blendWeights(180, 60, 1, 'vegas').map((x) => Math.round(x * 3))).toEqual([1, 1, 1])
  expect(describeBlend(vegasOff, 240, 60)).toContain('blends 5 of the 240 fps frames of the clip')
  expect(describeBlend(vegasOff, 60, 60)).toContain('no visible blur')
})

test('"blend down to" can be set, and when it is not set the export rate is used', () => {
  expect(interpoliniSettingArgs(normalizeInterpolini({ blendFps: 30 }), 60).join(' ')).toContain('blending.fps=30')
  expect(interpoliniSettingArgs(normalizeInterpolini({}), 60).join(' ')).toContain('blending.fps=60')
  expect(normalizeInterpolini({ blendFps: 5000 }).blendFps).toBeUndefined()
  expect(normalizeInterpolini({ blendFps: 29.97 }).blendFps).toBe(30)
})

test('settings are saved as a readable .cfg and come back unchanged, including a hand-edited file', () => {
  for (const s of [vegasOff, normalizeInterpolini({ engine: 'rife', fps: 'x8', speed: 'fastest', weighting: 'custom', custom: [1, 3, 9], blendFps: 50, gamma: 2.2, dedup: false, half: false }), DEFAULT_INTERPOLINI]) {
    const text = interpoliniToCfg(s)
    expect(text).toContain('[blending]')
    expect(cfgToInterpolini(text)).toEqual(normalizeInterpolini(s))
  }
  const edited = '# my config\n[interpolation]\nenabled = no ; off\n[blending]\nintensity = 0.5\nweighting = pyramid\nfps = 24\n[unknown]\nfoo = bar'
  expect(cfgToInterpolini(edited)).toMatchObject({ interpolate: false, intensity: 0.5, weighting: 'pyramid', blendFps: 24 })
  // Nonsense falls back to the defaults instead of breaking the run.
  expect(cfgToInterpolini('[blending]\nweighting = banana\nintensity = abc\n[interpolation]\nfps = 1e99')).toMatchObject({ weighting: DEFAULT_INTERPOLINI.weighting, intensity: 1, fps: DEFAULT_INTERPOLINI.fps })
})

test('start-up failures are explained in words', () => {
  expect(explainExit(3221225781, null, 'win32')).toContain(VC_REDIST_URL)
  expect(explainExit(3221225781, null, 'win32')).toContain('0xC0000135')
  expect(explainExit(3221225477, null, 'win32')).toContain('crashed')
  expect(explainExit(2, null, 'linux')).toBe('The program stopped with code 2.')
  expect(explainExit(null, 'SIGKILL', 'linux')).toContain('SIGKILL')
})

import { vegasWindow } from '../src/shared/render/vegasBlend'
import { videoArgs } from '../src/main/render/exporter'
import type { ExportSettings } from '../src/shared/types'

test('Vegas resampling blends the footage frames inside each output frame, edges at half weight', () => {
  const w = vegasWindow(240, 60, 1)
  expect(w.weights.map((x) => Math.round(x * 8))).toEqual([1, 2, 2, 2, 1])
  // The moments are one footage frame apart, centred on the output frame.
  expect(w.offsets.map((o) => Math.round(o * 240 * 100) / 100)).toEqual([-2, -1, 0, 1, 2])
  expect(vegasWindow(180, 60, 1).weights).toHaveLength(3)
  expect(vegasWindow(60, 60, 1).weights).toEqual([1]) // nothing to blend
  expect(vegasWindow(240, 60, 0.5).weights.length).toBeLessThan(5) // a shorter shutter blends fewer frames
})

const base = { outputPath: 'x.mp4', width: 1920, height: 1080, fps: 60, codec: 'h264', crf: 18, audioBitrateKbps: 192, normalizeAudio: false, motionBlur: { mode: 'off' } as ExportSettings['motionBlur'], pixelScaling: false } as ExportSettings

test('the encoder choice and the bitrate in Mbps reach FFmpeg correctly', () => {
  expect(videoArgs(base)).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-crf', '18', '-preset', 'fast']))
  const gpu = videoArgs({ ...base, encoder: 'nvenc' })
  expect(gpu).toEqual(expect.arrayContaining(['h264_nvenc', '-rc', 'vbr', '-cq', '18', '-preset', 'p5']))
  expect(gpu).not.toContain('libx264')
  expect(videoArgs({ ...base, codec: 'h265', encoder: 'nvenc' })).toEqual(expect.arrayContaining(['hevc_nvenc', '-tag:v', 'hvc1']))
  expect(videoArgs({ ...base, codec: 'h265' })).toContain('libx265')
  // 240 Mbps is sent as 240000k with a ceiling and buffer.
  const rate = videoArgs({ ...base, videoBitrateKbps: 240000 })
  expect(rate).toEqual(expect.arrayContaining(['-b:v', '240000k', '-maxrate', '360000k', '-bufsize', '480000k']))
  expect(rate).not.toContain('-crf')
  expect(videoArgs({ ...base, encoder: 'nvenc', videoBitrateKbps: 100000 })).toEqual(expect.arrayContaining(['-b:v', '100000k', '-rc', 'vbr']))
  expect(videoArgs({ ...base, videoBitrateKbps: 99999999 })).toContain('400000k') // limited to something sane
})
