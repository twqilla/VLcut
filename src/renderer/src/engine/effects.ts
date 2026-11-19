/** Drawing code for every effect in the registry. One implementation serves preview and export. */
import type { LutTable } from '@shared/color/cube'
import type { EffectInstance } from '@shared/types'
import { type Surface, type SurfacePool, clamp01, noise, rand } from './util'

/** Geometry and filter state an effect can adjust before the clip is drawn. */
export interface DrawState {
  x: number
  y: number
  scale: number
  rotation: number
  alpha: number
  filters: string[]
  /** Extra horizontal / vertical stretch on top of `scale` (1 = none). */
  stretchX: number
  stretchY: number
}

export interface EffectEnv {
  W: number
  H: number
  /** Pixel scale relative to a 1080-pixel-high frame; keeps blur radii etc. resolution independent. */
  px: number
  fps: number
  /** Timeline time, seconds. */
  time: number
  /** Seconds since the clip started, and the clip length. */
  localT: number
  duration: number
  pool: SurfacePool
  /** Where the clip's picture sits on this frame, when it is a picture (not text or a shape). */
  rect?: { cx: number; cy: number; w: number; h: number; rotation: number }
  /** Colour tables available to LUT effects, by id. */
  luts?: Map<string, LutTable>
  /** The `ref` of the effect being drawn. */
  ref?: string
}

export type Params = Record<string, number>
export type Pre = (p: Params, s: DrawState, env: EffectEnv) => void
export type Post = (layer: Surface, p: Params, env: EffectEnv) => void

/** Replaces the layer's pixels with `draw`'s output, keeping the layer's original transparency. */
export function rewrite(layer: Surface, env: EffectEnv, draw: (out: Surface, src: Surface) => void, keepAlpha = true): void {
  const src = env.pool.get('fx-src', env.W, env.H)
  src.ctx.drawImage(layer.canvas, 0, 0)
  const out = env.pool.get('fx-out', env.W, env.H)
  draw(out, src)
  if (keepAlpha) {
    out.ctx.setTransform(1, 0, 0, 1, 0, 0)
    out.ctx.globalAlpha = 1
    out.ctx.filter = 'none'
    out.ctx.globalCompositeOperation = 'destination-in'
    out.ctx.drawImage(src.canvas, 0, 0)
  }
  layer.ctx.save()
  layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
  layer.ctx.globalCompositeOperation = 'copy'
  layer.ctx.drawImage(out.canvas, 0, 0)
  layer.ctx.restore()
}

/** Blends a fill over the layer with a blend mode, inside the layer's alpha only. */
export function wash(layer: Surface, env: EffectEnv, fill: string | CanvasGradient | CanvasPattern, mode: GlobalCompositeOperation, alpha: number): void {
  if (alpha <= 0) return
  rewrite(layer, env, (out, src) => {
    out.ctx.drawImage(src.canvas, 0, 0)
    out.ctx.globalCompositeOperation = mode
    out.ctx.globalAlpha = clamp01(alpha)
    out.ctx.fillStyle = fill
    out.ctx.fillRect(0, 0, env.W, env.H)
  })
}

let grainTiles: HTMLCanvasElement[] | undefined
export function grainTile(index: number): HTMLCanvasElement {
  if (!grainTiles) {
    grainTiles = Array.from({ length: 6 }, (_, n) => {
      const c = document.createElement('canvas')
      c.width = c.height = 256
      const ctx = c.getContext('2d')!
      const img = ctx.createImageData(256, 256)
      for (let i = 0; i < 256 * 256; i++) {
        const v = Math.floor(rand(i, n + 1) * 255)
        img.data.set([v, v, v, 255], i * 4)
      }
      ctx.putImageData(img, 0, 0)
      return c
    })
  }
  return grainTiles[index % grainTiles.length]
}

