/**
 * Drawing code for the second wave of effects (blur, distortion, light, colour, texture).
 * Importing this file registers them with the same PRE/POST tables the first wave uses.
 */
import { type EffectEnv, type Params, type Post, type Pre, POST, PRE, blurLayer, channelSplit, grainTile, rewrite, wash } from './effects'
import { type Surface, clamp01, noise, rand } from './util'

// ---------------------------------------------------------------- helpers

/** Reads the layer's pixels, lets `fn` change them, and writes them back. */
function pixels(layer: Surface, env: EffectEnv, fn: (d: Uint8ClampedArray, w: number, h: number) => void): void {
  const img = layer.ctx.getImageData(0, 0, env.W, env.H)
  fn(img.data, env.W, env.H)
  layer.ctx.putImageData(img, 0, 0)
}

/** Moves every pixel by an offset; the offsets are computed on a coarse grid and interpolated, which keeps it fast. */
function displace(layer: Surface, env: EffectEnv, offset: (x: number, y: number, out: number[]) => void, cell = 8): void {
  const { W, H } = env
  const gw = Math.ceil(W / cell) + 2
  const gh = Math.ceil(H / cell) + 2
  const gx = new Float32Array(gw * gh)
  const gy = new Float32Array(gw * gh)
  const v = [0, 0]
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      offset(i * cell, j * cell, v)
      gx[j * gw + i] = v[0]
      gy[j * gw + i] = v[1]
    }
  }
  const img = layer.ctx.getImageData(0, 0, W, H)
  const src = new Uint32Array(img.data.buffer.slice(0))
  const dst = new Uint32Array(img.data.buffer)
  for (let y = 0; y < H; y++) {
    const j = Math.floor(y / cell)
    const fy = y / cell - j
    for (let x = 0; x < W; x++) {
      const i = Math.floor(x / cell)
      const fx = x / cell - i
      const a = j * gw + i
      const b = a + 1
      const c = a + gw
      const d = c + 1
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy
      let sx = Math.round(x + gx[a] * w00 + gx[b] * w10 + gx[c] * w01 + gx[d] * w11)
      let sy = Math.round(y + gy[a] * w00 + gy[b] * w10 + gy[c] * w01 + gy[d] * w11)
      sx = sx < 0 ? 0 : sx >= W ? W - 1 : sx
      sy = sy < 0 ? 0 : sy >= H ? H - 1 : sy
      dst[y * W + x] = src[sy * W + sx]
    }
  }
  layer.ctx.putImageData(img, 0, 0)
}

/** Composites something drawn by `draw` onto the layer, inside the layer's own alpha. */
function overlay(layer: Surface, env: EffectEnv, draw: (ctx: CanvasRenderingContext2D) => void, mode: GlobalCompositeOperation = 'screen', alpha = 1): void {
  if (alpha <= 0) return
  const ov = env.pool.get('fx-ov', env.W, env.H)
  draw(ov.ctx)
  rewrite(layer, env, (out, src) => {
    out.ctx.drawImage(src.canvas, 0, 0)
    out.ctx.globalCompositeOperation = mode
    out.ctx.globalAlpha = clamp01(alpha)
    out.ctx.drawImage(ov.canvas, 0, 0)
  })
}

const lum = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/** A quarter-size copy of the layer holding only its bright areas (everything below the threshold goes black). */
function brightPass(layer: Surface, env: EffectEnv, threshold: number, div = 4): Surface {
  const w = Math.max(8, Math.round(env.W / div))
  const h = Math.max(8, Math.round(env.H / div))
  const small = env.pool.get('fx-bright', w, h)
  small.ctx.drawImage(layer.canvas, 0, 0, w, h)
  const img = small.ctx.getImageData(0, 0, w, h)
  const d = img.data
  const span = Math.max(0.02, 1 - threshold)
  for (let i = 0; i < d.length; i += 4) {
    const k = clamp01((lum(d[i], d[i + 1], d[i + 2]) - threshold) / span)
    d[i] *= k
    d[i + 1] *= k
    d[i + 2] *= k
  }
  small.ctx.putImageData(img, 0, 0)
  return small
}

function tint(s: Surface, color: string): void {
  s.ctx.save()
  s.ctx.globalCompositeOperation = 'multiply'
  s.ctx.fillStyle = color
  s.ctx.fillRect(0, 0, s.canvas.width, s.canvas.height)
  s.ctx.restore()
}

