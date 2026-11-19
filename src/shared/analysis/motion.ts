/** Motion maths on small greyscale frames: camera shake, point tracking and subject-following. Pure functions, no I/O. */

export interface Shift {
  dx: number
  dy: number
  /** 0..1: how clearly one shift beat the others (flat or repeating pictures score low). */
  confidence: number
}

/** Sum of absolute differences between `a` and `b` displaced by (sx, sy), over a block, sampled every `step` pixels. */
function sad(a: Uint8Array, b: Uint8Array, w: number, x0: number, y0: number, bw: number, bh: number, sx: number, sy: number, step: number): number {
  let sum = 0
  for (let y = y0; y < y0 + bh; y += step) {
    const ra = y * w
    const rb = (y + sy) * w + sx
    for (let x = x0; x < x0 + bw; x += step) sum += Math.abs(a[ra + x] - b[rb + x])
  }
  return sum
}

/** Parabola fitted through three cost samples; the offset (-0.5..0.5) of its minimum from the middle one. */
function refine(l: number, c: number, r: number): number {
  const d = l - 2 * c + r
  return d > 1e-9 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * d))) : 0
}

/** Best shift of one block, to a fraction of a pixel, and how clearly it beat the alternatives. */
function blockShift(a: Uint8Array, b: Uint8Array, w: number, x0: number, y0: number, bw: number, bh: number, search: number, step: number): Shift {
  const size = 2 * search + 1
  const cost = new Float64Array(size * size)
  let best = Infinity
  let second = Infinity
  let bx = 0
  let by = 0
  for (let sy = -search; sy <= search; sy++) {
    for (let sx = -search; sx <= search; sx++) {
      const c = sad(a, b, w, x0, y0, bw, bh, sx, sy, step)
      cost[(sy + search) * size + sx + search] = c
      const far = Math.abs(sx - bx) > 1 || Math.abs(sy - by) > 1
      if (c < best) {
        // The old best becomes the runner-up only if it is not just a neighbouring shift of the new best.
        if (far) second = Math.min(second, best)
        best = c
        bx = sx
        by = sy
      } else if (far && c < second) second = c
    }
  }
  const at = (x: number, y: number): number => cost[(y + search) * size + x + search]
  const fx = bx > -search && bx < search ? refine(at(bx - 1, by), at(bx, by), at(bx + 1, by)) : 0
  const fy = by > -search && by < search ? refine(at(bx, by - 1), at(bx, by), at(bx, by + 1)) : 0
  const confidence = Number.isFinite(second) && second > 0 ? Math.max(0, Math.min(1, 1 - best / second)) * 4 : 0
  return { dx: bx + fx, dy: by + fy, confidence: Math.min(1, confidence) }
}

