/** Saves a microphone recording from the app: the browser hands over its WebM/Opus data, FFmpeg turns it into a normal 48 kHz WAV. */
import { execFile } from 'node:child_process'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '@shared/types'
import { probeMedia } from '../media/probe'
import { toolPath } from '../media/tools'

/** Longest recording accepted (bytes): about 3 hours of Opus, far more than anyone records at once. */
export const MAX_RECORDING_BYTES = 400 * 1024 * 1024

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => execFile(toolPath('ffmpeg'), args, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())))
}

export async function saveRecording(dir: string, data: Uint8Array, number: number): Promise<MediaAsset> {
  if (!data.byteLength) throw new Error('The recording is empty. Check that the microphone is not muted.')
  if (data.byteLength > MAX_RECORDING_BYTES) throw new Error('That recording is too large to save.')
  await mkdir(dir, { recursive: true })
  const stamp = Date.now()
  const raw = join(dir, `take-${stamp}.webm`)
  const out = join(dir, `Voice recording ${stamp}.wav`)
  await writeFile(raw, data)
  try {
    // Mono microphones are duplicated to both sides so the clip sits in the middle of the mix.
    await run(['-y', '-v', 'error', '-i', raw, '-vn', '-ar', '48000', '-ac', '2', out])
  } finally {
    await unlink(raw).catch(() => undefined)
  }
  const asset = await probeMedia(out)
  if (!(asset.duration > 0.05)) throw new Error('Nothing was recorded.')
  return { ...asset, name: `Voice recording ${number}` }
}
