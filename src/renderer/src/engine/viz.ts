/** Draws the audio visualiser: bars, mirrored bars, a wave, a ring or dots, from one frame of spectrum values (0..1). */
import type { VizProps } from '@shared/types'
import type { Ctx } from './util'

/** Resamples the stored bands to the number the style wants (by averaging neighbours). */
export function resampleBands(values: ArrayLike<number>, count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const [a, b] = [(i / count) * values.length, ((i + 1) / count) * values.length]
    let sum = 0
    let n = 0
    for (let k = Math.floor(a); k < Math.max(Math.floor(a) + 1, Math.ceil(b)); k++) {
      sum += values[Math.min(values.length - 1, k)]
      n++
    }
    out.push(sum / Math.max(1, n))
  }
  return out
}

/** Draws centred on the origin (the caller has applied the clip's transform). `levels` null means no sound: a flat line. */
export function drawViz(ctx: Ctx, viz: VizProps, levels: ArrayLike<number> | null, W: number, H: number): void {
  const w = viz.width * W
  const h = viz.height * H
  const n = Math.max(4, Math.round(viz.bands))
  const v = levels ? resampleBands(levels, n).map((x) => Math.min(1, Math.max(0, x * viz.gain) ** 1.3)) : new Array<number>(n).fill(0.02)
  const thick = Math.max(1, viz.thickness * H)
  const grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0)
  grad.addColorStop(0, viz.color)
  grad.addColorStop(1, viz.color2)
  ctx.save()
  ctx.fillStyle = grad
  ctx.strokeStyle = grad
  ctx.lineWidth = thick
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const slot = w / n
  const barW = Math.max(1, Math.min(slot * 0.72, slot - 1))
  switch (viz.style) {
    case 'bars':
      v.forEach((x, i) => ctx.fillRect(-w / 2 + i * slot + (slot - barW) / 2, h / 2 - Math.max(2, x * h), barW, Math.max(2, x * h)))
      break
    case 'mirror':
      v.forEach((x, i) => {
        const bh = Math.max(2, x * h)
        ctx.fillRect(-w / 2 + i * slot + (slot - barW) / 2, -bh / 2, barW, bh)
      })
      break
    case 'dots':
      v.forEach((x, i) => {
        ctx.beginPath()
        ctx.arc(-w / 2 + i * slot + slot / 2, h / 2 - x * h, Math.max(1.5, Math.min(barW, thick * 2.2) / 2 + x * thick * 2), 0, Math.PI * 2)
        ctx.fill()
      })
      break
    case 'wave': {
      // A smooth line through the band peaks, mirrored above and below the centre.
      for (const dir of [-1, 1]) {
        ctx.beginPath()
        v.forEach((x, i) => {
          const [px, py] = [-w / 2 + i * slot + slot / 2, (dir * x * h) / 2]
          if (!i) ctx.moveTo(px, py)
          else ctx.quadraticCurveTo(-w / 2 + (i - 0.5) * slot + slot / 2, (dir * v[i - 1] * h) / 2, (-w / 2 + (i - 0.5) * slot + slot / 2 + px) / 2, (dir * ((v[i - 1] + x) / 2) * h) / 2)
        })
        ctx.stroke()
      }
      break
    }
    case 'circle': {
      const r = Math.min(w, h) * 0.32
      ctx.strokeStyle = viz.color
      ctx.lineWidth = Math.max(1, Math.min(thick, (Math.PI * 2 * r) / n * 0.6))
      v.forEach((x, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        const len = Math.max(2, x * Math.min(w, h) * 0.5)
        ctx.strokeStyle = i < n / 2 ? viz.color : viz.color2
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
        ctx.lineTo(Math.cos(a) * (r + len), Math.sin(a) * (r + len))
        ctx.stroke()
      })
      break
    }
  }
  ctx.restore()
}
