/**
 * Export pipeline. A hidden window draws every frame with the same compositor
 * as the preview and sends raw pixels here. The picture is encoded in parts of
 * a few seconds each, so an export that is interrupted (crash, power cut, the
 * app closing) picks up from the last finished part next time. When every part
 * exists they are joined and the sound is mixed in.
 */
import { BrowserWindow, type WebContents } from 'electron'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { ExportProgress, ExportSettings, Project, RenderJob } from '@shared/types'
import { buildAudioGraph } from '@shared/render/audioGraph'
import { projectDuration } from '@shared/timeline/ops'
import { toolPath } from '../media/tools'
import { prepareRenderSources } from './sources'
import { normalizeInterpolini } from '@shared/render/interpolini'

/** Frames per part. Small enough that little work is lost, large enough to keep the file count low. */
const PART_FRAMES = Number(process.env.VLCUT_PART_FRAMES) || 240
const MAX_QUEUED_FRAMES = 3

interface Job {
  info: RenderJob
  project: Project
  settings: ExportSettings
  window: BrowserWindow
  ui: WebContents
  /** Folder beside the output holding finished parts; survives an interruption. */
  partsDir: string
  encoder: ChildProcessWithoutNullStreams | null
  encoderPart: number
  encoderError: string
  frame: number
  framesAtStart: number
  startedAt: number
  lastReport: number
  settled: boolean
  queued: number
  wake: (() => void) | null
  workDir: string | null
  killPrepare: (() => void) | null
  ready: Promise<void>
}

const jobs = new Map<string, Job>()

const partFile = (job: Job, part: number): string => join(job.partsDir, `part-${String(part).padStart(5, '0')}.mkv`)