function hueToRgb(h: number): [number, number, number] {
  const k = (n: number): number => (n + h / 60) % 6
  const f = (n: number): number => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1))
  return [f(5), f(3), f(1)]
}

/** Hue (degrees), saturation and lightness of an RGB triple. */
function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const dlt = max - min
  if (dlt < 1e-6) return [0, 0, l]
  const s = dlt / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / dlt) % 6
  else if (max === g) h = (b - r) / dlt + 2
  else h = (r - g) / dlt + 4
  return [(h * 60 + 360) % 360, Math.min(1, s), l]
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** 2-D value noise in [-1, 1]. */
function noise2(x: number, y: number, seed: number): number {
  const [xi, yi] = [Math.floor(x), Math.floor(y)]
  const [fx, fy] = [x - xi, y - yi]
  const [ux, uy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)]
  const a = rand(xi + seed * 131, yi)
  const b = rand(xi + 1 + seed * 131, yi)
  const c = rand(xi + seed * 131, yi + 1)
  const d = rand(xi + 1 + seed * 131, yi + 1)
  return (a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy) * 2 - 1
}

// ---------------------------------------------------------------- blur

const blurPost: Record<string, Post> = {
  lensBlur(layer, p, env) {
    if (p.radius <= 0) return
    const bright = p.highlights > 0 ? brightPass(layer, env, 0.7) : null
    rewrite(layer, env, (out, src) => {
      out.ctx.filter = `blur(${p.radius * env.px}px)`
      out.ctx.drawImage(src.canvas, 0, 0)
      if (bright) {
        out.ctx.filter = `blur(${p.radius * env.px * 1.6}px)`
        out.ctx.globalCompositeOperation = 'screen'
        out.ctx.globalAlpha = clamp01(p.highlights)
        out.ctx.drawImage(bright.canvas, 0, 0, env.W, env.H)
      }
    }, false)
  },
  bokehBlur(layer, p, env) {
    const bright = brightPass(layer, env, p.threshold, 8)
    const [bw, bh] = [bright.canvas.width, bright.canvas.height]
    const data = bright.ctx.getImageData(0, 0, bw, bh).data
    rewrite(layer, env, (out, src) => {
      out.ctx.filter = `blur(${p.radius * env.px}px)`
      out.ctx.drawImage(src.canvas, 0, 0)
      out.ctx.filter = 'none'
      out.ctx.globalCompositeOperation = 'screen'
      const r = Math.max(2, p.size * env.px * 0.5)
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const i = (y * bw + x) * 4
          const k = lum(data[i], data[i + 1], data[i + 2])
          // Only a sparse, deterministic subset of bright cells become discs.
          if (k < 0.08 || rand(x, y) > 0.55) continue
          const [cx, cy] = [((x + 0.5) / bw) * env.W, ((y + 0.5) / bh) * env.H]
          const g = out.ctx.createRadialGradient(cx, cy, r * 0.75, cx, cy, r)
          const col = `${data[i]}, ${data[i + 1]}, ${data[i + 2]}`
          g.addColorStop(0, `rgba(${col}, ${0.25 * p.amount})`)
          g.addColorStop(1, `rgba(${col}, ${0.5 * p.amount})`)
          out.ctx.fillStyle = g
          out.ctx.beginPath()
          out.ctx.arc(cx, cy, r, 0, Math.PI * 2)
          out.ctx.fill()
        }
      }
    }, false)
  },
  backgroundBlur(layer, p, env) {
    if (p.blur <= 0) return
    rewrite(layer, env, (out, src) => {
      out.ctx.filter = `blur(${p.blur * env.px}px)`
      out.ctx.drawImage(src.canvas, 0, 0)
      out.ctx.filter = 'none'
      const sharp = env.pool.get('fx-ch', env.W, env.H)
      sharp.ctx.drawImage(src.canvas, 0, 0)
      sharp.ctx.globalCompositeOperation = 'destination-in'
      sharp.ctx.translate(p.x * env.W, p.y * env.H)
      sharp.ctx.scale((p.size * env.W) / 2, (p.size * env.H) / 2)
      const g = sharp.ctx.createRadialGradient(0, 0, Math.max(0, 1 - p.feather * 2), 0, 0, 1)
      g.addColorStop(0, '#000')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      sharp.ctx.fillStyle = g
      sharp.ctx.fillRect(-4, -4, 8, 8)
      out.ctx.drawImage(sharp.canvas, 0, 0)
    }, false)
  },
  spinBlur(layer, p, env) {
    if (p.amount <= 0) return
    const steps = 14
    const [cx, cy] = [p.x * env.W, p.y * env.H]
    rewrite(layer, env, (out, src) => {
      for (let i = 0; i < steps; i++) {
        const a = (i / (steps - 1) - 0.5) * p.amount * 0.35
        out.ctx.save()
        out.ctx.globalAlpha = 1 / (i + 1)
        out.ctx.translate(cx, cy)
        out.ctx.rotate(a)
        out.ctx.translate(-cx, -cy)
        out.ctx.drawImage(src.canvas, 0, 0)
        out.ctx.restore()
      }
    }, false)
  }
}

