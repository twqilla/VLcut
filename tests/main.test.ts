import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { SFX_NAMES, ensureSfx } from '../src/main/audio/sfx'
import { parseWhisperJson } from '../src/main/subtitles/whisper'
import { ProjectStore } from '../src/main/projects/projectStore'

const dir = mkdtempSync(join(tmpdir(), 'vlcut-main-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('built-in sound effects are synthesised and audible', async () => {
  const assets = await ensureSfx(join(dir, 'sfx'), SFX_NAMES)
  expect(assets.map((a) => a.builtinSfx)).toEqual(SFX_NAMES)
  for (const a of assets) {
    expect(a.kind).toBe('audio')
    expect(a.duration).toBeGreaterThan(0.05)
    const log = execFileSync('sh', ['-c', `ffmpeg -i "${a.path}" -af volumedetect -f null - 2>&1`]).toString()
    const peak = Number(/max_volume: (-?[\d.]+)/.exec(log)![1])
    expect(peak, a.name).toBeGreaterThan(-20)
    expect(peak, a.name).toBeLessThanOrEqual(0)
  }
  const again = await ensureSfx(join(dir, 'sfx'), SFX_NAMES) // second call reuses the files
  expect(again).toHaveLength(SFX_NAMES.length)
}, 60000)

test('whisper.cpp output becomes clean words', () => {
  const seg = (from: number, to: number, text: string) => ({ offsets: { from, to }, text })
  const { words, language } = parseWhisperJson({
    result: { language: 'en' },
    transcription: [seg(0, 300, ' Hello'), seg(300, 320, ','), seg(320, 700, ' wor'), seg(700, 900, 'ld'), seg(900, 950, '.'), seg(950, 2000, ' [MUSIC]'), seg(2000, 2400, " It's"), seg(2400, 2400, ' fine')]
  })
  expect(language).toBe('en')
  expect(words.map((w) => w.text)).toEqual(['Hello,', 'world.', "It's", 'fine'])
  expect(words[1]).toMatchObject({ start: 0.32, end: 0.95 })
  expect(words[3].end).toBeGreaterThan(words[3].start)
})

test('snapshots are written, listed newest first and restorable', async () => {
  const store = new ProjectStore(join(dir, 'projects'))
  const project = await store.create('Snap')
  await store.snapshot(project, 'Before: make it cinematic!')
  await new Promise((r) => setTimeout(r, 5))
  await store.snapshot({ ...project, name: 'Later' }, 'Second')
  const list = await store.snapshots(project.id)
  expect(list.map((s) => s.label)).toEqual(['Second', 'Before make it cinematic'])
  expect((await store.loadSnapshot(project.id, list[1].file)).name).toBe('Snap')
  await expect(store.loadSnapshot(project.id, '../project.json')).rejects.toThrow()
})

test('files the app cannot decode get an H.264 proxy', async () => {
  const { makeProxy, needsProxy } = await import('../src/main/media/proxy')
  const { probeMedia } = await import('../src/main/media/probe')
  const src = join(dir, 'mpeg2.mpg')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=1:s=320x240:r=25', '-f', 'lavfi', '-i', 'sine=d=1', '-c:v', 'mpeg2video', '-c:a', 'mp2', src])
  const asset = await probeMedia(src)
  expect(needsProxy(asset)).toBe(true)
  expect(needsProxy({ kind: 'video', videoCodec: 'h264' })).toBe(false)
  const proxy = await makeProxy(asset, join(dir, 'proxies'))
  const probed = await probeMedia(proxy)
  expect(probed).toMatchObject({ videoCodec: 'h264', hasAudio: true, width: 320 })
  expect(await makeProxy(asset, join(dir, 'proxies'))).toBe(proxy) // cached
}, 60000)