export function channelSplit(layer: Surface, env: EffectEnv, dx: number, dy: number): void {
  rewrite(
    layer,
    env,
    (out, src) => {
      const ch = env.pool.get('fx-ch', env.W, env.H)
      const shifts: [string, number][] = [['#ff0000', -1], ['#00ff00', 0], ['#0000ff', 1]]
      out.ctx.globalCompositeOperation = 'lighter'
      for (const [color, dir] of shifts) {
        ch.ctx.globalCompositeOperation = 'copy'
        ch.ctx.drawImage(src.canvas, 0, 0)
        ch.ctx.globalCompositeOperation = 'multiply'
        ch.ctx.fillStyle = color
        ch.ctx.fillRect(0, 0, env.W, env.H)
        ch.ctx.globalCompositeOperation = 'destination-in'
        ch.ctx.drawImage(src.canvas, 0, 0)
        out.ctx.drawImage(ch.canvas, dx * dir, dy * dir)
      }
    },
    false
  )
}

export function slices(layer: Surface, env: EffectEnv, seed: number, count: number, maxShift: number): void {
  rewrite(
    layer,
    env,
    (out, src) => {
      out.ctx.drawImage(src.canvas, 0, 0)
      for (let i = 0; i < count; i++) {
        const y = Math.floor(rand(seed, i * 3) * env.H)
        const h = Math.max(2, Math.floor(rand(seed, i * 3 + 1) * env.H * 0.12))
        const dx = (rand(seed, i * 3 + 2) - 0.5) * 2 * maxShift
        out.ctx.clearRect(0, y, env.W, h)
        out.ctx.drawImage(src.canvas, 0, y, env.W, h, dx, y, env.W, h)
      }
    },
    false
  )
}

/** Shared by the glitch effect and the glitch transition. */
export function glitchLayer(layer: Surface, env: EffectEnv, amount: number, seed: number): void {
  if (amount <= 0) return
  slices(layer, env, seed, Math.round(3 + amount * 12), amount * 0.18 * env.W)
  channelSplit(layer, env, amount * 0.02 * env.W, 0)
}

export function blurLayer(layer: Surface, env: EffectEnv, radiusPx: number): void {
  if (radiusPx <= 0.1) return
  rewrite(layer, env, (out, src) => {
    out.ctx.filter = `blur(${radiusPx}px)`
    out.ctx.drawImage(src.canvas, 0, 0)
  }, false)
}

export function smearLayer(layer: Surface, env: EffectEnv, amount: number, angleDeg: number): void {
  if (amount <= 0) return
  const steps = 10
  const len = amount * 0.12 * env.W
  const [ux, uy] = [Math.cos((angleDeg * Math.PI) / 180), Math.sin((angleDeg * Math.PI) / 180)]
  rewrite(layer, env, (out, src) => {
    for (let i = 0; i < steps; i++) {
      const d = (i / (steps - 1) - 0.5) * len
      out.ctx.globalAlpha = 1 / (i + 1)
      out.ctx.drawImage(src.canvas, ux * d, uy * d)
    }
  }, false)
}

