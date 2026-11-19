/** Compositing effects: keying, shadows, strokes, corners, reflection, perspective and LUTs. */
import { sampleLut } from '@shared/color/cube'
import { type EffectEnv, type Post, POST, rewrite } from './effects'
import { pixels } from './effects2'
import { type Surface, clamp01 } from './util'

const rgb = (packed: number): [number, number, number] => [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]
const css = (packed: number, alpha = 1): string => {
  const [r, g, b] = rgb(packed)
  return `rgba(${r},${g},${b},${alpha})`
}

/** Smallest box holding every visible pixel, in layer pixels; null when the layer is empty. */
function alphaBounds(layer: Surface, env: EffectEnv): { x0: number; y0: number; x1: number; y1: number } | null {
  const div = 8
  const [w, h] = [Math.max(8, Math.round(env.W / div)), Math.max(8, Math.round(env.H / div))]
  const small = env.pool.get('fx-bounds', w, h)
  small.ctx.drawImage(layer.canvas, 0, 0, w, h)
  const d = small.ctx.getImageData(0, 0, w, h).data
  let [x0, y0, x1, y1] = [w, h, -1, -1]
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 12) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)]
  if (x1 < 0) return null
  return { x0: (x0 / w) * env.W, y0: (y0 / h) * env.H, x1: ((x1 + 1) / w) * env.W, y1: ((y1 + 1) / h) * env.H }
}

/** Draws the triangle (s0,s1,s2) of `img` onto (d0,d1,d2) with an affine transform. */
function drawTriangle(ctx: CanvasRenderingContext2D, img: CanvasImageSource, s: number[][], d: number[][]): void {
  const [[sx0, sy0], [sx1, sy1], [sx2, sy2]] = s
  // Grow the destination triangle a hair so neighbouring triangles overlap instead of leaving seams.
  const cx = (d[0][0] + d[1][0] + d[2][0]) / 3
  const cy = (d[0][1] + d[1][1] + d[2][1]) / 3
  const g = d.map(([x, y]) => {
    const [dx, dy] = [x - cx, y - cy]
    const len = Math.hypot(dx, dy) || 1
    return [x + (dx / len) * 0.8, y + (dy / len) * 0.8]
  })
  const [[x0, y0], [x1, y1], [x2, y2]] = d
  const det = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1)
  if (Math.abs(det) < 1e-6) return
  const a = (x0 * (sy1 - sy2) + x1 * (sy2 - sy0) + x2 * (sy0 - sy1)) / det
  const b = (y0 * (sy1 - sy2) + y1 * (sy2 - sy0) + y2 * (sy0 - sy1)) / det
  const c = (x0 * (sx2 - sx1) + x1 * (sx0 - sx2) + x2 * (sx1 - sx0)) / det
  const dd = (y0 * (sx2 - sx1) + y1 * (sx0 - sx2) + y2 * (sx1 - sx0)) / det
  const e = (x0 * (sx1 * sy2 - sx2 * sy1) + x1 * (sx2 * sy0 - sx0 * sy2) + x2 * (sx0 * sy1 - sx1 * sy0)) / det
  const f = (y0 * (sx1 * sy2 - sx2 * sy1) + y1 * (sx2 * sy0 - sx0 * sy2) + y2 * (sx0 * sy1 - sx1 * sy0)) / det
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(g[0][0], g[0][1])
  ctx.lineTo(g[1][0], g[1][1])
  ctx.lineTo(g[2][0], g[2][1])
  ctx.closePath()
  ctx.clip()
  ctx.setTransform(a, b, c, dd, e, f)
  ctx.drawImage(img, 0, 0)
  ctx.restore()
}