// ---------------------------------------------------------------- distortion

const distortPost: Record<string, Post> = {
  chromaticAberration(layer, p, env) {
    if (p.amount <= 0) return
    rewrite(layer, env, (out, src) => {
      const ch = env.pool.get('fx-ch', env.W, env.H)
      out.ctx.globalCompositeOperation = 'lighter'
      const channels: [string, number][] = [['#ff0000', 1 + p.amount * 0.025], ['#00ff00', 1], ['#0000ff', 1 - p.amount * 0.025]]
      for (const [color, k] of channels) {
        ch.ctx.globalCompositeOperation = 'copy'
        ch.ctx.drawImage(src.canvas, 0, 0)
        ch.ctx.globalCompositeOperation = 'multiply'
        ch.ctx.fillStyle = color
        ch.ctx.fillRect(0, 0, env.W, env.H)
        ch.ctx.globalCompositeOperation = 'destination-in'
        ch.ctx.drawImage(src.canvas, 0, 0)
        out.ctx.drawImage(ch.canvas, (env.W * (1 - k)) / 2, (env.H * (1 - k)) / 2, env.W * k, env.H * k)
      }
    }, false)
  },
  ripple(layer, p, env) {
    if (p.amount <= 0) return
    const [cx, cy] = [p.x * env.W, p.y * env.H]
    const amp = p.amount * 22 * env.px
    const k = (p.frequency * Math.PI * 2) / Math.hypot(env.W, env.H)
    displace(layer, env, (x, y, v) => {
      const [dx, dy] = [x - cx, y - cy]
      const d = Math.hypot(dx, dy) || 1
      const o = Math.sin(d * k - env.time * p.speed * 2) * amp
      v[0] = (dx / d) * o
      v[1] = (dy / d) * o
    })
  },
  fisheye(layer, p, env) {
    if (Math.abs(p.amount) < 0.01) return
    const [cx, cy] = [env.W / 2, env.H / 2]
    const rad = Math.hypot(cx, cy)
    displace(layer, env, (x, y, v) => {
      const [dx, dy] = [x - cx, y - cy]
      const r = Math.hypot(dx, dy) / rad
      const f = 1 / (1 + p.amount * (1 - Math.min(1, r * r)))
      v[0] = dx * f - dx
      v[1] = dy * f - dy
    }, 6)
  },
  displacementMap(layer, p, env) {
    if (p.amount <= 0) return
    const amp = p.amount * 40 * env.px
    const t = env.time * p.speed
    const [cx, cy] = [env.W / 2, env.H / 2]
    displace(layer, env, (x, y, v) => {
      const [u, w] = [(x / env.W) * p.scale, (y / env.H) * p.scale]
      if (p.pattern >= 1.5) {
        v[0] = Math.sin(w * 6 + t * 2) * amp
        v[1] = 0
      } else if (p.pattern >= 0.5) {
        const r = Math.hypot(x - cx, y - cy) / env.W
        const o = Math.sin(r * p.scale * 6 - t * 3) * amp
        v[0] = o
        v[1] = o
      } else {
        v[0] = noise2(u + t, w, 1) * amp
        v[1] = noise2(u, w + t, 2) * amp
      }
    })
  },
  heatDistortion(layer, p, env) {
    if (p.amount <= 0) return
    const amp = p.amount * 9 * env.px
    displace(layer, env, (x, y, v) => {
      const rise = y / env.px / 22 - env.time * p.speed * 2.2
      v[0] = Math.sin(rise) * amp * (0.6 + 0.4 * noise2(x / 140, y / 140 - env.time * p.speed, 3))
      v[1] = Math.cos(rise * 0.7 + x / 90) * amp * 0.35
    })
  },
  liquid(layer, p, env) {
    if (p.amount <= 0) return
    const amp = p.amount * 30 * env.px
    const t = env.time * p.speed
    displace(layer, env, (x, y, v) => {
      const [u, w] = [(x / env.W) * p.scale * 2, (y / env.H) * p.scale * 2]
      v[0] = (Math.sin(w * 3 + t * 2) + Math.sin(u * 5 - t * 1.3) * 0.5) * amp
      v[1] = (Math.cos(u * 3 - t * 1.7) + Math.sin(w * 5 + t) * 0.5) * amp
    })
  },
  pixelSort(layer, p, env) {
    const vertical = p.vertical >= 0.5
    const lines = vertical ? env.W : env.H
    const len = vertical ? env.H : env.W
    const stride = vertical ? env.W : 1
    const step = vertical ? 1 : env.W
    const bucket = Math.floor(env.time * 8)
    pixels(layer, env, (d) => {
      const px32 = new Uint32Array(d.buffer)
      const counts = new Int32Array(256)
      const tmp = new Uint32Array(len)
      for (let line = 0; line < lines; line++) {
        if (rand(line, bucket) > p.amount) continue
        const base = line * step
        let i = 0
        while (i < len) {
          const key = (n: number): number => {
            const v = px32[base + n * stride]
            return lum(v & 255, (v >>> 8) & 255, (v >>> 16) & 255)
          }
          if (key(i) < p.threshold) {
            i++
            continue
          }
          let j = i
          while (j < len && key(j) >= p.threshold) j++
          if (j - i > 1) {
            // Counting sort by luminance: linear time, so it stays fast at 4K.
            counts.fill(0)
            for (let n = i; n < j; n++) {
              const v = px32[base + n * stride]
              counts[Math.round(lum(v & 255, (v >>> 8) & 255, (v >>> 16) & 255) * 255)]++
            }
            const start = new Int32Array(256)
            for (let c = 1; c < 256; c++) start[c] = start[c - 1] + counts[c - 1]
            for (let n = i; n < j; n++) {
              const v = px32[base + n * stride]
              tmp[start[Math.round(lum(v & 255, (v >>> 8) & 255, (v >>> 16) & 255) * 255)]++] = v
            }
            for (let n = 0; n < j - i; n++) px32[base + (i + n) * stride] = tmp[n]
          }
          i = j
        }
      }
    })
  },
  datamosh(layer, p, env) {
    // A look-alike of datamoshing: blocks of the picture get dragged along motion-like vectors and smear.
    const bs = Math.max(8, Math.round(p.block * env.px))
    const bucket = Math.floor(env.time * p.speed)
    const ramp = (env.time * p.speed) % 1
    rewrite(layer, env, (out, src) => {
      out.ctx.drawImage(src.canvas, 0, 0)
      for (let by = 0; by < env.H; by += bs) {
        for (let bx = 0; bx < env.W; bx += bs) {
          const id = (bx / bs) * 977 + (by / bs) * 31
          if (rand(id, bucket) > p.amount * 0.45) continue
          const vx = (rand(id, bucket + 1000) - 0.5) * 4 * bs
          const vy = (rand(id, bucket + 2000) - 0.5) * 1.5 * bs
          for (let k = 1; k <= 5; k++) {
            const f = (k / 5) * ramp
            out.ctx.globalAlpha = 0.5
            out.ctx.drawImage(src.canvas, bx, by, bs, bs, bx + vx * f, by + vy * f, bs, bs)
          }
        }
      }
    }, false)
  },
  digitalNoise(layer, p, env) {
    if (p.amount <= 0) return
    const frame = Math.floor(env.time * p.speed)
    overlay(layer, env, (ctx) => {
      const n = Math.round(4 + p.amount * 26)
      for (let i = 0; i < n; i++) {
        if (rand(frame, i * 7) > p.amount + 0.2) continue
        const y = rand(frame, i * 7 + 1) * env.H
        const h = (0.004 + rand(frame, i * 7 + 2) * 0.05) * env.H
        const x = rand(frame, i * 7 + 3) * env.W * 0.8
        const w = (0.1 + rand(frame, i * 7 + 4) * 0.9) * env.W
        ctx.fillStyle = `hsla(${Math.floor(rand(frame, i * 7 + 5) * 360)} 100% 55% / ${0.15 + rand(frame, i * 7 + 6) * 0.35})`
        ctx.fillRect(x, y, w, h)
      }
      ctx.globalAlpha = p.amount * 0.5
      const pat = ctx.createPattern(grainTile(frame), 'repeat')!
      ctx.fillStyle = pat
      for (let i = 0; i < 3; i++) if (rand(frame, 90 + i) < p.amount) ctx.fillRect(0, rand(frame, 95 + i) * env.H, env.W, env.H * 0.03)
    }, 'screen', 1)
  }
}

