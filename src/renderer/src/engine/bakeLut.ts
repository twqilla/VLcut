/** Turns the colour effects on a clip into a .cube lookup table by pushing an identity colour cube through them. */
import { type LutTable } from '@shared/color/cube'
import type { EffectInstance } from '@shared/types'
import { type DrawState, type EffectEnv, applyPost, applyPre } from './effects'
import './effects2'
import './effects3'
import { SurfacePool, makeSurface } from './util'

/** Effects whose result depends only on each pixel's own colour, so they can be captured in a table. */
const COLOR_ONLY = new Set(['color', 'duotone', 'blackWhite', 'sepia', 'invert', 'colorWash', 'selectiveColor', 'colorIsolation', 'colorWheels', 'lut', 'filmEmulation'])

export function bakeableEffects(effects: EffectInstance[]): EffectInstance[] {
  return effects.filter((e) => e.enabled && COLOR_ONLY.has(e.type)).map((e) => (e.type === 'filmEmulation' ? { ...e, params: { ...e.params, grain: 0 } } : e))
}

export function bakeLut(effects: EffectInstance[], luts: EffectEnv['luts'], size = 33): LutTable {
  const list = bakeableEffects(effects)
  const [W, H] = [size * size, size]
  // Identity cube laid out as `size` squares side by side: x = r + b·size, y = g.
  const identity = makeSurface(W, H)
  const img = identity.ctx.createImageData(W, H)
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const i = ((g * W) + (r + b * size)) * 4
        img.data[i] = Math.round((r / (size - 1)) * 255)
        img.data[i + 1] = Math.round((g / (size - 1)) * 255)
        img.data[i + 2] = Math.round((b / (size - 1)) * 255)
        img.data[i + 3] = 255
      }
  identity.ctx.putImageData(img, 0, 0)
  const pool = new SurfacePool()
  const env: EffectEnv = { W, H, px: H / 1080, fps: 30, time: 0, localT: 0, duration: 1, pool, luts }
  const state: DrawState = { x: 0, y: 0, scale: 1, rotation: 0, alpha: 1, filters: [], stretchX: 1, stretchY: 1 }
  applyPre(list, state, env)
  const out = makeSurface(W, H)
  out.ctx.filter = state.filters.length ? state.filters.join(' ') : 'none'
  out.ctx.drawImage(identity.canvas, 0, 0)
  out.ctx.filter = 'none'
  applyPost(list, out, env)
  const px = out.ctx.getImageData(0, 0, W, H).data
  const data = new Float32Array(size ** 3 * 3)
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const i = ((g * W) + (r + b * size)) * 4
        data.set([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255], (r + g * size + b * size * size) * 3)
      }
  return { size, data }
}