export function videoArgs(s: ExportSettings): string[] {
  const gpu = s.encoder === 'nvenc'
  const video = s.codec === 'h265' ? ['-c:v', gpu ? 'hevc_nvenc' : 'libx265', '-tag:v', 'hvc1'] : ['-c:v', gpu ? 'h264_nvenc' : 'libx264', '-profile:v', 'high']
  const kbps = s.videoBitrateKbps ? Math.max(100, Math.min(400000, Math.round(s.videoBitrateKbps))) : 0
  const rate = kbps
    ? ['-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`, ...(gpu ? ['-rc', 'vbr'] : [])]
    : gpu ? ['-rc', 'vbr', '-cq', String(s.crf), '-b:v', '0'] : ['-crf', String(s.crf)]
  // NVENC has its own preset names (p1 fastest, p7 best); p5 is a good balance for finished files.
  const preset = gpu ? ['-preset', 'p5', '-tune', 'hq'] : ['-preset', 'fast']
  return [...video, ...rate, ...preset, '-pix_fmt', 'yuv420p', '-r', String(s.fps)]
}

/** Arguments that encode one part from raw frames on stdin. */
export function partArgs(s: ExportSettings, out: string): string[] {
  return ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${s.width}x${s.height}`, '-r', String(s.fps), '-i', 'pipe:0', ...videoArgs(s), '-f', 'matroska', out]
}

/** Arguments that join the finished parts and mix the sound into the final file. */
export function joinArgs(project: Project, s: ExportSettings, listFile: string, out: string): string[] {
  const audio = buildAudioGraph(project, 1, { normalize: s.normalizeAudio })
  const mov = extname(s.outputPath).toLowerCase() === '.mov'
  return [
    '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    ...(audio ? [...audio.inputArgs, '-filter_complex', audio.filter, '-map', '0:v', '-map', audio.output, '-c:a', 'aac', '-b:a', `${s.audioBitrateKbps}k`] : ['-map', '0:v']),
    '-c:v', 'copy', ...(s.codec === 'h265' ? ['-tag:v', 'hvc1'] : []), '-movflags', '+faststart', '-f', mov ? 'mov' : 'mp4', out
  ]
}

/** Identifies an export: the same project, settings and destination resume; anything else starts again. */
export function exportKey(project: Project, s: ExportSettings): string {
  const { updatedAt: _u, ...stable } = project
  return createHash('sha1').update(JSON.stringify([stable, s, PART_FRAMES])).digest('hex')
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(toolPath('ffmpeg'), args)
    let err = ''
    proc.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-4000)))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `FFmpeg exited with code ${code}`))))
  })
}

function report(job: Job, state: ExportProgress['state'], message?: string): void {
  if (job.ui.isDestroyed()) return
  const elapsedMs = Date.now() - job.startedAt
  const rendered = job.frame - job.framesAtStart
  const etaMs = rendered > 0 && state === 'rendering' ? (elapsedMs / rendered) * (job.info.totalFrames - job.frame) : undefined
  const progress: ExportProgress = { jobId: job.info.jobId, state, frame: job.frame, totalFrames: job.info.totalFrames, elapsedMs, etaMs, message, outputPath: job.settings.outputPath }
  job.ui.send('export:progress', progress)
}

/** `keepParts` leaves finished parts on disk so the next export of the same thing resumes. */
async function settle(job: Job, state: 'done' | 'error' | 'cancelled', message?: string, keepParts = false): Promise<void> {
  if (job.settled) return
  job.settled = true
  jobs.delete(job.info.jobId)
  job.killPrepare?.()
  job.wake?.()
  if (job.encoder && job.encoder.exitCode === null) job.encoder.kill()
  if (!job.window.isDestroyed()) job.window.destroy()
  if (job.workDir) await rm(job.workDir, { recursive: true, force: true }).catch(() => {})
  if (!keepParts) await rm(job.partsDir, { recursive: true, force: true }).catch(() => {})
  report(job, state, message)
}

function openEncoder(job: Job, part: number): void {
  const proc = spawn(toolPath('ffmpeg'), partArgs(job.settings, `${partFile(job, part)}.tmp`))
  job.encoder = proc
  job.encoderPart = part
  job.encoderError = ''
  proc.stderr.on('data', (d: Buffer) => (job.encoderError = (job.encoderError + d.toString()).slice(-4000)))
  proc.stdin.on('error', () => {}) // surfaced through the exit code instead
  proc.on('error', (err) => void settle(job, 'error', `Could not start FFmpeg: ${err.message}`, true))
}

/** Finishes the part being encoded and records it as done. */
async function closeEncoder(job: Job): Promise<void> {
  const proc = job.encoder
  if (!proc) return
  const part = job.encoderPart
  job.encoder = null
  const code = await new Promise<number | null>((resolve) => {
    proc.on('close', resolve)
    proc.stdin.end()
  })
  if (job.settled) return
  if (code !== 0) return void settle(job, 'error', job.encoderError.trim() || `FFmpeg exited with code ${code}`, true)
  await rename(`${partFile(job, part)}.tmp`, partFile(job, part))
}

/** Brings blur settings from the renderer into range. */
export function normalizeBlur(b: ExportSettings['motionBlur'] | undefined): ExportSettings['motionBlur'] {
  const mode = b?.mode === 'quick' || b?.mode === 'interpolini' ? b.mode : 'off'
  return { mode, amount: Math.max(0.05, Math.min(2, Number(b?.amount) || 0.5)), samples: Math.max(2, Math.min(48, Math.round(Number(b?.samples) || 12))), weighting: b?.weighting === 'gaussian' || b?.weighting === 'triangle' || b?.weighting === 'vegas' ? b.weighting : 'equal', interpolini: normalizeInterpolini(b?.interpolini) }
}

export async function startExport(ui: WebContents, project: Project, settings: ExportSettings, preloadPath: string, loadRenderer: (win: BrowserWindow, query: string) => void, interpoliniCli: string | null = null): Promise<string> {
  if (normalizeBlur(settings.motionBlur).mode === 'interpolini' && !interpoliniCli) throw new Error('interpolini is not installed. Use "Download interpolini" in the export dialog, or choose another motion blur.')
  const jobId = randomUUID()
  // Encoders need even dimensions.
  const s = { ...settings, width: Math.round(settings.width / 2) * 2, height: Math.round(settings.height / 2) * 2 }
  const renderProject: Project = { ...project, settings: { width: s.width, height: s.height, fps: s.fps, pixelScaling: s.pixelScaling } }
  const totalFrames = Math.max(1, Math.ceil(projectDuration(project) * s.fps - 1e-6))
  const partCount = Math.ceil(totalFrames / PART_FRAMES)

  // Reuse parts from an interrupted export of exactly this project, with these settings, to this file.
  const partsDir = `${s.outputPath}.parts`
  const key = exportKey(project, s)
  const sameExport = (await readFile(join(partsDir, 'key'), 'utf8').catch(() => '')) === key
  if (!sameExport) {
    await rm(partsDir, { recursive: true, force: true })
    await mkdir(partsDir, { recursive: true })
    await writeFile(join(partsDir, 'key'), key, 'utf8')
  }

  const window = new BrowserWindow({ show: false, width: 640, height: 360, webPreferences: { preload: preloadPath, sandbox: false, backgroundThrottling: false } })
  const job: Job = {
    info: { jobId, project: renderProject, width: s.width, height: s.height, fps: s.fps, totalFrames, motionBlur: normalizeBlur(s.motionBlur), partFrames: PART_FRAMES, doneParts: [] },
    project, settings: s, window, ui, partsDir, encoder: null, encoderPart: -1, encoderError: '', frame: 0, framesAtStart: 0, startedAt: Date.now(), lastReport: 0, settled: false, queued: 0, wake: null, workDir: null, killPrepare: null, ready: Promise.resolve()
  }
  for (let part = 0; part < partCount; part++) if (existsSync(partFile(job, part))) job.info.doneParts.push(part)
  job.frame = job.framesAtStart = Math.min(totalFrames, job.info.doneParts.length * PART_FRAMES)
  jobs.set(jobId, job)

  // If the hidden window dies or the app is closed mid-export, keep the finished parts.
  window.webContents.on('render-process-gone', (_e, details) => void settle(job, 'error', `The export was interrupted (${details.reason}). Export again to continue from where it stopped.`, true))
  window.on('closed', () => void settle(job, 'error', 'The export was interrupted. Export again to continue from where it stopped.', true))

  const resumed = job.info.doneParts.length
  job.ready = (async () => {
    job.workDir = await mkdtemp(join(tmpdir(), 'vlcut-render-'))
    const blurWithInterpolini = job.info.motionBlur.mode === 'interpolini' && interpoliniCli
    job.info.project = await prepareRenderSources(
      renderProject,
      job.workDir,
      (done, total) => report(job, 'preparing', total ? `${blurWithInterpolini ? 'Blurring footage with interpolini' : 'Preparing footage'} ${Math.min(done + 1, total)} of ${total}` : undefined),
      (kill) => (job.killPrepare = kill),
      blurWithInterpolini ? { cli: interpoliniCli, settings: job.info.motionBlur.interpolini, blendFps: s.fps, onProgress: (text) => report(job, 'preparing', `interpolini · ${text}`) } : undefined
    )
    job.killPrepare = null
    job.startedAt = Date.now()
    if (!job.settled) report(job, 'rendering', resumed ? `Continuing an interrupted export: ${resumed} of ${partCount} parts were already done.` : undefined)
  })().catch((err: Error) => void settle(job, 'error', err.message, true))
  loadRenderer(window, `render=${jobId}`)
  report(job, 'preparing', resumed ? `Continuing an interrupted export: ${resumed} of ${partCount} parts were already done.` : undefined)
  return jobId
}

export async function renderJob(jobId: string): Promise<RenderJob> {
  const job = jobs.get(jobId)
  if (!job) throw new Error('Unknown render job')
  await job.ready
  return job.info
}

/**
 * Hands frame number `frame` to the encoder of its part. A few frames may wait in line,
 * so drawing the next frame and encoding the previous one happen at the same time.
 */
export async function pushFrame(jobId: string, frame: number, pixels: ArrayBuffer): Promise<boolean> {
  const job = jobs.get(jobId)
  if (!job || job.settled) return false
  const part = Math.floor(frame / PART_FRAMES)
  if (job.encoderPart !== part || !job.encoder) {
    await closeEncoder(job)
    if (job.settled) return false
    openEncoder(job, part)
  }
  const stdin = job.encoder!.stdin
  if (!stdin.writable) return false
  job.queued++
  stdin.write(Buffer.from(pixels), () => {
    job.queued--
    job.wake?.()
  })
  while (job.queued >= MAX_QUEUED_FRAMES && !job.settled) await new Promise<void>((resolve) => (job.wake = resolve))
  job.wake = null
  job.frame++
  const lastOfPart = (frame + 1) % PART_FRAMES === 0 || frame === job.info.totalFrames - 1
  if (lastOfPart) await closeEncoder(job)
  if (Date.now() - job.lastReport > 200) {
    job.lastReport = Date.now()
    report(job, 'rendering')
  }
  return !job.settled
}

export async function finishRender(jobId: string): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) return
  report(job, 'finishing')
  try {
    await closeEncoder(job)
    if (job.settled) return
    const partCount = Math.ceil(job.info.totalFrames / PART_FRAMES)
    const list = join(job.partsDir, 'list.txt')
    const lines = Array.from({ length: partCount }, (_, part) => `file '${partFile(job, part).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    await writeFile(list, lines.join('\n'), 'utf8')
    const partPath = `${job.settings.outputPath}.part`
    await run(joinArgs(job.project, job.settings, list, partPath))
    await rename(partPath, job.settings.outputPath)
    await settle(job, 'done')
  } catch (err) {
    await rm(`${job.settings.outputPath}.part`, { force: true })
    await settle(job, 'error', (err as Error).message, true)
  }
}

