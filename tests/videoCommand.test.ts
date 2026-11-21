import { expect, test } from 'vitest'
import type { ExportSettings } from '../src/shared/types'
import { checkCommand, classify, formatCommand, generatedVideoArgs, mergeCommand, tokenize } from '../src/shared/render/videoCommand'
import { videoArgs } from '../src/main/render/exporter'

const base: ExportSettings = { outputPath: 'o.mp4', width: 1920, height: 1080, fps: 60, codec: 'h264', encoder: 'nvenc', crf: 18, audioBitrateKbps: 192, normalizeAudio: false, motionBlur: { mode: 'off', amount: 0.75 } as never, pixelScaling: false }

test('the command follows the settings and keeps what the person added', () => {
  const g1 = generatedVideoArgs(base)
  let text = formatCommand(g1)
  expect(text).toContain('-c:v h264_nvenc')
  expect(text).toContain('-cq 18')
  // The person adds options and changes one generated value.
  text += ' -aq-mode 3 -spatial-aq 1'
  text = text.replace('-preset p5', '-preset p7')
  // 1. A setting changes: the quality number follows, the person's parts stay.
  const g2 = generatedVideoArgs({ ...base, crf: 14 })
  text = mergeCommand(text, g1, g2)
  expect(text).toContain('-cq 14')
  expect(text).toContain('-aq-mode 3 -spatial-aq 1')
  expect(text).toContain('-preset p7') // the person's own value is not overwritten
  // 2. Bitrate mode: new flags appear, old ones that no longer apply go away.
  const g3 = generatedVideoArgs({ ...base, crf: 14, videoBitrateKbps: 240000 })
  text = mergeCommand(text, g2, g3)
  expect(text).toContain('-b:v 240000k')
  expect(text).not.toContain('-cq')
  expect(text).toContain('-aq-mode 3')
  // 3. A deleted generated flag stays deleted.
  text = text.replace(' -tune hq', '')
  text = mergeCommand(text, g3, generatedVideoArgs({ ...base, videoBitrateKbps: 100000 }))
  expect(text).not.toContain('-tune')
  expect(text).toContain('-b:v 100000k')
  // Parts are told apart.
  const parts = classify(text, generatedVideoArgs({ ...base, videoBitrateKbps: 100000 }))
  expect(parts.find((p) => p.text === '-aq-mode 3')!.manual).toBe(true)
  expect(parts.find((p) => p.text === '-preset p7')!.manual).toBe(true)
  expect(parts.find((p) => p.text === '-c:v h264_nvenc')!.manual).toBe(false)
})

test('the command is checked and the export uses exactly what is shown', () => {
  expect(tokenize('-c:v libx264 -x264-params "a=1:b=2" -crf 18')).toEqual(['-c:v', 'libx264', '-x264-params', 'a=1:b=2', '-crf', '18'])
  expect(checkCommand('-c:v libx264 -crf 18').ok).toBe(true)
  expect(checkCommand('-c:v libx264 -qp -1').ok).toBe(true) // a negative number is a value
  expect(checkCommand('')).toMatchObject({ ok: false })
  expect(checkCommand('-crf 18')).toMatchObject({ ok: false, error: expect.stringContaining('encoder') })
  expect(checkCommand('-c:v libx264 18')).toMatchObject({ ok: false })
  expect(checkCommand('-c:v libx264 -i other.mp4')).toMatchObject({ ok: false })
  expect(videoArgs({ ...base, videoCommand: '-c:v h264_nvenc -qp 18 -aq-mode 3' })).toEqual(['-c:v', 'h264_nvenc', '-qp', '18', '-aq-mode', '3'])
  expect(videoArgs(base)).toEqual(generatedVideoArgs(base))
  expect(() => videoArgs({ ...base, videoCommand: '-crf 18' })).toThrow(/cannot be used/)
})