test('render copies cover only the used footage and keep frame timing', async () => {
  const { prepareRenderSources, usedRanges } = await import('../src/main/render/sources')
  const { probeMedia } = await import('../src/main/media/probe')
  const { clipFromAsset, makeTrack } = await import('../src/shared/timeline/model')
  const src = join(dir, 'long.mp4')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=12:s=320x240:r=25', '-pix_fmt', 'yuv420p', src])
  const asset = await probeMedia(src)
  const track = makeTrack('video', 'V')
  track.clips.push({ ...clipFromAsset(asset, 0), sourceIn: 6, duration: 2 })
  const project = { formatVersion: 1 as const, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 320, height: 240, fps: 25 }, media: [asset], tracks: [track] }
  expect(usedRanges(project).get(asset.id)).toEqual({ start: 5, end: 9.5 })
  const prepared = await prepareRenderSources(project, dir, () => {}, () => {})
  const copy = prepared.media[0]
  expect(copy.proxyOffset).toBe(5)
  const probed = await probeMedia(copy.proxyPath!)
  expect(probed.duration).toBeCloseTo(4.5, 1)
  // Every frame is a keyframe.
  const flags = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=flags', '-of', 'csv=p=0', copy.proxyPath!]).toString().trim().split('\n')
  expect(flags.every((f) => f.startsWith('K'))).toBe(true)
  // The frame at source time 6 s is at 1 s in the copy (testsrc burns the second counter into the picture).
  const frame = (file: string, t: number) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=32:24', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
  const [a, b] = [frame(src, 6), frame(copy.proxyPath!, 1)]
  const diff = a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length
  expect(diff).toBeLessThan(3)
}, 60000)

test('lossless export keeps 240 fps footage untouched and joins cuts', async () => {
  const { exportLossless } = await import('../src/main/render/lossless')
  const { losslessPlan } = await import('../src/shared/render/lossless')
  const { probeMedia } = await import('../src/main/media/probe')
  const { clipFromAsset, makeTrack } = await import('../src/shared/timeline/model')
  const { makeEffect } = await import('../src/shared/effects/registry')
  const src = join(dir, 'fast240.mp4')
  // 4 s at 240 fps with a keyframe every 0.5 s.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=4:s=320x240:r=240', '-f', 'lavfi', '-i', 'sine=d=4', '-g', '120', '-pix_fmt', 'yuv420p', '-shortest', src])
  const asset = await probeMedia(src)
  expect(asset.fps).toBe(240)
  const track = makeTrack('video', 'V')
  track.clips.push({ ...clipFromAsset(asset, 0), sourceIn: 0.5, duration: 1 }, { ...clipFromAsset(asset, 1), sourceIn: 2.5, duration: 1 })
  const project = { formatVersion: 1 as const, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 320, height: 240, fps: 30 }, media: [asset], tracks: [makeTrack('text', 'T'), track, makeTrack('audio', 'A')] }
  const plan = losslessPlan(project)
  expect(plan).toEqual({ ok: true, dropAudio: false, segments: [{ path: src, start: 0.5, duration: 1 }, { path: src, start: 2.5, duration: 1 }] })

  const out = join(dir, 'lossless.mp4')
  if (plan.ok) await exportLossless(plan.segments, out)
  const result = await probeMedia(out)
  expect(result).toMatchObject({ width: 320, height: 240, videoCodec: 'h264', hasAudio: true })
  // Frames keep their 240 fps spacing; the average dips slightly because audio makes the join a few ms long.
  expect(result.fps).toBeGreaterThan(235)
  expect(result.fps).toBeLessThanOrEqual(240)
  const frames = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', out]).toString())
  expect(Math.abs(frames - 480)).toBeLessThanOrEqual(8)
  expect(result.duration).toBeGreaterThan(1.9)
  expect(result.duration).toBeLessThan(2.2)
  // Copied, not re-encoded: packet sizes match the source's (the first keyframe also carries stream headers).
  const sizes = (file: string, from: number) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-read_intervals', `${from}%+0.2`, '-show_entries', 'packet=size', '-of', 'csv=p=0', file]).toString().trim().split('\n').slice(1, 40).join(',')
  expect(sizes(out, 0)).toBe(sizes(src, 0.5))

  // Anything that changes the picture rules it out, with a reason.
  const withFx = { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c, i) => (i === 0 ? { ...c, effects: [makeEffect('blur')] } : c)) })) }
  expect(losslessPlan(withFx)).toEqual({ ok: false, reason: 'a clip has effects' })
  const gap = { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c, i) => (i === 1 ? { ...c, start: 3 } : c)) })) }
  expect(losslessPlan(gap)).toMatchObject({ ok: false, reason: 'there are gaps between clips' })
}, 60000)


