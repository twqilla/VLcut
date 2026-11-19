import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toolPath } from './tools'

/** Peaks per second of audio. */
export const WAVEFORM_RATE = 50
const SAMPLE_RATE = 8000
const WINDOW = SAMPLE_RATE / WAVEFORM_RATE

/** A cache key that changes when the file is replaced or edited. */
export async function fileKey(path: string): Promise<string> {
  const s = await stat(path)
  return createHash('sha1').update(`${path}|${s.size}|${s.mtimeMs}`).digest('hex')
}

/**
 * Returns one peak (0-255) per 1/50 s of the file's audio, cached on disk.
 * Decodes in a streaming fashion, so memory stays flat for long files.
 */
export async function waveform(path: string, cacheDir: string): Promise<Uint8Array> {
  const cacheFile = join(cacheDir, `${await fileKey(path)}.peaks`)
  try {
    return new Uint8Array(await readFile(cacheFile))
  } catch {
    // Not cached yet.
  }
  const peaks: number[] = []
  let peak = 0
  let count = 0
  let carry: number | null = null
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(toolPath('ffmpeg'), ['-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'])
    ff.stdout.on('data', (chunk: Buffer) => {
      let i = 0
      if (carry !== null && chunk.length) {
        chunk = Buffer.concat([Buffer.from([carry]), chunk])
        carry = null
      }
      for (; i + 1 < chunk.length; i += 2) {
        const v = Math.abs(chunk.readInt16LE(i))
        if (v > peak) peak = v
        if (++count === WINDOW) {
          peaks.push(Math.min(255, Math.round((peak / 32768) * 255)))
          peak = 0
          count = 0
        }
      }
      if (i < chunk.length) carry = chunk[i]
    })
    ff.on('error', reject)
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))))
  })
  const data = Uint8Array.from(peaks)
  await mkdir(cacheDir, { recursive: true })
  await writeFile(cacheFile, data)
  return data
}

/** A small JPEG of the frame at `time`, as a data URL, cached on disk. */
export async function thumbnail(path: string, time: number, cacheDir: string, height = 72): Promise<string> {
  const file = join(cacheDir, `${await fileKey(path)}-${Math.round(time * 10)}${height === 72 ? '' : `-${height}`}.jpg`)
  let data: Buffer
  try {
    data = await readFile(file)
  } catch {
    await mkdir(cacheDir, { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const ff = spawn(toolPath('ffmpeg'), ['-y', '-v', 'error', '-ss', String(Math.max(0, time)), '-i', path, '-frames:v', '1', '-vf', `scale=-2:${height}`, '-q:v', '5', '-f', 'image2', file])
      ff.on('error', reject)
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))))
    })
    data = await readFile(file)
  }
  return `data:image/jpeg;base64,${data.toString('base64')}`
}