// ---------------------------------------------------------------- light

const lightPost: Record<string, Post> = {
  bloom(layer, p, env) {
    if (p.amount <= 0) return
    const bright = brightPass(layer, env, p.threshold)
    rewrite(layer, env, (out, src) => {
      out.ctx.drawImage(src.canvas, 0, 0)
      out.ctx.globalCompositeOperation = 'screen'
      out.ctx.filter = `blur(${p.radius * env.px}px)`
      out.ctx.globalAlpha = clamp01(p.amount)
      out.ctx.drawImage(bright.canvas, 0, 0, env.W, env.H)
      out.ctx.drawImage(bright.canvas, 0, 0, env.W, env.H)
    }, false)
  },
  lensFlare(layer, p, env) {
    if (p.amount <= 0) return
    const t = env.time * 0.4
    const lx = (p.x + Math.sin(t) * 0.12 * p.drift) * env.W
    const ly = (p.y + Math.cos(t * 0.8) * 0.08 * p.drift) * env.H
    const [cx, cy] = [env.W / 2, env.H / 2]
    const R = env.W * 0.06
    overlay(layer, env, (ctx) => {
      const core = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 3)
      core.addColorStop(0, 'rgba(255,255,255,1)')
      core.addColorStop(0.15, `hsla(${p.hue} 100% 80% / 0.8)`)
      core.addColorStop(1, `hsla(${p.hue} 100% 55% / 0)`)
      ctx.fillStyle = core
      ctx.fillRect(0, 0, env.W, env.H)
      // Horizontal streak.
      const streak = ctx.createLinearGradient(lx - env.W * 0.4, 0, lx + env.W * 0.4, 0)
      streak.addColorStop(0, `hsla(${p.hue + 160} 100% 70% / 0)`)
      streak.addColorStop(0.5, `hsla(${p.hue + 160} 100% 80% / 0.8)`)
      streak.addColorStop(1, `hsla(${p.hue + 160} 100% 70% / 0)`)
      ctx.fillStyle = streak
      ctx.fillRect(lx - env.W * 0.4, ly - 2 * env.px, env.W * 0.8, 4 * env.px)
      // Ghosts along the line through the frame centre.
      const ghosts: [number, number, number][] = [[-0.5, 0.5, 0], [0.35, 0.8, 120], [0.7, 0.45, 220], [1.2, 1.1, 300], [1.7, 0.6, 60]]
      for (const [pos, size, hue] of ghosts) {
        const gx = lx + (cx - lx) * (1 + pos)
        const gy = ly + (cy - ly) * (1 + pos)
        const r = R * size
        const g = ctx.createRadialGradient(gx, gy, r * 0.2, gx, gy, r)
        g.addColorStop(0, `hsla(${hue} 100% 60% / 0)`)
        g.addColorStop(0.8, `hsla(${hue} 100% 60% / 0.35)`)
        g.addColorStop(1, `hsla(${hue} 100% 60% / 0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(gx, gy, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }, 'screen', p.amount)
  },
  lightRays(layer, p, env) {
    if (p.amount <= 0) return
    const bright = brightPass(layer, env, p.threshold)
    const [cx, cy] = [p.x * env.W, p.y * env.H]
    const steps = 16
    overlay(layer, env, (ctx) => {
      for (let i = 1; i <= steps; i++) {
        const k = 1 + (p.length * 0.6 * i) / steps
        ctx.globalAlpha = (1 - i / (steps + 1)) / 3
        ctx.globalCompositeOperation = 'lighter'
        ctx.drawImage(bright.canvas, cx - cx * k, cy - cy * k, env.W * k, env.H * k)
      }
    }, 'screen', p.amount)
  },
  godRays(layer, p, env) {
    if (p.amount <= 0) return
    const [sx, sy] = [p.x * env.W, p.y * env.H]
    const n = Math.round(p.beams)
    const reach = Math.hypot(env.W, env.H) * 1.2
    overlay(layer, env, (ctx) => {
      for (let i = 0; i < n; i++) {
        // Beams fan downward from the source; each pulses at its own pace.
        const base = Math.PI * (0.18 + (0.64 * i) / Math.max(1, n - 1))
        const width = 0.025 + rand(i, 3) * 0.04
        const pulse = 0.5 + 0.5 * Math.sin(env.time * (0.4 + rand(i, 4)) + i * 2)
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, reach)
        g.addColorStop(0, `hsla(${p.hue} 100% 85% / ${0.55 * pulse})`)
        g.addColorStop(1, `hsla(${p.hue} 100% 70% / 0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx + Math.cos(base - width) * reach, sy + Math.sin(base - width) * reach)
        ctx.lineTo(sx + Math.cos(base + width) * reach, sy + Math.sin(base + width) * reach)
        ctx.closePath()
        ctx.fill()
      }
    }, 'screen', p.amount)
  },
  neonGlow(layer, p, env) {
    if (p.amount <= 0) return
    rewrite(layer, env, (out, src) => {
      out.ctx.filter = `saturate(${1 + p.saturation * 1.5}) contrast(1.15)`
      out.ctx.drawImage(src.canvas, 0, 0)
      out.ctx.globalCompositeOperation = 'screen'
      for (const [mult, a] of [[1, 0.8], [2.6, 0.55]] as const) {
        out.ctx.filter = `blur(${p.radius * env.px * mult}px) saturate(${1.4 + p.saturation}) brightness(1.3)`
        out.ctx.globalAlpha = clamp01(p.amount * a)
        out.ctx.drawImage(src.canvas, 0, 0)
      }
    }, false)
  },
  flashHit(layer, p, env) {
    const t = env.localT - p.at
    if (t < 0) return
    const a = p.amount * Math.exp(-t / p.decay)
    if (a < 0.01) return
    wash(layer, env, '#ffffff', 'screen', a)
  },
  lightSweep(layer, p, env) {
    if (p.amount <= 0) return
    const phase = (env.time * p.speed) % 1.6
    const pos = phase - 0.3
    const ang = (p.angle * Math.PI) / 180
    overlay(layer, env, (ctx) => {
      ctx.translate(env.W / 2, env.H / 2)
      ctx.rotate(ang)
      const len = Math.hypot(env.W, env.H)
      const cx = (pos - 0.5) * len
      const g = ctx.createLinearGradient(cx - p.width * len, 0, cx + p.width * len, 0)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.5, 'rgba(255,255,255,0.9)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(-len, -len, len * 2, len * 2)
    }, 'overlay', p.amount)
  },
  anamorphicFlare(layer, p, env) {
    if (p.amount <= 0) return
    const bright = brightPass(layer, env, p.threshold)
    tint(bright, `hsl(${p.hue} 100% 65%)`)
    const steps = 26
    overlay(layer, env, (ctx) => {
      ctx.globalCompositeOperation = 'lighter'
      ctx.filter = `blur(${2 * env.px}px)`
      for (let i = -steps; i <= steps; i++) {
        ctx.globalAlpha = (1 - Math.abs(i) / (steps + 1)) * 0.22
        ctx.drawImage(bright.canvas, (i / steps) * p.length * env.W * 0.5, 0, env.W, env.H)
      }
    }, 'screen', p.amount)
  },
  halation(layer, p, env) {
    if (p.amount <= 0) return
    const bright = brightPass(layer, env, p.threshold)
    tint(bright, `hsl(${p.hue} 100% 55%)`)
    rewrite(layer, env, (out, src) => {
      out.ctx.drawImage(src.canvas, 0, 0)
      out.ctx.globalCompositeOperation = 'screen'
      out.ctx.filter = `blur(${p.radius * env.px}px)`
      out.ctx.globalAlpha = clamp01(p.amount)
      out.ctx.drawImage(bright.canvas, 0, 0, env.W, env.H)
      out.ctx.drawImage(bright.canvas, 0, 0, env.W, env.H)
    }, false)
  }
}

