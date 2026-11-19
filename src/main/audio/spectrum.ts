/** Frequency bands of a file's sound over time, for the audio visualiser. Cached in memory by file version. */
import { execFile } from 'node:child_process'
import { spectrumOf, type Spectrum } from '@shared/analysis/spectrum'
import { fileKey } from '../media/waveform'
import { toolPath } from '../media/tools'

const RATE = 22050
const cache = new Map<string, Spectrum>()

export async function spectrum(path: string, fps = 30, bands = 48): Promise<Spectrum> {
  const key = `${await fileKey(path)}|${fps}|${bands}`
  const hit = cache.get(key)
  if (hit) return hit
  const pcm = await new Promise<Buffer>((resolve, reject) =>
    execFile(toolPath('ffmpeg'), ['-v', 'error', '-t', '1800', '-i', path, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 512 }, (err, stdout) => (err ? reject(new Error(`Could not read the audio: ${err.message}`)) : resolve(stdout)))
  )
  const samples = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + Math.floor(pcm.byteLength / 4) * 4))
  const result = spectrumOf(samples, RATE, fps, bands)
  if (cache.size > 12) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}