/** Maps the whole layer onto a quadrilateral (corners: top-left, top-right, bottom-left, bottom-right), with true perspective-free mesh warping. */
export function warpQuad(layer: Surface, env: EffectEnv, moved: number[][]): void {
  const { W, H } = env
  if (moved.every(([x, y], i) => Math.abs(x - [0, W, 0, W][i]) < 0.5 && Math.abs(y - [0, 0, H, H][i]) < 0.5)) return
  rewrite(layer, env, (out, src) => {
    const n = 14
    // Where the (u, v) point of the picture lands. Projective mapping, so a tilted plane keeps straight lines straight.
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = moved
    const dx1 = x1 - x3
    const dx2 = x2 - x3
    const dy1 = y1 - y3
    const dy2 = y2 - y3
    const sx = x0 - x1 - x2 + x3
    const sy = y0 - y1 - y2 + y3
    const den = dx1 * dy2 - dx2 * dy1
    const g = den === 0 ? 0 : (sx * dy2 - dx2 * sy) / den
    const h = den === 0 ? 0 : (dx1 * sy - sx * dy1) / den
    const at = (u: number, v: number): number[] => {
      const w = g * u + h * v + 1
      return [((x1 - x0 + g * x1) * u + (x2 - x0 + h * x2) * v + x0) / w, ((y1 - y0 + g * y1) * u + (y2 - y0 + h * y2) * v + y0) / w]
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const [u0, u1, v0, v1] = [i / n, (i + 1) / n, j / n, (j + 1) / n]
        const sPts = [[u0 * W, v0 * H], [u1 * W, v0 * H], [u0 * W, v1 * H], [u1 * W, v1 * H]]
        const d = [at(u0, v0), at(u1, v0), at(u0, v1), at(u1, v1)]
        drawTriangle(out.ctx, src.canvas, [sPts[0], sPts[1], sPts[2]], [d[0], d[1], d[2]])
        drawTriangle(out.ctx, src.canvas, [sPts[1], sPts[3], sPts[2]], [d[1], d[3], d[2]])
      }
    }
  }, false)
}

