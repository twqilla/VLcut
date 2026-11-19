/** Moving, scaling and turning several clips together as one group: pure helpers for the preview's group handles. */
import type { AnimProp, Clip } from '../types'
import { upsertKeyframe } from './keyframes'

export interface Vals { x: number; y: number; scale: number; rotation: number }
/** What a drag does to the group: slide it, grow it about its centre, or turn it about its centre. */
export interface GroupOp { dx?: number; dy?: number; factor?: number; degrees?: number }
export interface Rect { cx: number; cy: number; w: number; h: number; rotation: number }

/** The smallest upright box around several (possibly turned) rectangles. */
export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const r of rects) {
    const a = (r.rotation * Math.PI) / 180
    const [cos, sin] = [Math.cos(a), Math.sin(a)]
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const [px, py] = [(sx * r.w) / 2, (sy * r.h) / 2]
      const [x, y] = [r.cx + px * cos - py * sin, r.cy + px * sin + py * cos]
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rotation: 0 }
}

/**
 * New values for one clip of the group, worked out from the values it had when the drag began.
 * Positions are fractions of the frame (x of its width, y of its height), so turning happens in pixel space using `aspect` (width / height).
 */
export function applyGroupOp(start: Vals, op: GroupOp, centre: { x: number; y: number }, aspect: number): Vals {
  let { x, y, scale, rotation } = start
  if (op.factor !== undefined) {
    x = centre.x + (x - centre.x) * op.factor
    y = centre.y + (y - centre.y) * op.factor
    scale = start.scale * op.factor
  }
  if (op.degrees) {
    const a = (op.degrees * Math.PI) / 180
    const [px, py] = [x - centre.x, (y - centre.y) / aspect]
    x = centre.x + px * Math.cos(a) - py * Math.sin(a)
    y = centre.y + (px * Math.sin(a) + py * Math.cos(a)) * aspect
    rotation = start.rotation + op.degrees
  }
  if (op.dx || op.dy) {
    x += op.dx ?? 0
    y += op.dy ?? 0
  }
  return { x, y, scale, rotation }
}

/** Writes values into a clip the way the properties panel does: into a keyframe when the property is animated, otherwise into its base transform. */
export function withValues(clip: Clip, values: Partial<Vals>, timeInClip: number): Pick<Clip, 'keyframes' | 'transform'> {
  const t = Math.max(0, Math.min(clip.duration, timeInClip))
  const keyframes = { ...clip.keyframes }
  const transform = { ...clip.transform }
  for (const [prop, value] of Object.entries(values) as [keyof Vals, number][]) {
    if (keyframes[prop as AnimProp]?.length) keyframes[prop as AnimProp] = upsertKeyframe(keyframes[prop as AnimProp], { t, value, easing: 'easeInOut' })
    else transform[prop] = value
  }
  return { keyframes, transform }
}