test('files in every offered video container can be imported', async () => {
  const { probeMedia } = await import('../src/main/media/probe')
  const { VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, IMPORT_FILTERS } = await import('../src/shared/mediaTypes')
  expect(new Set(VIDEO_EXTENSIONS).size).toBe(VIDEO_EXTENSIONS.length)
  expect([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS].every((e) => /^[a-z0-9]+$/.test(e))).toBe(true)
  expect(IMPORT_FILTERS.at(-1)).toEqual({ name: 'All files', extensions: ['*'] })
  // Containers FFmpeg can write here; each is made with a codec that container normally holds.
  const cases: [string, string[]][] = [
    ['mkv', ['-c:v', 'libx264']], ['avi', ['-c:v', 'mpeg4']], ['ts', ['-c:v', 'libx264']], ['mts', ['-c:v', 'libx264', '-f', 'mpegts']], ['m2ts', ['-c:v', 'libx264', '-f', 'mpegts']],
    ['flv', ['-c:v', 'flv1']], ['3gp', ['-c:v', 'h263', '-s', '176x144']], ['mpg', ['-c:v', 'mpeg2video']], ['wmv', ['-c:v', 'wmv2']], ['mov', ['-c:v', 'libx264']], ['webm', ['-c:v', 'libvpx']], ['m4v', ['-c:v', 'libx264']]
  ]
  for (const [ext, args] of cases) {
    const file = join(dir, `sample.${ext}`)
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=1:s=320x240:r=25', '-pix_fmt', 'yuv420p', ...args, file])
    const asset = await probeMedia(file)
    expect(asset.kind, ext).toBe('video')
    expect(asset.duration, ext).toBeGreaterThan(0.5)
  }
  // Upper-case extensions (typical of cameras) are matched by the case-insensitive file picker and probe the same.
  const upper = join(dir, 'CLIP0001.MP4')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=1:s=320x240:r=25', '-pix_fmt', 'yuv420p', upper])
  expect((await probeMedia(upper)).kind).toBe('video')
}, 120000)


test('lossless export can drop the audio and still copies the picture untouched', async () => {
  const { exportLossless } = await import('../src/main/render/lossless')
  const { probeMedia } = await import('../src/main/media/probe')
  const src = join(dir, 'with-sound.mp4')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=2:s=320x240:r=30', '-f', 'lavfi', '-i', 'sine=d=2', '-pix_fmt', 'yuv420p', '-shortest', src])
  const out = join(dir, 'silent.mp4')
  await exportLossless([{ path: src, start: 0, duration: 2 }], out, true)
  expect(await probeMedia(out)).toMatchObject({ kind: 'video', hasAudio: false, videoCodec: 'h264', width: 320 })
  const kept = join(dir, 'kept.mp4')
  await exportLossless([{ path: src, start: 0, duration: 2 }], kept, false)
  expect((await probeMedia(kept)).hasAudio).toBe(true)
}, 60000)