const post: Record<string, Post> = {
  chromaKey(layer, p, env) {
    const [kr, kg, kb] = rgb(p.color)
    const cb = (r: number, g: number, b: number): number => -0.169 * r - 0.331 * g + 0.5 * b
    const cr = (r: number, g: number, b: number): number => 0.5 * r - 0.419 * g - 0.081 * b
    const [kcb, kcr] = [cb(kr, kg, kb), cr(kr, kg, kb)]
    const sim = p.similarity * 120
    const soft = Math.max(1, p.smoothness * 100)
    pixels(layer, env, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue
        const dist = Math.hypot(cb(d[i], d[i + 1], d[i + 2]) - kcb, cr(d[i], d[i + 1], d[i + 2]) - kcr)
        const a = clamp01((dist - sim) / soft)
        if (p.spill > 0 && a > 0 && dist < sim + soft * 3) {
          // Pull colour spilled from the screen back toward grey.
          const grey = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
          const k = p.spill * (1 - clamp01((dist - sim) / (soft * 3)))
          d[i] += (grey - d[i]) * k
          d[i + 1] += (grey - d[i + 1]) * k
          d[i + 2] += (grey - d[i + 2]) * k
        }
        d[i + 3] *= a
      }
    })
  },
  lumaKey(layer, p, env) {
    const half = Math.max(0.001, p.softness / 2)
    pixels(layer, env, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
        const a = clamp01((l - (p.threshold - half)) / (2 * half))
        d[i + 3] *= p.invert >= 0.5 ? 1 - a : a
      }
    })
  },
  dropShadow(layer, p, env) {
    if (p.opacity <= 0) return
    rewrite(layer, env, (out, src) => {
      out.ctx.filter = `drop-shadow(${p.x * env.px}px ${p.y * env.px}px ${p.blur * env.px}px ${css(p.color, p.opacity)})`
      out.ctx.drawImage(src.canvas, 0, 0)
    }, false)
  },
  innerShadow(layer, p, env) {
    if (p.opacity <= 0) return
    rewrite(layer, env, (out, src) => {
      out.ctx.drawImage(src.canvas, 0, 0)
      // A sheet of colour with the shape cut out, blurred and offset, shows only where it falls inside the shape.
      const sheet = env.pool.get('fx-ch', env.W, env.H)
      sheet.ctx.fillStyle = css(p.color, 1)
      sheet.ctx.fillRect(0, 0, env.W, env.H)
      sheet.ctx.globalCompositeOperation = 'destination-out'
      sheet.ctx.drawImage(src.canvas, 0, 0)
      out.ctx.globalCompositeOperation = 'source-atop'
      out.ctx.globalAlpha = clamp01(p.opacity)
      out.ctx.filter = `blur(${p.blur * env.px}px)`
      out.ctx.drawImage(sheet.canvas, p.x * env.px, p.y * env.px)
    }, false)
  },
  stroke(layer, p, env) {
    const r = p.width * env.px
    if (r < 0.5 || p.opacity <= 0) return
    rewrite(layer, env, (out, src) => {
      // Colour copy of the shape, stamped around a circle, then the original on top.
      const tinted = env.pool.get('fx-ch', env.W, env.H)
      tinted.ctx.fillStyle = css(p.color, 1)
      tinted.ctx.fillRect(0, 0, env.W, env.H)
      tinted.ctx.globalCompositeOperation = 'destination-in'
      tinted.ctx.drawImage(src.canvas, 0, 0)
      out.ctx.globalAlpha = clamp01(p.opacity)
      const n = Math.max(12, Math.min(48, Math.round(r * 3)))
      for (let ring = 1; ring <= 2; ring++) for (let i = 0; i < n; i++) out.ctx.drawImage(tinted.canvas, Math.cos((i / n) * Math.PI * 2) * r * (ring / 2), Math.sin((i / n) * Math.PI * 2) * r * (ring / 2))
      out.ctx.globalAlpha = 1
      out.ctx.drawImage(src.canvas, 0, 0)
    }, false)
  },
  roundedCorners(layer, p, env) {
    if (p.radius <= 0) return
    const box = env.rect ?? (() => {
      const b = alphaBounds(layer, env)
      return b ? { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, w: b.x1 - b.x0, h: b.y1 - b.y0, rotation: 0 } : null
    })()
    if (!box) return
    layer.ctx.save()
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
    layer.ctx.globalCompositeOperation = 'destination-in'
    layer.ctx.translate(box.cx, box.cy)
    layer.ctx.rotate((box.rotation * Math.PI) / 180)
    layer.ctx.beginPath()
    layer.ctx.roundRect(-box.w / 2, -box.h / 2, box.w, box.h, p.radius * Math.min(box.w, box.h))
    layer.ctx.fill()
    layer.ctx.restore()
  },
  reflection(layer, p, env) {
    const b = alphaBounds(layer, env)
    if (!b || p.opacity <= 0) return
    const gap = p.gap * env.H
    const height = (b.y1 - b.y0) * p.fade
    rewrite(layer, env, (out, src) => {
      const mirror = env.pool.get('fx-ch', env.W, env.H)
      mirror.ctx.save()
      mirror.ctx.translate(0, b.y1 * 2 + gap)
      mirror.ctx.scale(1, -1)
      mirror.ctx.drawImage(src.canvas, 0, 0)
      mirror.ctx.restore()
      // Fade the mirror image out with distance from the shape.
      const top = b.y1 + gap
      const g = mirror.ctx.createLinearGradient(0, top, 0, top + height)
      g.addColorStop(0, `rgba(0,0,0,${p.opacity})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      mirror.ctx.globalCompositeOperation = 'destination-in'
      mirror.ctx.fillStyle = g
      mirror.ctx.fillRect(0, top, env.W, height)
      mirror.ctx.fillRect(0, 0, 0, 0)
      // Only keep the part below the shape.
      mirror.ctx.globalCompositeOperation = 'destination-out'
      mirror.ctx.fillRect(0, 0, env.W, top)
      out.ctx.drawImage(mirror.canvas, 0, 0)
      out.ctx.drawImage(src.canvas, 0, 0)
    }, false)
  },
  cornerPin(layer, p, env) {
    const { W, H } = env
    warpQuad(layer, env, [
      [p.tlx * W, p.tly * H],
      [W + p.trx * W, p.try * H],
      [p.blx * W, H + p.bly * H],
      [W + p.brx * W, H + p.bry * H]
    ])
  },
  lut(layer, p, env) {
    const table = env.ref ? env.luts?.get(env.ref) : undefined
    if (!table || p.amount <= 0) return
    const out = [0, 0, 0]
    pixels(layer, env, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        sampleLut(table, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, out)
        d[i] += (out[0] * 255 - d[i]) * p.amount
        d[i + 1] += (out[1] * 255 - d[i + 1]) * p.amount
        d[i + 2] += (out[2] * 255 - d[i + 2]) * p.amount
      }
    })
  }
}

Object.assign(POST, post)
export { alphaBounds }
