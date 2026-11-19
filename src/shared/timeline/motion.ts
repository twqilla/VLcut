/** Turns motion-analysis results (in source-picture coordinates) into clip keyframes (in project-frame coordinates). */
import type { Clip, Keyframe } from '../types'
import { decimate } from '../analysis/motion'
import { propAt } from './keyframes'

export interface Geometry {
  projectW: number
  projectH: number
  assetW: number
  assetH: number
}

/** Width and height of the picture at scale 1, as fractions of the project frame (the picture is fitted inside the frame). */
export function fitFractions(g: Geometry): { fw: number; fh: number } {
  const fit = Math.min(g.projectW / g.assetW, g.projectH / g.assetH)
  return { fw: (g.assetW * fit) / g.projectW, fh: (g.assetH * fit) / g.projectH }
}

/** Seconds into the clip at which analysed frame `i` (taken `fps` times per source second from the clip's source start) is shown. */
export function frameTime(clip: Clip, i: number, fps: number): number {
  const t = i / fps / clip.speed
  return clip.reversed ? clip.duration - t : t
}

const MAX_KEYFRAMES = 400

const toKeyframes = (clip: Clip, values: number[], fps: number, stride: number): Keyframe[] =>
  values
    .map((value, i) => ({ t: frameTime(clip, i, fps), value, easing: 'linear' as const }))
    .filter((k, i) => i % stride === 0 && k.t >= -1e-6 && k.t <= clip.duration + 1e-6)
    .map((k) => ({ ...k, t: Math.max(0, Math.min(clip.duration, k.t)) }))
    .sort((a, b) => a.t - b.t)

/** Evenly spaced indices so no more than MAX_KEYFRAMES keyframes are made. */
const strideFor = (count: number): number => Math.max(1, Math.ceil(count / MAX_KEYFRAMES))

export interface StabilizePlan {
  keyframes: { x: Keyframe[]; y: Keyframe[] }
  /** Zoom applied on top of the clip's own scale, to hide the edges that the corrections reveal. */
  zoom: number
  /** Largest correction, as a fraction of the picture's width. */
  maxShift: number
}

/** Corrections (fractions of the source picture, per analysed frame) become x/y keyframes plus a zoom that hides the borders. */
export function planStabilization(clip: Clip, g: Geometry, offsets: { x: number; y: number }[], fps: number, maxZoom = 1.35): StabilizePlan {
  const { fw, fh } = fitFractions(g)
  const peak = Math.max(0.0001, ...offsets.map((o) => Math.max(Math.abs(o.x), Math.abs(o.y))))
  // Zoom needed so the largest shift never shows the edge; if that is too much, the corrections are scaled back.
  const wanted = 1 + 2 * peak + 0.01
  const zoom = Math.min(maxZoom, wanted)
  const k = wanted > maxZoom ? (maxZoom - 1.01) / (2 * peak) : 1
  const stride = strideFor(offsets.length)
  const s = clip.transform.scale * zoom
  // Shifting by a fraction of the picture's own width moves it `fraction * width-on-screen` across the frame.
  const x = offsets.map((o) => clip.transform.x + o.x * k * fw * s)
  const y = offsets.map((o) => clip.transform.y + o.y * k * fh * s)
  return { keyframes: { x: toKeyframes(clip, x, fps, stride), y: toKeyframes(clip, y, fps, stride) }, zoom, maxShift: peak * k }
}

/** Position of a tracked point, as the (x, y) offset from the frame centre that a clip must have to sit on it. */
export function trackedPositions(clip: Clip, g: Geometry, points: { x: number; y: number }[], fps: number): { t: number; x: number; y: number }[] {
  const { fw, fh } = fitFractions(g)
  const out: { t: number; x: number; y: number }[] = []
  points.forEach((p, i) => {
    const t = frameTime(clip, i, fps)
    if (t < -1e-6 || t > clip.duration + 1e-6) return
    const lt = Math.max(0, Math.min(clip.duration, t))
    const s = propAt(clip, 'scale', lt)
    out.push({ t: lt, x: propAt(clip, 'x', lt) + (p.x - 0.5) * fw * s, y: propAt(clip, 'y', lt) + (p.y - 0.5) * fh * s })
  })
  return out
}

/** Source-picture position (0..1) of a point clicked at (px, py) in the project frame, at local time `lt`. */
export function sourcePoint(clip: Clip, g: Geometry, px: number, py: number, lt: number): { x: number; y: number } {
  const { fw, fh } = fitFractions(g)
  const s = propAt(clip, 'scale', lt)
  return { x: (px - propAt(clip, 'x', lt)) / (fw * s) + 0.5, y: (py - propAt(clip, 'y', lt)) / (fh * s) + 0.5 }
}

export interface ReframePlan {
  scale: number
  keyframes: { x: Keyframe[]; y: Keyframe[] }
}

/** Fills the frame with the picture (as in a vertical crop of a wide shot) and pans so the focus stays in view. */
export function planReframe(clip: Clip, g: Geometry, focus: { x: number; y: number }[], fps: number): ReframePlan {
  const { fw, fh } = fitFractions(g)
  // Scale at which the picture just covers the frame in both directions.
  const cover = Math.max(1 / fw, 1 / fh)
  const scale = cover * 1.0
  const [shownW, shownH] = [fw * scale, fh * scale]
  const [overflowX, overflowY] = [Math.max(0, (shownW - 1) / 2), Math.max(0, (shownH - 1) / 2)]
  const stride = strideFor(focus.length)
  // Moving the picture left shows more of its right side, so the offset is opposite to the focus position.
  const x = focus.map((f) => Math.max(-overflowX, Math.min(overflowX, -(f.x - 0.5) * shownW)))
  const y = focus.map((f) => Math.max(-overflowY, Math.min(overflowY, -(f.y - 0.5) * shownH)))
  return { scale, keyframes: { x: toKeyframes(clip, x, fps, stride), y: toKeyframes(clip, y, fps, stride) } }
}

export { decimate }
