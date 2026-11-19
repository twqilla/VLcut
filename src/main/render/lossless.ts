/** Lossless export: copies the original video and audio data, cutting only at the requested points. */
import { spawn } from 'node:child_process'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { LosslessSegment } from '@shared/render/lossless'
import { toolPath } from '../media/tools'

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(toolPath('ffmpeg'), ['-y', '-v', 'error', ...args])
    let err = ''
    proc.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited with code ${code}`))))
  })
}

/**
 * Nothing is re-encoded, so quality and frame rate are exactly the source's.
 * Video can only start on a keyframe, so each cut begins at the keyframe at or before the chosen point.
 */
export async function exportLossless(segments: LosslessSegment[], outputPath: string, dropAudio = false): Promise<void> {
  const ext = extname(outputPath).toLowerCase() === '.mov' ? 'mov' : 'mp4'
  const work = await mkdtemp(join(tmpdir(), 'vlcut-lossless-'))
  const part = `${outputPath}.part`
  const cut = (seg: LosslessSegment, out: string, format: string): Promise<void> =>
    ffmpeg(['-ss', String(seg.start), '-i', seg.path, '-t', String(seg.duration), '-map', '0:v:0', ...(dropAudio ? ['-an'] : ['-map', '0:a?']), '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...(format === 'mpegts' ? [] : ['-movflags', '+faststart']), '-f', format, out])
  try {
    if (segments.length === 1) {
      await cut(segments[0], part, ext)
    } else {
      // Cut each piece, then join the pieces; all still plain copies.
      const pieces: string[] = []
      for (const [i, seg] of segments.entries()) {
        const piece = join(work, `${i}.mkv`)
        await cut(seg, piece, 'matroska')
        pieces.push(piece)
      }
      const list = join(work, 'list.txt')
      await writeFile(list, pieces.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')
      await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', '-f', ext, part])
    }
    await rename(part, outputPath)
  } catch (err) {
    await rm(part, { force: true })
    throw err
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