export function failRender(jobId: string, message: string): void {
  const job = jobs.get(jobId)
  if (job) void settle(job, 'error', message, true)
}

/** A deliberate cancel throws the partial work away. */
export function cancelExport(jobId: string): void {
  const job = jobs.get(jobId)
  if (job) void settle(job, 'cancelled')
}

/** Tries each encoder on a tiny picture and reports whether it works, and why not when it does not. */
export async function probeEncoders(): Promise<Record<string, { ok: boolean; reason: string }>> {
  const { execFile } = await import('node:child_process')
  const { toolPath } = await import('../media/tools')
  const test = (encoder: string): Promise<{ ok: boolean; reason: string }> =>
    new Promise((resolve) =>
      execFile(toolPath('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2:r=30', '-frames:v', '3', '-c:v', encoder, '-f', 'null', '-'], { timeout: 20000 }, (err, _o, stderr) => {
        if (!err) return resolve({ ok: true, reason: '' })
        const text = stderr.toString()
        resolve({ ok: false, reason: /not found|Unknown encoder/i.test(text) ? 'This FFmpeg was built without it.' : /nvcuda|No NVENC capable devices|Cannot load|driver/i.test(text) ? 'No NVIDIA graphics card (or a driver that is too old) was found.' : text.trim().split('\n').pop()?.slice(0, 160) || 'It could not start.' })
      })
    )
  const [h264, h265] = await Promise.all([test('h264_nvenc'), test('hevc_nvenc')])
  return { h264_nvenc: h264, hevc_nvenc: h265 }
}
