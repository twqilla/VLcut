/** Deterministic pseudo-random number in [0, 1) from integer seeds, so preview and export match. */
export function rand(a: number, b = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth 1-D noise in [-1, 1]. */
export function noise(x: number, seed = 0): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return (rand(i, seed) * (1 - u) + rand(i + 1, seed) * u) * 2 - 1
}

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
export const easeOut = (p: number): number => 1 - (1 - p) ** 3
export const easeInOut = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
export const easeOutBack = (p: number): number => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2

export type Ctx = CanvasRenderingContext2D

export interface Surface {
  canvas: HTMLCanvasElement
  ctx: Ctx
}

export function makeSurface(w: number, h: number): Surface {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return { canvas, ctx: canvas.getContext('2d')! }
}

/** Reusable scratch canvases keyed by slot, resized on demand. */
export class SurfacePool {
  private surfaces = new Map<string, Surface>()
  get(slot: string, w: number, h: number): Surface {
    let s = this.surfaces.get(slot)
    if (!s) this.surfaces.set(slot, (s = makeSurface(w, h)))
    if (s.canvas.width !== w || s.canvas.height !== h) {
      s.canvas.width = w
      s.canvas.height = h
    }
    s.ctx.setTransform(1, 0, 0, 1, 0, 0)
    s.ctx.globalAlpha = 1
    s.ctx.globalCompositeOperation = 'source-over'
    s.ctx.filter = 'none'
    s.ctx.clearRect(0, 0, w, h)
    return s
  }
}

export const easeOutBounce = (p: number): number => {
  const [n, d] = [7.5625, 2.75]
  if (p < 1 / d) return n * p * p
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375
  return n * (p -= 2.625 / d) * p + 0.984375
}
export const easeOutElastic = (p: number): number => (p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin(((p * 10 - 0.75) * (2 * Math.PI)) / 3) + 1)
