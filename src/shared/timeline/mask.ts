/** Hand-drawn (polygon) masks that change shape over time: rotoscoping. */
import type { Mask } from '../types'

type Points = [number, number][]
const TOLERANCE = 1 / 60

const usableKeys = (mask: Mask): NonNullable<Mask['keys']> => {
  const n = mask.points?.length ?? 0
  return (mask.keys ?? []).filter((k) => k.points.length === n).sort((a, b) => a.t - b.t)
}

/** Corner positions at `t` seconds into the clip: gliding between the surrounding keys, held beyond the first and last. */
export function maskPointsAt(mask: Mask, t: number): Points {
  const base = mask.points ?? []
  const keys = usableKeys(mask)
  if (!keys.length) return base
  if (t <= keys[0].t) return keys[0].points
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.points
  let i = 0
  while (keys[i + 1].t <= t) i++
  const [a, b] = [keys[i], keys[i + 1]]
  const u = (t - a.t) / (b.t - a.t)
  return a.points.map(([x, y], k) => [x + (b.points[k][0] - x) * u, y + (b.points[k][1] - y) * u])
}

/** Stores the shape as it is at `t` as a key (replacing a key at the same moment). */
export function withMaskKey(mask: Mask, t: number): Mask {
  const points = maskPointsAt(mask, t).map(([x, y]) => [x, y] as [number, number])
  const keys = usableKeys(mask).filter((k) => Math.abs(k.t - t) > TOLERANCE)
  return { ...mask, keys: [...keys, { t, points }].sort((a, b) => a.t - b.t) }
}

/** Moves one corner. With keys, the move is recorded as a key at `t`; without, it edits the plain shape. */
export function withMaskPoint(mask: Mask, t: number, index: number, point: [number, number]): Mask {
  if (!mask.points || index < 0 || index >= mask.points.length) return mask
  if (!usableKeys(mask).length) return { ...mask, points: mask.points.map((p, i) => (i === index ? point : p)) }
  const keyed = withMaskKey(mask, t)
  return { ...keyed, keys: keyed.keys!.map((k) => (Math.abs(k.t - t) <= TOLERANCE ? { ...k, points: k.points.map((p, i) => (i === index ? point : p)) } : k)) }
}

/** Adding a corner changes every key's corner count, so existing keys would no longer match; they are dropped. */
export function withoutKeys(mask: Mask): Mask {
  const { keys: _keys, ...rest } = mask
  void _keys
  return rest
}