test('interpolini is found, run and read through its command-line contract (stand-in program)', async () => {
  const { findInterpolini, interpoliniStatus, runInterpolini } = await import('../src/main/render/interpolini')
  const { prepareRenderSources } = await import('../src/main/render/sources')
  const { probeMedia } = await import('../src/main/media/probe')
  const { DEFAULT_INTERPOLINI } = await import('../src/shared/render/interpolini')
  const { clipFromAsset, makeTrack } = await import('../src/shared/timeline/model')
  const fake = join(process.cwd(), 'tests/fake/fake-interpolini-cli.cjs')
  const log = join(dir, 'interpolini-calls.log')
  process.env.VLCUT_INTERPOLINI = fake
  process.env.FAKE_INTERPOLINI_LOG = log
  try {
    expect(await findInterpolini(dir)).toBe(fake)
    expect(await interpoliniStatus(dir)).toMatchObject({ path: fake, info: 'interpolini 0.0.0 (test stand-in)' })

    const src = join(dir, 'moving.mp4')
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=gray:s=320x180:r=30:d=1.5', '-vf', "geq=lum='255*between(X,20+N*14,50+N*14)*between(Y,60,120)':cb=128:cr=128", '-pix_fmt', 'yuv420p', src])
    const lines: string[] = []
    const out = await runInterpolini(fake, src, { ...DEFAULT_INTERPOLINI, engine: 'rife', weighting: 'gaussian' }, 30, (t) => lines.push(t), () => {})
    expect(out).toBe(join(dir, 'moving - interpolini.mp4'))
    expect(lines).toEqual(['h264  |  320x180  |  30.00 fps  |  30 frames', 'frame 1 of 2 (13 fps)', 'frame 2 of 2 (13 fps)'])
    // The real program reports the output as a bare file name when given one: it is resolved beside the clip.
    process.env.FAKE_INTERPOLINI_RELATIVE = '1'
    expect(await runInterpolini(fake, src, DEFAULT_INTERPOLINI, 30, () => {}, () => {})).toBe(join(dir, 'moving - interpolini.mp4'))
    delete process.env.FAKE_INTERPOLINI_RELATIVE
    const call = JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[0]) as string[] // the first call: RIFE, Gaussian
    expect(call.slice(0, 2)).toEqual(['-g', '-j'])
    expect(call.at(-1)).toBe(src)
    const set = call.filter((_, i) => call[i - 1] === '-s')
    expect(set).toEqual(expect.arrayContaining(['interpolation.engine=rife', 'interpolation.fps=960', 'blending.fps=30', 'blending.weighting=gaussian', 'blending.intensity=1']))

    // Through the exporter's footage step: the blurred clip becomes the copy used for rendering.
    const asset = await probeMedia(src)
    const track = makeTrack('video', 'V')
    track.clips.push({ ...clipFromAsset(asset, 0), sourceIn: 1.2, duration: 0.3 })
    const project = { formatVersion: 1 as const, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 320, height: 180, fps: 30 }, media: [asset], tracks: [track] }
    const notes: string[] = []
    const prepared = await prepareRenderSources(project, dir, () => {}, () => {}, { cli: fake, settings: DEFAULT_INTERPOLINI, blendFps: 30, onProgress: (t) => notes.push(t) })
    expect(prepared.media[0].proxyOffset).toBeGreaterThan(0.1) // the copy starts on a frame boundary just before the used part
    expect(prepared.media[0].proxyOffset).toBeLessThanOrEqual(0.2 + 1e-9)
    expect(prepared.media[0].proxyPath).toMatch(/\.mp4$/)
    expect(notes[0]).toContain('moving.mp4: h264')
    expect(notes.some((n) => n.includes('frame 2 of 2'))).toBe(true)
    const blurred = await probeMedia(prepared.media[0].proxyPath!)
    expect(blurred.fps).toBeCloseTo(30, 0)

    // A failure is reported with interpolini's own words and stops the export instead of being skipped.
    process.env.FAKE_INTERPOLINI_FAIL = 'no Vulkan device found'
    await expect(runInterpolini(fake, src, DEFAULT_INTERPOLINI, 30, () => {}, () => {})).rejects.toThrow('interpolini failed: no Vulkan device found')
    await expect(prepareRenderSources(project, dir, () => {}, () => {}, { cli: fake, settings: DEFAULT_INTERPOLINI, blendFps: 30, onProgress: () => {} })).rejects.toThrow('no Vulkan device found')
    delete process.env.FAKE_INTERPOLINI_FAIL
    await expect(runInterpolini(join(dir, 'missing-program'), src, DEFAULT_INTERPOLINI, 30, () => {}, () => {})).rejects.toThrow('could not be started')
  } finally {
    delete process.env.VLCUT_INTERPOLINI
    delete process.env.FAKE_INTERPOLINI_LOG
    delete process.env.FAKE_INTERPOLINI_FAIL
  }
  // Without the override and without the program installed, it is reported as missing.
  const none = await interpoliniStatus(join(dir, 'empty-user-dir'))
  expect(none.path).toBeNull()
  expect(none.info).toContain('not installed')
}, 120000)