// ---------------------------------------------------------------- colour

const colorPost: Record<string, Post> = {
  selectiveColor(layer, p, env) {
    const half = Math.max(1, p.range / 2)
    pixels(layer, env, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue
        const [h, s, l] = toHsl(d[i], d[i + 1], d[i + 2])
        if (s < 0.05) continue
        const dist = hueDistance(h, p.hue)
        const w = dist <= half ? 1 : dist >= p.range ? 0 : 1 - (dist - half) / Math.max(1, p.range - half)
        if (w <= 0) continue
        const [r, g, b] = fromHsl(h + p.hueShift * w, clamp01(s * (1 + p.saturation * w)), clamp01(l + p.lightness * 0.4 * w))
        d[i] = r
        d[i + 1] = g
        d[i + 2] = b
      }
    })
  },
  colorIsolation(layer, p, env) {
    pixels(layer, env, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue
        const [h, s] = toHsl(d[i], d[i + 1], d[i + 2])
        const dist = hueDistance(h, p.hue)
        // 1 inside the range, easing to 0 over `softness` degrees; grey pixels are never "in".
        const inside = clamp01(1 - (dist - p.range) / Math.max(1, p.softness)) * clamp01(s * 4)
        const keep = 1 - p.amount * (1 - inside)
        const grey = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
        d[i] = grey + (d[i] - grey) * keep
        d[i + 1] = grey + (d[i + 1] - grey) * keep
        d[i + 2] = grey + (d[i + 2] - grey) * keep
      }
    })
  },
  filmEmulation(layer, p, env) {
    const s = clamp01(p.strength)
    const stock = Math.round(p.stock)
    if (stock === 0) {
      wash(layer, env, '#ff9d4a', 'soft-light', 0.45 * s)
      wash(layer, env, '#4a2a18', 'lighten', 0.12 * s)
    } else if (stock === 1) {
      wash(layer, env, '#3dff9a', 'soft-light', 0.3 * s)
      wash(layer, env, '#ff4aa0', 'soft-light', 0.12 * s)
      wash(layer, env, '#20302a', 'lighten', 0.12 * s)
    } else if (stock === 2) {
      wash(layer, env, '#2a8bff', 'soft-light', 0.5 * s)
      wash(layer, env, '#ff7a1a', 'overlay', 0.18 * s)
    } else {
      wash(layer, env, '#e6e0c8', 'multiply', 0.2 * s)
      wash(layer, env, '#7a5cff', 'soft-light', 0.18 * s)
    }
    if (p.grain > 0) POST.grain(layer, { amount: p.grain, size: 1.6 }, env)
  },
  hdr(layer, p, env) {
    if (p.amount <= 0) return
    rewrite(layer, env, (out, src) => {
      out.ctx.filter = `contrast(1.12) saturate(${1 + p.saturation})`
      out.ctx.drawImage(src.canvas, 0, 0)
      const inv = env.pool.get('fx-ch', env.W, env.H)
      inv.ctx.filter = `blur(${p.radius * env.px}px) invert(1) grayscale(1)`
      inv.ctx.drawImage(src.canvas, 0, 0)
      out.ctx.filter = 'none'
      out.ctx.globalCompositeOperation = 'overlay'
      out.ctx.globalAlpha = clamp01(p.amount)
      out.ctx.drawImage(inv.canvas, 0, 0)
    }, false)
  },
  colorWheels(layer, p, env) {
    const [sr, sg, sb] = hueToRgb(p.shadowHue)
    const [mr, mg, mb] = hueToRgb(p.midHue)
    const [hr, hg, hb] = hueToRgb(p.highHue)
    pixels(layer, env, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const l = lum(d[i], d[i + 1], d[i + 2])
        const ws = (1 - l) * (1 - l)
        const wh = l * l
        const wm = 1 - ws - wh
        const k = 90
        // Tint pushes each channel toward the wheel colour, weighted by tonal range.
        d[i] += ((sr - 0.5) * ws * p.shadowAmount + (mr - 0.5) * wm * p.midAmount + (hr - 0.5) * wh * p.highAmount) * k
        d[i + 1] += ((sg - 0.5) * ws * p.shadowAmount + (mg - 0.5) * wm * p.midAmount + (hg - 0.5) * wh * p.highAmount) * k
        d[i + 2] += ((sb - 0.5) * ws * p.shadowAmount + (mb - 0.5) * wm * p.midAmount + (hb - 0.5) * wh * p.highAmount) * k
      }
    })
  }
}