export const PRE: Record<string, Pre> = {
  blackWhite(p, s) {
    s.filters.push(`grayscale(${p.amount})`)
    if (p.contrast) s.filters.push(`contrast(${1 + p.contrast})`)
  },
  sepia(p, s) {
    s.filters.push(`sepia(${p.amount})`)
  },
  invert(p, s) {
    s.filters.push(`invert(${p.amount})`)
  },
  strobe(p, s, env) {
    const beat = (env.time * p.bpm) / 60
    if (beat - Math.floor(beat) < 0.12) s.filters.push(`brightness(${1 + p.amount * 1.5})`)
  },
  spin(p, s, env) {
    s.rotation += p.speed * env.localT
  },
  color(p, s) {
    if (p.exposure) s.filters.push(`brightness(${1 + p.exposure})`)
    if (p.contrast) s.filters.push(`contrast(${1 + p.contrast})`)
    if (p.saturation) s.filters.push(`saturate(${1 + p.saturation})`)
    if (p.hue) s.filters.push(`hue-rotate(${p.hue}deg)`)
  },
  blur(p, s, env) {
    if (p.radius > 0) s.filters.push(`blur(${p.radius * env.px}px)`)
  },
  flicker(p, s, env) {
    const v = rand(Math.floor(env.time * p.speed), 7) - 0.5
    s.filters.push(`brightness(${1 + v * p.amount * 0.6})`)
  },
  shake(p, s, env) {
    const t = env.time * p.speed
    s.x += noise(t, 1) * p.amount * 0.04
    s.y += noise(t, 2) * p.amount * 0.04
    s.rotation += noise(t, 3) * p.amount * p.rotation * 4
    s.scale *= 1 + p.amount * 0.06 // hide the edges the shake would reveal
  },
  zoomPulse(p, s, env) {
    const beat = (env.time * p.bpm) / 60
    const phase = beat - Math.floor(beat)
    s.scale *= 1 + p.amount * 0.25 * Math.exp(-phase * 5)
  },
  slowZoom(p, s, env) {
    const q = env.duration > 0 ? clamp01(env.localT / env.duration) : 0
    s.scale *= 1 + (p.amount >= 0 ? p.amount * q : -p.amount * (1 - q))
    s.x += p.driftX * (q - 0.5)
    s.y += p.driftY * (q - 0.5)
  }
}

