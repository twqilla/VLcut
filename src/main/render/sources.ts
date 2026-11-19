/**
 * Export speed-up. Drawing each frame means seeking the source video, and a
 * seek decodes everything since the previous keyframe; ordinary files have a
 * keyframe only every few seconds. Before rendering we therefore make a
 * visually lossless copy of just the footage the timeline uses, with every
 * frame a keyframe, and render from that.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { MediaAsset, Project } from '@shared/types'
import { toolPath } from '../media/tools'
import type { InterpoliniSettings } from '@shared/render/interpolini'
import { runInterpolini } from './interpolini'

/** For each video file on the timeline, the stretch of source the clips use. */
export function usedRanges(project: Project): Map<string, { start: number; end: number }> {
  const ranges = new Map<string, { start: number; end: number }>()
  const assets = new Map(project.media.map((m) => [m.id, m]))
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.hidden) continue
    for (const clip of track.clips) {
      const asset = clip.assetId ? assets.get(clip.assetId) : undefined
      if (!asset || asset.kind !== 'video' || asset.missing) continue
      // One extra second each side covers transitions, which keep the outgoing clip running.
      const start = Math.max(0, clip.sourceIn - 1)
      const end = Math.min(asset.duration, clip.sourceIn + clip.duration * clip.speed + 1.5)
      const cur = ranges.get(asset.id)
      ranges.set(asset.id, cur ? { start: Math.min(cur.start, start), end: Math.max(cur.end, end) } : { start, end })
    }
  }
  return ranges
}

function ffmpegRun(args: string[], onKill: (kill: () => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(toolPath('ffmpeg'), args)
    onKill(() => proc.kill())
    let err = ''
    proc.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-1000)))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited with code ${code}`))))
  })
}

/** An all-keyframe, picture-only, visually lossless copy of part of a file (or all of it when no range is given). */
export function transcode(input: string, out: string, onKill: (kill: () => void) => void, range?: { start: number; end: number }): Promise<void> {
  return ffmpegRun(['-y', '-v', 'error', ...(range ? ['-ss', String(range.start), '-t', String(range.end - range.start)] : []), '-i', input, '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-g', '1', '-pix_fmt', 'yuv420p', '-f', 'mp4', out], onKill)
}

export interface InterpoliniOptions {
  cli: string
  settings: InterpoliniSettings
  /** Frame rate of the export: interpolini blends down to exactly this, one blended frame per output frame. */
  blendFps: number
  onProgress: (text: string) => void
}

/**
 * Returns a copy of the project whose video files point at fast-seeking render copies in `dir`.
 * If a copy cannot be made the original file is used, which is slower but still correct.
 */
export async function prepareRenderSources(project: Project, dir: string, onProgress: (done: number, total: number) => void, onKill: (kill: () => void) => void, interpolini?: InterpoliniOptions): Promise<Project> {
  const ranges = [...usedRanges(project)]
  const replaced = new Map<string, MediaAsset>()
  let done = 0
  onProgress(0, ranges.length)
  for (const [assetId, range] of ranges) {
    const asset = project.media.find((m) => m.id === assetId)!
    // Start on a frame boundary so source times still line up exactly.
    const fps = asset.fps ?? 30
    const start = Math.floor(range.start * fps) / fps
    const out = join(dir, `${assetId}.mp4`)
    const input = asset.proxyPath ?? asset.path
    if (interpolini && !asset.blurredFrom) {
      // The used stretch goes to interpolini as a plain picture-only clip; what it returns (already blurred,
      // at the export's frame rate) becomes the fast-seeking copy. A failure stops the export with its message:
      // a blur that silently did not happen would be worse than an error.
      const part = join(dir, `${assetId}-source.mp4`)
      await transcode(input, part, onKill, { start, end: range.end })
      const blurred = await runInterpolini(interpolini.cli, part, interpolini.settings, interpolini.blendFps, (text) => interpolini.onProgress(`${asset.name}: ${text}`), onKill)
      await transcode(blurred, out, onKill)
      replaced.set(assetId, { ...asset, proxyPath: out, proxyOffset: start })
    } else {
      try {
        await transcode(input, out, onKill, { start, end: range.end })
        replaced.set(assetId, { ...asset, proxyPath: out, proxyOffset: start })
      } catch {
        // Fall back to the original for this file.
      }
    }
    onProgress(++done, ranges.length)
  }
  return { ...project, media: project.media.map((m) => replaced.get(m.id) ?? m) }
}