const median = (v: number[]): number => {
  const s = [...v].sort((p, q) => p - q)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

/**
 * How far the picture content moved from frame `a` to frame `b` (positive dx = content moved right),
 * to a fraction of a pixel. The frame is cut into a grid of blocks that each find their own shift, and the
 * median wins, so a big moving subject covering part of the frame does not drag the estimate away from the background.
 */
export function estimateShift(a: Uint8Array, b: Uint8Array, w: number, h: number, search = 8, step = 2): Shift {
  const m = search + 1
  const cols = 3
  const rows = 3
  const [bw, bh] = [Math.floor((w - 2 * m) / cols), Math.floor((h - 2 * m) / rows)]
  const found: Shift[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) found.push(blockShift(a, b, w, m + c * bw, m + r * bh, bw, bh, search, step))
  // Blocks over flat picture match everywhere and say nothing; use only the ones with a clear winner (if any).
  const sure = found.filter((f) => f.confidence >= 0.1)
  const use = sure.length >= 3 ? sure : found
  return { dx: median(use.map((f) => f.dx)), dy: median(use.map((f) => f.dy)), confidence: median(use.map((f) => f.confidence)) }
}

/** Positions of the content over time: running total of frame-to-frame shifts (first frame = 0,0). */
export function cumulativePath(shifts: { dx: number; dy: number }[]): { x: number; y: number }[] {
  const path = [{ x: 0, y: 0 }]
  for (const s of shifts) {
    const last = path[path.length - 1]
    path.push({ x: last.x + s.dx, y: last.y + s.dy })
  }
  return path
}

/** Moving average with the window shrinking at the ends, so the path keeps its own start and finish. */
export function smooth(values: number[], radius: number): number[] {
  const out: number[] = []
  const prefix = [0]
  for (const v of values) prefix.push(prefix[prefix.length - 1] + v)
  for (let i = 0; i < values.length; i++) {
    const r = Math.min(radius, i, values.length - 1 - i)
    out.push((prefix[i + r + 1] - prefix[i - r]) / (2 * r + 1))
  }
  return out
}

/**
 * Shifts (in analysis pixels) that make a shaky sequence steady: each frame is moved so that its content
 * follows the smoothed camera path instead of the raw one. Slow, deliberate moves survive; jitter does not.
 */
export function stabilizationOffsets(shifts: { dx: number; dy: number }[], radius: number): { x: number; y: number }[] {
  const path = cumulativePath(shifts)
  const sx = smooth(path.map((p) => p.x), radius)
  const sy = smooth(path.map((p) => p.y), radius)
  return path.map((p, i) => ({ x: sx[i] - p.x, y: sy[i] - p.y }))
}

export interface TrackResult {
  /** Position in analysis pixels for every frame that was tracked (index 0 is the start point). */
  points: { x: number; y: number }[]
  /** Index of the first frame where the match became unreliable, if it did. */
  lostAt?: number
}

/** Follows a small patch of picture from frame to frame by template matching around its last position. */
export function trackPoint(frames: Uint8Array[], w: number, h: number, start: { x: number; y: number }, patch = 14, search = 10): TrackResult {
  const half = Math.floor(patch / 2)
  const clampX = (x: number): number => Math.max(half + search, Math.min(w - half - search - 1, x))
  const clampY = (y: number): number => Math.max(half + search, Math.min(h - half - search - 1, y))
  let [cx, cy] = [Math.round(clampX(start.x)), Math.round(clampY(start.y))]
  const template = new Float32Array(patch * patch)
  const grab = (f: Uint8Array, x: number, y: number, into: Float32Array, blend: number): void => {
    for (let j = 0; j < patch; j++) for (let i = 0; i < patch; i++) into[j * patch + i] = into[j * patch + i] * (1 - blend) + f[(y - half + j) * w + x - half + i] * blend
  }
  grab(frames[0], cx, cy, template, 1)
  const points = [{ x: start.x, y: start.y }]
  let [fx, fy] = [start.x, start.y]
  for (let n = 1; n < frames.length; n++) {
    const f = frames[n]
    let best = Infinity
    let [bx, by] = [cx, cy]
    for (let sy = -search; sy <= search; sy++) {
      for (let sx = -search; sx <= search; sx++) {
        const [x, y] = [cx + sx, cy + sy]
        if (x - half < 0 || y - half < 0 || x + half >= w || y + half >= h) continue
        let sum = 0
        for (let j = 0; j < patch && sum < best; j++) for (let i = 0; i < patch; i++) sum += Math.abs(f[(y - half + j) * w + x - half + i] - template[j * patch + i])
        // A tiny pull toward the previous spot breaks ties on flat areas.
        sum += (Math.abs(sx) + Math.abs(sy)) * 0.5
        if (sum < best) [best, bx, by] = [sum, x, y]
      }
    }
    // A real match differs from the patch by far less than the patch's own detail; a new shot or an occlusion does not.
    let mean = 0
    for (const v of template) mean += v
    mean /= template.length
    let detail = 0
    for (const v of template) detail += Math.abs(v - mean)
    detail /= template.length
    if (best / (patch * patch) > detail * 0.7 + 5) return { points, lostAt: n }
    fx += bx - cx
    fy += by - cy
    ;[cx, cy] = [bx, by]
    cx = Math.round(clampX(cx))
    cy = Math.round(clampY(cy))
    // Let the template follow slow changes in lighting and angle.
    grab(f, cx, cy, template, 0.12)
    points.push({ x: fx, y: fy })
  }
  return { points }
}

/**
 * Where the action is, frame by frame, as fractions of the picture: the centre of whatever moves,
 * or of the busiest detail where nothing moves. Smoothed so a virtual camera following it glides.
 */
export function focusPath(frames: Uint8Array[], w: number, h: number, radius: number): { x: number; y: number }[] {
  const raw: { x: number; y: number; weight: number }[] = []
  for (let n = 0; n < frames.length; n++) {
    const f = frames[n]
    const prev = frames[Math.max(0, n - 1)]
    let sum = 0
    let sx = 0
    let sy = 0
    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
        const i = y * w + x
        const motion = n > 0 ? Math.abs(f[i] - prev[i]) : 0
        const detail = Math.abs(f[i + 1] - f[i - 1]) + Math.abs(f[i + w] - f[i - w])
        const v = motion > 12 ? motion * 3 : motion > 4 ? motion : detail * 0.15
        sum += v
        sx += v * x
        sy += v * y
      }
    }
    raw.push(sum > 0 ? { x: sx / sum / w, y: sy / sum / h, weight: sum } : { x: 0.5, y: 0.5, weight: 0 })
  }
  // Frames with no signal borrow from their neighbours.
  const xs = smooth(raw.map((r, i) => (r.weight > 0 ? r.x : raw[i - 1]?.x ?? 0.5)), radius)
  const ys = smooth(raw.map((r, i) => (r.weight > 0 ? r.y : raw[i - 1]?.y ?? 0.5)), radius)
  return xs.map((x, i) => ({ x, y: ys[i] }))
}

/** Keeps roughly `target` evenly spaced items of a list (always including the last one). */
export function decimate<T>(items: T[], target: number): T[] {
  if (items.length <= target) return items
  const stride = Math.ceil(items.length / target)
  const out = items.filter((_, i) => i % stride === 0)
  if (out[out.length - 1] !== items[items.length - 1]) out.push(items[items.length - 1])
  return out
}