export const POST: Record<string, Post> = {
  colorWash(layer, p, env) {
    wash(layer, env, `hsl(${p.hue} 85% 50%)`, 'color', p.amount)
  },
  tiltShift(layer, p, env) {
    if (p.blur <= 0) return
    rewrite(layer, env, (out, src) => {
      out.ctx.filter = `blur(${p.blur * env.px}px)`
      out.ctx.drawImage(src.canvas, 0, 0)
      out.ctx.filter = 'none'
      // Lay the sharp picture back over a horizontal band, feathered above and below.
      const sharp = env.pool.get('fx-ch', env.W, env.H)
      sharp.ctx.drawImage(src.canvas, 0, 0)
      const g = sharp.ctx.createLinearGradient(0, 0, 0, env.H)
      const [a, b] = [Math.max(0, p.center - p.size / 2), Math.min(1, p.center + p.size / 2)]
      g.addColorStop(Math.max(0, a - 0.15), 'rgba(0,0,0,0)')
      g.addColorStop(a, '#000')
      g.addColorStop(b, '#000')
      g.addColorStop(Math.min(1, b + 0.15), 'rgba(0,0,0,0)')
      sharp.ctx.globalCompositeOperation = 'destination-in'
      sharp.ctx.fillStyle = g
      sharp.ctx.fillRect(0, 0, env.W, env.H)
      out.ctx.drawImage(sharp.canvas, 0, 0)
    }, false)
  },
  zoomBlur(layer, p, env) {
    if (p.amount <= 0) return
    const steps = 12
    rewrite(layer, env, (out, src) => {
      for (let i = 0; i < steps; i++) {
        const k = 1 + (p.amount * 0.3 * i) / (steps - 1)
        out.ctx.globalAlpha = 1 / (i + 1)
        out.ctx.drawImage(src.canvas, (env.W * (1 - k)) / 2, (env.H * (1 - k)) / 2, env.W * k, env.H * k)
      }
    }, false)
  },
  scanlines(layer, p, env) {
    const step = Math.max(2, Math.round(p.spacing * env.px))
    layer.ctx.save()
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
    layer.ctx.globalCompositeOperation = 'source-atop'
    layer.ctx.fillStyle = `rgba(0,0,0,${clamp01(p.amount)})`
    for (let y = 0; y < env.H; y += step) layer.ctx.fillRect(0, y, env.W, Math.max(1, step / 2))
    layer.ctx.restore()
  },
  vhs(layer, p, env) {
    const frame = Math.floor(env.time * env.fps)
    channelSplit(layer, env, p.amount * 0.006 * env.W, 0)
    // Horizontal jitter on a few bands, plus a rolling band of tracking noise.
    if (p.tracking > 0) {
      slices(layer, env, frame, Math.round(2 + p.tracking * 4), p.tracking * 0.012 * env.W)
      const y = ((env.time * 0.23) % 1) * env.H
      const pattern = layer.ctx.createPattern(grainTile(frame), 'repeat')!
      layer.ctx.save()
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
      layer.ctx.globalCompositeOperation = 'source-atop'
      layer.ctx.globalAlpha = p.tracking * 0.5
      layer.ctx.fillStyle = pattern
      layer.ctx.fillRect(0, y, env.W, env.H * 0.03)
      layer.ctx.restore()
    }
    POST.scanlines(layer, { amount: p.amount * 0.35, spacing: 3 }, env)
  },
  lightLeak(layer, p, env) {
    const t = env.time * p.speed
    const cx = env.W * (0.5 + 0.6 * Math.sin(t))
    const cy = env.H * (0.3 + 0.3 * Math.cos(t * 0.7))
    const g = layer.ctx.createRadialGradient(cx, cy, 0, cx, cy, env.W * 0.7)
    g.addColorStop(0, `hsla(${p.hue} 100% 62% / 0.95)`)
    g.addColorStop(0.5, `hsla(${p.hue + 25} 100% 55% / 0.35)`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    wash(layer, env, g, 'screen', p.amount)
  },
  spotlight(layer, p, env) {
    const r = Math.hypot(env.W, env.H) * 0.5 * p.size
    const g = layer.ctx.createRadialGradient(p.x * env.W, p.y * env.H, r * 0.7, p.x * env.W, p.y * env.H, r * 1.6)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${clamp01(p.amount)})`)
    layer.ctx.save()
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
    layer.ctx.globalCompositeOperation = 'source-atop'
    layer.ctx.fillStyle = g
    layer.ctx.fillRect(0, 0, env.W, env.H)
    layer.ctx.restore()
  },
  mirror(layer, p, env) {
    rewrite(layer, env, (out, src) => {
      out.ctx.drawImage(src.canvas, 0, 0)
      if (p.vertical >= 0.5) {
        out.ctx.clearRect(0, env.H / 2, env.W, env.H / 2)
        out.ctx.translate(0, env.H)
        out.ctx.scale(1, -1)
        out.ctx.drawImage(src.canvas, 0, 0, env.W, env.H / 2, 0, 0, env.W, env.H / 2)
      } else {
        out.ctx.clearRect(env.W / 2, 0, env.W / 2, env.H)
        out.ctx.translate(env.W, 0)
        out.ctx.scale(-1, 1)
        out.ctx.drawImage(src.canvas, 0, 0, env.W / 2, env.H, 0, 0, env.W / 2, env.H)
      }
    }, false)
  },
  tile(layer, p, env) {
    const n = Math.max(2, Math.round(p.count))
    rewrite(layer, env, (out, src) => {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.ctx.drawImage(src.canvas, (x * env.W) / n, (y * env.H) / n, env.W / n, env.H / n)
    }, false)
  },
  color(layer, p, env) {
    if (p.temperature) wash(layer, env, p.temperature > 0 ? '#ff9a2e' : '#2e8bff', 'soft-light', Math.abs(p.temperature) * 0.6)
    if (p.tint) wash(layer, env, p.tint > 0 ? '#ff3df2' : '#3dff6e', 'soft-light', Math.abs(p.tint) * 0.45)
    if (p.fade) wash(layer, env, '#3b3a38', 'lighten', p.fade)
  },
  duotone(layer, p, env) {
    wash(layer, env, `hsl(${p.shadowHue} 70% 30%)`, 'lighten', p.amount * 0.5)
    wash(layer, env, `hsl(${p.highlightHue} 80% 62%)`, 'soft-light', p.amount)
  },
  motionBlur(layer, p, env) {
    smearLayer(layer, env, p.amount, p.angle)
  },
  glow(layer, p, env) {
    if (p.amount <= 0) return
    rewrite(layer, env, (out, src) => {
      out.ctx.drawImage(src.canvas, 0, 0)
      out.ctx.globalCompositeOperation = 'screen'
      out.ctx.globalAlpha = clamp01(p.amount)
      out.ctx.filter = `blur(${p.radius * env.px}px) brightness(1.15)`
      out.ctx.drawImage(src.canvas, 0, 0)
    }, false)
  },
  vignette(layer, p, env) {
    const r = Math.hypot(env.W, env.H) / 2
    const g = layer.ctx.createRadialGradient(env.W / 2, env.H / 2, r * p.size, env.W / 2, env.H / 2, r * 1.05)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${clamp01(p.amount)})`)
    layer.ctx.save()
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
    layer.ctx.globalCompositeOperation = 'source-atop'
    layer.ctx.fillStyle = g
    layer.ctx.fillRect(0, 0, env.W, env.H)
    layer.ctx.restore()
  },
  grain(layer, p, env) {
    if (p.amount <= 0) return
    const frame = Math.floor(env.time * env.fps)
    const pattern = layer.ctx.createPattern(grainTile(frame), 'repeat')!
    const scale = p.size * env.px
    pattern.setTransform(new DOMMatrix().translate(Math.floor(rand(frame, 1) * 256), Math.floor(rand(frame, 2) * 256)).scale(scale))
    wash(layer, env, pattern, 'overlay', p.amount * 0.6)
  },
  letterbox(layer, p, env) {
    const bar = Math.max(0, (env.H - env.W / p.ratio) / 2)
    layer.ctx.save()
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
    layer.ctx.fillStyle = '#000'
    layer.ctx.fillRect(0, 0, env.W, bar)
    layer.ctx.fillRect(0, env.H - bar, env.W, bar)
    layer.ctx.restore()
  },
  pixelate(layer, p, env) {
    const block = Math.max(2, p.size * env.px)
    const [w, h] = [Math.max(1, Math.round(env.W / block)), Math.max(1, Math.round(env.H / block))]
    const small = env.pool.get('fx-small', w, h)
    small.ctx.drawImage(layer.canvas, 0, 0, w, h)
    layer.ctx.save()
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
    layer.ctx.globalCompositeOperation = 'copy'
    layer.ctx.imageSmoothingEnabled = false
    layer.ctx.drawImage(small.canvas, 0, 0, env.W, env.H)
    layer.ctx.restore()
  },
  rgbSplit(layer, p, env) {
    const d = p.amount * 0.03 * env.W
    channelSplit(layer, env, Math.cos((p.angle * Math.PI) / 180) * d, Math.sin((p.angle * Math.PI) / 180) * d)
  },
  glitch(layer, p, env) {
    const bucket = Math.floor(env.time * p.speed)
    if (rand(bucket, 11) < p.density) glitchLayer(layer, env, p.amount, bucket)
  },
  wave(layer, p, env) {
    if (p.amount <= 0) return
    const strip = Math.max(2, Math.round(3 * env.px))
    rewrite(layer, env, (out, src) => {
      for (let y = 0; y < env.H; y += strip) {
        const dx = Math.sin((y / env.H) * p.frequency * Math.PI * 2 + env.time * p.speed) * p.amount * 0.05 * env.W
        out.ctx.drawImage(src.canvas, 0, y, env.W, strip, dx, y, env.W, strip)
      }
    }, false)
  }
}

export function applyPre(effects: EffectInstance[], state: DrawState, env: EffectEnv): void {
  for (const e of effects) if (e.enabled) PRE[e.type]?.(e.params, state, env)
}

export function hasPost(effects: EffectInstance[]): boolean {
  return effects.some((e) => e.enabled && e.type in POST)
}

export function applyPost(effects: EffectInstance[], layer: Surface, env: EffectEnv): void {
  for (const e of effects) {
    if (!e.enabled) continue
    env.ref = e.ref
    POST[e.type]?.(layer, e.params, env)
  }
}

/** Effect types that have drawing code, for checking the registry against. */
export function implementedEffects(): Set<string> {
  return new Set([...Object.keys(PRE), ...Object.keys(POST)])
}
