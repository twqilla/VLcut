import type { AnimProp, Clip, Easing, Keyframe } from '../types'

/** Progress along a CSS-style cubic Bézier easing curve from (0,0) to (1,1) with control points (x1,y1), (x2,y2). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, p: number): number {
  if (p <= 0) return 0
  if (p >= 1) return 1
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const X = (t: number): number => ((ax * t + bx) * t + cx) * t
  // Find t where X(t) = p: Newton steps, then bisection if the slope is too flat to trust.
  let t = p
  for (let i = 0; i < 8; i++) {
    const err = X(t) - p
    if (Math.abs(err) < 1e-6) return ((ay * t + by) * t + cy) * t
    const slope = (3 * ax * t + 2 * bx) * t + cx
    if (Math.abs(slope) < 1e-6) break
    t -= err / slope
  }
  let [lo, hi] = [0, 1]
  t = p
  for (let i = 0; i < 40; i++) {
    const x = X(t)
    if (Math.abs(x - p) < 1e-6) break
    if (x < p) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return ((ay * t + by) * t + cy) * t
}

export function ease(easing: Easing, p: number, bezier?: [number, number, number, number]): number {
  switch (easing) {
    case 'bezier':
      return bezier ? cubicBezier(bezier[0], bezier[1], bezier[2], bezier[3], p) : p
    case 'hold':
      return 0
    case 'easeIn':
      return p * p * p
    case 'easeOut':
      return 1 - (1 - p) ** 3
    case 'easeInOut':
      return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2
    default:
      return p
  }
}

/** Value of a keyframe list at time `t` (seconds from clip start). */
export function sampleKeyframes(keyframes: Keyframe[], t: number): number {
  if (t <= keyframes[0].t) return keyframes[0].value
  const last = keyframes[keyframes.length - 1]
  if (t >= last.t) return last.value
  let i = 0
  while (keyframes[i + 1].t <= t) i++
  const a = keyframes[i]
  const b = keyframes[i + 1]
  return a.value + (b.value - a.value) * ease(a.easing, (t - a.t) / (b.t - a.t), a.bezier)
}

export function baseValue(clip: Clip, prop: AnimProp): number {
  if (prop === 'opacity') return clip.opacity
  if (prop === 'volume') return clip.volume
  return clip.transform[prop]
}

/** The animated value of a clip property at `localT` seconds into the clip. */
export function propAt(clip: Clip, prop: AnimProp, localT: number): number {
  const keyframes = clip.keyframes[prop]
  return keyframes && keyframes.length > 0 ? sampleKeyframes(keyframes, localT) : baseValue(clip, prop)
}

/** Adds a keyframe, or replaces the one already at (almost) the same time. */
export function upsertKeyframe(keyframes: Keyframe[] | undefined, kf: Keyframe, tolerance = 1 / 120): Keyframe[] {
  const rest = (keyframes ?? []).filter((k) => Math.abs(k.t - kf.t) > tolerance)
  return [...rest, kf].sort((a, b) => a.t - b.t)
}

/** Multiplier (0-1) from the clip's fade in / fade out at `localT`. */
export function fadeAt(clip: Clip, localT: number): number {
  let f = 1
  if (clip.fadeIn > 0 && localT < clip.fadeIn) f = Math.min(f, localT / clip.fadeIn)
  const fromEnd = clip.duration - localT
  if (clip.fadeOut > 0 && fromEnd < clip.fadeOut) f = Math.min(f, fromEnd / clip.fadeOut)
  return Math.max(0, Math.min(1, f))
}