test('values that reach the interpolini command line are checked', async () => {
  const { normalizeInterpolini, interpoliniArgs } = await import('../src/shared/render/interpolini')
  const bad = normalizeInterpolini({ engine: 'x; rm -rf /' as never, fps: '960; calc' as never, weighting: 'nope' as never, intensity: 999, gamma: -3, custom: [1, -2] as never, speed: 'warp' as never })
  expect(bad).toMatchObject({ engine: 'svp', fps: '960', weighting: 'equal', intensity: 10, gamma: 1, custom: [1, 2, 5], speed: 'faster' })
  expect(normalizeInterpolini({ fps: 'X16' as never, custom: [3, 1.5] }).fps).toBe('x16')
  expect(normalizeInterpolini({ fps: 'X16' as never, custom: [3, 1.5] }).custom).toEqual([3, 1.5])
  expect(interpoliniArgs(bad, 60, 'clip.mp4').every((a) => typeof a === 'string')).toBe(true)
})


test('a blurred copy is made once, keeps its sound, is reused, and failures and cancels are reported', async () => {
  const { blurRange, blurKey } = await import('../src/main/render/blurClip')
  const { probeMedia } = await import('../src/main/media/probe')
  const { DEFAULT_INTERPOLINI } = await import('../src/shared/render/interpolini')
  const fake = join(process.cwd(), 'tests/fake/fake-interpolini-cli.cjs')
  const log = join(dir, 'blur-calls.log')
  const cache = join(dir, 'blurred-cache')
  const src = join(dir, 'with-voice.mp4')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=3:s=320x180:r=60', '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-pix_fmt', 'yuv420p', '-shortest', src])
  const asset = await probeMedia(src)
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0)
  process.env.FAKE_INTERPOLINI_LOG = log
  try {
    const req = { jobId: 'j1', asset, start: 0.5, end: 2, blendFps: 30, settings: DEFAULT_INTERPOLINI }
    const progress: string[] = []
    const out = await blurRange(req, cache, fake, (t) => progress.push(t), () => {})
    expect(out.startsWith(cache)).toBe(true)
    expect(progress[0]).toBe('preparing the footage')
    expect(progress.at(-1)).toBe('adding the sound back')
    const probed = await probeMedia(out)
    expect(probed.kind).toBe('video')
    expect(probed.fps).toBeCloseTo(30, 0) // blended down to the project's frame rate
    expect(probed.hasAudio).toBe(true) // the sound of the original part came back
    expect(probed.duration).toBeGreaterThan(1.3)
    expect(probed.duration).toBeLessThan(1.7)
    expect(calls()).toBe(1)

    // Asking again for the same part with the same settings costs nothing.
    expect(await blurRange({ ...req, jobId: 'j2' }, cache, fake, () => {}, () => {})).toBe(out)
    expect(calls()).toBe(1)
    // Different settings or a different part make a different copy.
    const other = await blurRange({ ...req, jobId: 'j3', settings: { ...DEFAULT_INTERPOLINI, intensity: 2 } }, cache, fake, () => {}, () => {})
    expect(other).not.toBe(out)
    expect(calls()).toBe(2)
    expect(await blurKey({ ...req, start: 0.6 })).not.toBe(await blurKey(req))

    // A file without sound stays without sound.
    const silent = join(dir, 'silent.mp4')
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=2:s=320x180:r=30', '-pix_fmt', 'yuv420p', silent])
    const quiet = await blurRange({ ...req, jobId: 'j4', asset: await probeMedia(silent), start: 0, end: 1.5 }, cache, fake, () => {}, () => {})
    expect((await probeMedia(quiet)).hasAudio).toBe(false)

    // Errors come back in interpolini's words and nothing half-made is left in the cache.
    process.env.FAKE_INTERPOLINI_FAIL = 'out of video memory'
    await expect(blurRange({ ...req, jobId: 'j5', start: 1 }, cache, fake, () => {}, () => {})).rejects.toThrow('out of video memory')
    delete process.env.FAKE_INTERPOLINI_FAIL
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(cache).every((f) => /^[0-9a-f]{40}\.mp4$/.test(f))).toBe(true)
    await expect(blurRange({ ...req, jobId: 'j6', asset: { ...asset, kind: 'audio' } }, cache, fake, () => {}, () => {})).rejects.toThrow('Only a stretch of a video file')
  } finally {
    delete process.env.FAKE_INTERPOLINI_LOG
    delete process.env.FAKE_INTERPOLINI_FAIL
  }
}, 180000)


