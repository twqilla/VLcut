/**
 * Makes a motion-blurred copy of part of a video file with interpolini and keeps it on disk,
 * so a clip can use it straight away (in the preview and the export) without exporting anything.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BlurRequest } from '@shared/types'
import { normalizeInterpolini } from '@shared/render/interpolini'
import { toolPath } from '../media/tools'
import { runInterpolini } from './interpolini'
import { transcode } from './sources'
import { spawn } from 'node:child_process'

/** Identifies a blurred copy: same file, same part, same settings means the same result. */
export async function blurKey(req: BlurRequest): Promise<string> {
  const info = await stat(req.asset.path).catch(() => null)
  return createHash('sha1')
    .update(JSON.stringify([req.asset.path, info?.size, info?.mtimeMs, req.start.toFixed(4), req.end.toFixed(4), req.blendFps, normalizeInterpolini(req.settings)]))
    .digest('hex')
}

function ffmpeg(args: string[], onKill: (kill: () => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(toolPath('ffmpeg'), args)
    onKill(() => proc.kill())
    let err = ''
    proc.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-1000)))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited with code ${code}`))))
  })
}

/** Returns the path of the blurred copy, making it first if it does not exist yet. */
export async function blurRange(req: BlurRequest, cacheDir: string, cli: string, onProgress: (text: string) => void, onKill: (kill: () => void) => void): Promise<string> {
  const settings = normalizeInterpolini(req.settings)
  const blendFps = Math.max(1, Math.min(1000, Math.round(req.blendFps)))
  const start = Math.max(0, Number(req.start))
  const end = Number(req.end)
  if (!(end > start) || req.asset.kind !== 'video') throw new Error('Only a stretch of a video file can be blurred.')
  const normalized = { ...req, settings, blendFps, start, end }
  await mkdir(cacheDir, { recursive: true })
  const out = join(cacheDir, `${await blurKey(normalized)}.mp4`)
  if (existsSync(out)) return out // blurred before with exactly these settings

  const work = await mkdtemp(join(tmpdir(), 'vlcut-blur-'))
  try {
    const input = req.asset.proxyPath ?? req.asset.path
    const part = join(work, 'part.mp4')
    onProgress('preparing the footage')
    await transcode(input, part, onKill, { start, end })
    const blurred = await runInterpolini(cli, part, settings, blendFps, onProgress, onKill)
    // interpolini's copy has no sound: put the original's sound back, cut to the same part.
    onProgress('adding the sound back')
    const tmp = `${out}.part.mp4`
    await ffmpeg(
      req.asset.hasAudio
        ? ['-y', '-v', 'error', '-i', blurred, '-ss', String(start), '-t', String(end - start), '-i', input, '-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', tmp]
        : ['-y', '-v', 'error', '-i', blurred, '-map', '0:v:0', '-c:v', 'copy', '-movflags', '+faststart', tmp],
      onKill
    )
    await rename(tmp, out)
    return out
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
