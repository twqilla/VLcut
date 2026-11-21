import { beforeEach, expect, test } from 'vitest'
import { buildReport, recordError, redact, resetErrors } from '../src/main/diagnostics'

beforeEach(resetErrors)

test('a report never contains the person\'s name or folders', () => {
  const home = 'C:\\Users\\Alex Rivera'
  const text = redact('Failed: C:\\Users\\Alex Rivera\\Videos\\Holiday\\clip.mp4 (user alexrivera) and /home/alexrivera/Movies/x/y/z.mov and D:\\Private\\Stuff\\more\\file.wav', home, 'alexrivera')
  expect(text).not.toMatch(/Alex|Rivera|alexrivera|Private|Holiday|Movies/)
  expect(text).toContain('<user>')
  expect(text).toContain('…/<file>.mp4') // only the file type survives
})

test('the report lists versions, graphics, tools and recent errors', () => {
  recordError('renderer', 'TypeError: x is not a function at /home/sam/app/out/renderer/a.js')
  recordError('main', 'ffmpeg exited 1')
  const r = buildReport({ appVersion: '0.9.0', versions: { electron: '33', chrome: '130', node: '22' }, platform: 'win32', arch: 'x64', osRelease: '10.0.22631', memoryGb: 15.9, cpuCount: 12, gpu: { gpu_compositing: 'enabled', webgl: 'enabled' }, ffmpeg: 'ffmpeg version 7.0', ffprobe: 'ffprobe version 7.0', uncleanLastRun: true, settings: { theme: 'midnight', mods: ['neon', 'glass'] }, home: '/home/sam', user: 'sam' })
  expect(r).toContain('VLcut 0.9.0')
  expect(r).toContain('win32 x64')
  expect(r).toContain('gpu_compositing=enabled')
  expect(r).toContain('Previous run ended badly: yes')
  expect(r).toContain('neon+glass')
  expect(r).toContain('Recent errors (2)')
  expect(r).toContain('ffmpeg exited 1')
  expect(r).not.toMatch(/\/home\/sam/)
})

test('only the most recent errors are kept', () => {
  for (let i = 0; i < 100; i++) recordError('main', `e${i}`)
  const r = buildReport({ appVersion: '1', versions: {}, platform: 'linux', arch: 'x64', osRelease: '', memoryGb: 1, cpuCount: 1, gpu: {}, ffmpeg: '', ffprobe: '', uncleanLastRun: false, settings: { theme: 'x', mods: [] }, home: '/h', user: 'u' })
  expect(r).toContain('Recent errors (40)')
  expect(r).toContain('e99')
  expect(r).not.toContain('e10:')
})

test('the report says whether interpolini was found and what is missing', () => {
  const base = { appVersion: '1', versions: {}, platform: 'win32', arch: 'x64', osRelease: '10', memoryGb: 8, cpuCount: 4, gpu: {}, ffmpeg: 'ok', ffprobe: 'ok', uncleanLastRun: false, settings: { theme: 't', mods: [] as string[] }, home: 'C:\\Users\\Someone', user: 'Someone' }
  expect(buildReport({ ...base, interpolini: 'found (vlcut > interpolini); ready; missing libraries: swresample-' })).toContain('interpolini: found (vlcut > interpolini); ready; missing libraries: swresample-')
  expect(buildReport(base)).not.toContain('interpolini:')
})
