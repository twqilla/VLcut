import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '@shared/types'
import { toolPath } from './tools'
import { fileKey } from './waveform'

/** Video codecs the app's built-in decoder plays directly. Anything else gets an H.264 stand-in. */
const NATIVE = new Set(['h264', 'vp8', 'vp9', 'av1'])

export function needsProxy(asset: Pick<MediaAsset, 'kind' | 'videoCodec'>): boolean {
  return asset.kind === 'video' && !NATIVE.has(asset.videoCodec ?? '')
}

/**
 * Makes (or reuses) a visually lossless H.264 copy of a file the app cannot decode itself,
 * such as ProRes, HEVC or MPEG-2. Used for both preview and export.
 */
export async function makeProxy(asset: MediaAsset, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const out = join(dir, `${await fileKey(asset.path)}.mp4`)
  if (existsSync(out)) return out
  const part = `${out}.part`
  await new Promise<void>((resolve, reject) =>
    execFile(toolPath('ffmpeg'), ['-y', '-v', 'error', '-i', asset.path, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', '15', '-c:a', 'aac', '-b:a', '256k', '-f', 'mp4', part], { maxBuffer: 1 << 24 }, (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()))
  )
  await rename(part, out)
  return out
}