test('cuts for motion blur are frame-accurate, not limited to keyframes', async () => {
  const { blurRange } = await import('../src/main/render/blurClip')
  const { probeMedia } = await import('../src/main/media/probe')
  const { DEFAULT_INTERPOLINI } = await import('../src/shared/render/interpolini')
  const fake = join(process.cwd(), 'tests/fake/fake-interpolini-cli.cjs')
  // 60 fps, 4 s, ONE keyframe at the very start (-g 240): every cut below is far from a keyframe.
  // The brightness of frame N is 2*(N mod 120), so the picture tells exactly which source frame it is.
  const src = join(dir, 'sparse-keyframes.mp4')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=gray:s=160x90:r=60:d=4', '-vf', "geq=lum='2*mod(N,120)':cb=128:cr=128", '-c:v', 'libx264', '-g', '240', '-keyint_min', '240', '-sc_threshold', '0', '-crf', '8', '-pix_fmt', 'yuv420p', src])
  const keyframes = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=flags', '-of', 'csv=p=0', src]).toString().trim().split('\n').filter((f) => f.startsWith('K')).length
  expect(keyframes).toBe(1)
  const luma = (file: string, frame: number): number => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame}),scale=1:1,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'])[0]
  process.env.FAKE_INTERPOLINI_PASSTHROUGH = '1'
  try {
    const asset = await probeMedia(src)
    // Start the blurred part on source frame 50 (0.8333 s), nowhere near the keyframe at frame 0.
    const out = await blurRange({ jobId: 'acc1', asset, start: 50 / 60, end: 2.5, blendFps: 60, settings: DEFAULT_INTERPOLINI }, join(dir, 'accuracy-cache'), fake, () => {}, () => {})
    // Compare with the same frames read from the source file (FFmpeg rescales brightness a little when it reads video back).
    expect(Math.abs(luma(out, 0) - luma(src, 50))).toBeLessThanOrEqual(2) // the first frame is source frame 50, not the keyframe before it
    expect(Math.abs(luma(out, 1) - luma(src, 51))).toBeLessThanOrEqual(2)
    expect(Math.abs(luma(out, 30) - luma(src, 80))).toBeLessThanOrEqual(2) // and it keeps going frame for frame
    expect(Math.abs(luma(out, 55) - luma(src, 105))).toBeLessThanOrEqual(2)
    expect(Math.abs(luma(out, 0) - luma(src, 0))).toBeGreaterThan(50) // clearly not the keyframe's picture
    const count = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', out]).toString())
    expect(Math.abs(count - (2.5 - 50 / 60) * 60)).toBeLessThanOrEqual(2) // exactly the requested stretch
  } finally {
    delete process.env.FAKE_INTERPOLINI_PASSTHROUGH
  }
}, 120000)

test('interpolini that crashes at start is retried without the graphics add-on layers, and that is remembered', async () => {
  const { interpoliniStatus, interpoliniEnv, loadVkFix } = await import('../src/main/render/interpolini')
  const fake = join(process.cwd(), 'tests/fake/fake-interpolini-cli.cjs')
  process.env.VLCUT_INTERPOLINI = fake
  process.env.FAKE_INTERPOLINI_CRASH = '1'
  try {
    const status = await interpoliniStatus(dir)
    expect(status.info).toContain('switched off')
    expect(interpoliniEnv().VK_LOADER_LAYERS_DISABLE).toBe('~implicit~')
    await loadVkFix(dir) // a later start reads the remembered choice
    expect(interpoliniEnv().VK_LOADER_LAYERS_DISABLE).toBe('~implicit~')
    delete process.env.FAKE_INTERPOLINI_CRASH
    expect((await interpoliniStatus(dir)).info).toContain('test stand-in') // it starts normally again: the layers are left on
    expect(interpoliniEnv().VK_LOADER_LAYERS_DISABLE).toBeUndefined()
  } finally {
    delete process.env.FAKE_INTERPOLINI_CRASH
    delete process.env.VLCUT_INTERPOLINI
  }
})