// ---------------------------------------------------------------- texture

const texturePost: Record<string, Post> = {
  dust(layer, p, env) {
    if (p.amount <= 0) return
    const frame = Math.floor(env.time * 12)
    const n = Math.round(p.amount * 70)
    overlay(layer, env, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = Math.max(1, 0.8 * env.px)
      for (let i = 0; i < n; i++) {
        // Specks live for a few frames, so they flicker rather than slide.
        const seed = i * 13 + Math.floor(frame / (1 + (i % 3)))
        const x = rand(seed, 1) * env.W
        const y = rand(seed, 2) * env.H
        const r = (0.6 + rand(seed, 3) * 1.8) * p.size * env.px
        if (rand(seed, 4) < 0.25) {
          // A hair: a short curved line.
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.quadraticCurveTo(x + (rand(seed, 5) - 0.5) * 30 * env.px, y + (rand(seed, 6) - 0.5) * 30 * env.px, x + (rand(seed, 7) - 0.5) * 40 * env.px, y + (rand(seed, 8) - 0.5) * 40 * env.px)
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(x, y, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }, 'source-over', 1)
  },
  scratches(layer, p, env) {
    if (p.amount <= 0) return
    const frame = Math.floor(env.time * 24)
    overlay(layer, env, (ctx) => {
      const count = Math.round(1 + p.amount * 6)
      for (let i = 0; i < count; i++) {
        if (rand(frame, i) > 0.55) continue
        const x = rand(frame, i + 40) * env.W
        ctx.strokeStyle = `rgba(255,255,255,${0.15 + rand(frame, i + 80) * 0.35})`
        ctx.lineWidth = Math.max(1, (0.5 + rand(frame, i + 120)) * env.px)
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x + (rand(frame, i + 160) - 0.5) * 10 * env.px, env.H)
        ctx.stroke()
      }
    }, 'source-over', 1)
  },
  paperTexture(layer, p, env) {
    if (p.amount <= 0) return
    const pat = layer.ctx.createPattern(grainTile(2), 'repeat')!
    pat.setTransform(new DOMMatrix().scale(p.scale * env.px * 1.5))
    wash(layer, env, pat, 'soft-light', p.amount * 0.9)
    wash(layer, env, '#f1e6cf', 'multiply', p.amount * 0.35)
  },
  halftone(layer, p, env) {
    const cell = Math.max(3, Math.round(p.size * env.px))
    const [gw, gh] = [Math.ceil(env.W / cell), Math.ceil(env.H / cell)]
    const small = env.pool.get('fx-small', gw, gh)
    small.ctx.drawImage(layer.canvas, 0, 0, gw, gh)
    const data = small.ctx.getImageData(0, 0, gw, gh).data
    rewrite(layer, env, (out, src) => {
      out.ctx.drawImage(src.canvas, 0, 0)
      const bg = out.ctx
      bg.globalAlpha = clamp01(p.mix)
      bg.fillStyle = '#0a0a0a'
      bg.fillRect(0, 0, env.W, env.H)
      bg.globalAlpha = 1
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const i = (y * gw + x) * 4
          const l = lum(data[i], data[i + 1], data[i + 2])
          const r = Math.sqrt(l) * cell * 0.72
          if (r < 0.4) continue
          bg.fillStyle = p.mono >= 0.5 ? '#f2f2f2' : `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`
          bg.beginPath()
          bg.arc((x + 0.5) * cell, (y + 0.5) * cell, r, 0, Math.PI * 2)
          bg.fill()
        }
      }
    })
  },
  filmBurn(layer, p, env) {
    if (p.amount <= 0) return
    const t = env.time * p.speed
    // Burns come in bursts: a slow sine raised to a power only peaks now and then.
    const burst = Math.max(0, Math.sin(t * Math.PI)) ** 3
    if (burst < 0.02) return
    overlay(layer, env, (ctx) => {
      const side = Math.sin(Math.floor(t) * 12.9) > 0 ? 0 : env.W
      const g = ctx.createRadialGradient(side, env.H * (0.3 + 0.4 * noise(t, 4) * 0.5 + 0.2), 0, side, env.H * 0.5, env.W * 0.9)
      g.addColorStop(0, 'rgba(255,240,170,1)')
      g.addColorStop(0.25, 'rgba(255,150,40,0.85)')
      g.addColorStop(0.6, 'rgba(200,40,10,0.45)')
      g.addColorStop(1, 'rgba(120,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, env.W, env.H)
    }, 'screen', p.amount * burst)
  }
}

// ---------------------------------------------------------------- PRE (geometry / filters)

const colorShiftPre: Pre = (p, s, env) => {
  s.filters.push(`hue-rotate(${(p.speed * env.localT) % 360}deg)`)
  if (p.saturation) s.filters.push(`saturate(${1 + p.saturation})`)
}

Object.assign(POST, blurPost, distortPost, lightPost, colorPost, texturePost)
Object.assign(PRE, { colorShift: colorShiftPre } satisfies Record<string, Pre>)

// Exported so the compositor can reuse them for transitions.
export { blurLayer, channelSplit, displace, noise2, pixels }
export type { Params }
