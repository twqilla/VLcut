/** Lines up two recordings of the same event by their sound. */
import { execFile } from 'node:child_process'
import { syncOffset, type SyncResult } from '@shared/analysis/sync'
import { toolPath } from '../media/tools'

const RATE = 8000
const SECONDS = 150

function pcm(path: string): Promise<Float32Array> {
  return new Promise((resolve, reject) =>
    execFile(toolPath('ffmpeg'), ['-v', 'error', '-t', String(SECONDS), '-i', path, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (err, out) =>
      err ? reject(new Error(`Could not read the sound of ${path.split(/[\\/]/).pop()}: ${err.message}`)) : resolve(new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + Math.floor(out.byteLength / 4) * 4)))
    )
  )
}

/** Seconds that `b` is offset from `a` (see `syncOffset`), searching ±60 s, using the first 2.5 minutes of each file. */
export async function syncFiles(a: string, b: string): Promise<SyncResult> {
  const [x, y] = await Promise.all([pcm(a), pcm(b)])
  if (x.length < RATE || y.length < RATE) throw new Error('One of the clips has no usable sound to line up by.')
  return syncOffset(x, y, RATE, 60)
}