test('a missing library next to interpolini is found by name', async () => {
  const { missingLibraries } = await import('../src/main/render/interpolini')
  const folder = join(dir, 'interpolini-folder')
  mkdirSync(folder, { recursive: true })
  for (const n of ['interpolini-cli.exe', 'avcodec-62.dll', 'avformat-62.dll', 'avutil-60.dll', 'swscale-9.dll', 'open_svpflow.dll', 'svpflow1_vs.dll', 'svpflow2_vs.dll', 'interpolini_rife.dll']) writeFileSync(join(folder, n), '')
  expect(await missingLibraries(join(folder, 'interpolini-cli.exe'))).toEqual(['swresample-'])
  writeFileSync(join(folder, 'swresample-6.dll'), '')
  expect(await missingLibraries(join(folder, 'interpolini-cli.exe'))).toEqual([])
})

import { refineWordTimes, shiftWords } from '../src/shared/captions/refine'

test('word times from speech recognition are put in order, spread and trimmed so captions do not skip or jump early', () => {
  // Same start time: three words share one moment, the page would jump to the last.
  const same = refineWordTimes([{ text: 'I', start: 1, end: 1 }, { text: 'do', start: 1, end: 1 }, { text: 'think', start: 1, end: 1 }, { text: 'so', start: 1.6, end: 2 }])
  expect(new Set(same.slice(0, 3).map((w) => w.start)).size).toBe(3)
  expect(same[0].start).toBe(1)
  expect(same[3].start).toBe(1.6)
  expect(same.every((w, i) => i === 0 || w.start >= same[i - 1].start)).toBe(true)
  // Out of order.
  const order = refineWordTimes([{ text: 'one', start: 2, end: 2.3 }, { text: 'two', start: 1.9, end: 2.5 }])
  expect(order[1].start).toBeGreaterThanOrEqual(order[0].start)
  // A pause handed to the next word: it starts when it is spoken, not when the last word ended.
  const pause = refineWordTimes([{ text: 'Hello', start: 0, end: 0.5 }, { text: 'again', start: 0.5, end: 4 }])
  expect(pause[1].end).toBe(4)
  expect(pause[1].start).toBeGreaterThan(3)
  // Normal words stay where they are.
  const normal = refineWordTimes([{ text: 'This', start: 0, end: 0.3 }, { text: 'is', start: 0.3, end: 0.5 }, { text: 'fine', start: 0.5, end: 0.9 }])
  expect(normal.map((w) => [w.start, w.end])).toEqual([[0, 0.3], [0.3, 0.5], [0.5, 0.9]])
  expect(shiftWords(normal, -0.05).map((w) => w.start)).toEqual([0, 0.25, 0.45])
})

test('a broken copy of interpolini is skipped in favour of one that starts', async () => {
  const { resolveInterpolini } = await import('../src/main/render/interpolini')
  const userDir = join(dir, 'resolve-user')
  const fake = join(process.cwd(), 'tests/fake/fake-interpolini-cli.cjs')
  const broken = join(userDir, 'interpolini', 'interpolini-windows-x86_64', 'interpolini-cli')
  const good = join(userDir, 'interpolini-0.1.30', 'interpolini-cli')
  for (const f of [broken, good]) mkdirSync(join(f, '..'), { recursive: true })
  writeFileSync(broken, '#!/bin/sh\nexit 5\n')
  writeFileSync(good, `#!/bin/sh\nexec node "${fake}" "$@"\n`)
  chmodSync(broken, 0o755)
  chmodSync(good, 0o755)
  delete process.env.VLCUT_INTERPOLINI
  const found = await resolveInterpolini(userDir)
  expect(found.path).toBe(good)
  expect(found.info).toContain('test stand-in')
  expect(found.info).toContain('another copy was skipped')
  rmSync(userDir, { recursive: true, force: true })
  expect((await resolveInterpolini(join(dir, 'nothing-here'))).path).toBeNull()
})
