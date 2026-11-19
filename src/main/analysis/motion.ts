/** Camera stabilisation, point tracking and subject following on the footage itself (no network, no models). */
import { execFile } from 'node:child_process'
import { decimate, estimateShift, focusPath, stabilizationOffsets, trackPoint } from '@shared/analysis/motion'
import type { MotionRequest, MotionResult, TrackRequest, TrackResult } from '@shared/types'
import { toolPath } from '../media/tools'

const W = 320
const H = 180

/** Greyscale frames from a stretch of source footage, `fps` per source second. */
function grayFrames(path: string, start: number, duration: number, fps: number): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-ss', String(Math.max(0, start)), '-t', String(duration), '-i', path, '-an', '-vf', `fps=${fps},scale=${W}:${H}`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-']
    execFile(toolPath('ffmpeg'), args, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(`Could not read frames for analysis: ${err.message}`))
      const size = W * H
      const frames: Uint8Array[] = []
      for (let i = 0; (i + 1) * size <= stdout.length; i++) frames.push(new Uint8Array(stdout.buffer, stdout.byteOffset + i * size, size))
      resolve(frames)
    })
  })
}

const clampRange = (r: MotionRequest): { start: number; duration: number } => ({ start: r.sourceStart, duration: Math.max(0.2, Math.min(r.sourceDuration, 600)) })

/** Steady footage: how far to move each analysed frame (as fractions of the picture) to cancel the shake. */
export async function stabilize(req: MotionRequest): Promise<MotionResult> {
  const fps = 20
  const { start, duration } = clampRange(req)
  const frames = await grayFrames(req.path, start, duration, fps)
  if (frames.length < 4) throw new Error('That clip is too short to analyse.')
  const shifts = frames.slice(1).map((b, i) => estimateShift(frames[i], b, W, H, 8))
  // A hard cut makes a huge false shift; drop frames the matcher is unsure about.
  const trusted = shifts.map((s) => (s.confidence < 0.05 || Math.hypot(s.dx, s.dy) > 7.5 ? { dx: 0, dy: 0 } : s))
  const offsets = stabilizationOffsets(trusted, Math.max(2, Math.round(fps * (req.smoothSeconds ?? 0.8))))
  return { fps, points: offsets.map((o) => ({ x: o.x / W, y: o.y / H })) }
}

/** Follows the point (0..1 of the picture) forward through the clip. */
export async function track(req: TrackRequest): Promise<TrackResult> {
  const fps = 20
  const { start, duration } = clampRange(req)
  const frames = await grayFrames(req.path, start, duration, fps)
  if (frames.length < 2) throw new Error('Nothing to track from that point.')
  const result = trackPoint(frames, W, H, { x: req.point.x * W, y: req.point.y * H })
  return { fps, points: result.points.map((p) => ({ x: p.x / W, y: p.y / H })), lostAt: result.lostAt }
}

/** The centre of interest through the clip, for choosing where to crop a wide shot. */
export async function focus(req: MotionRequest): Promise<MotionResult> {
  const fps = 6
  const { start, duration } = clampRange(req)
  const frames = await grayFrames(req.path, start, duration, fps)
  if (frames.length < 2) throw new Error('That clip is too short to analyse.')
  return { fps, points: decimate(focusPath(frames, W, H, Math.max(2, Math.round(fps * 0.8))), 1000) }
}
