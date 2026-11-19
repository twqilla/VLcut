import type { ShapeProps } from '@shared/types'
import { type Ctx, clamp01, easeOut } from './util'

const IN = 0.45
const OUT = 0.2

/** Draws a shape centred on the origin (the caller has already applied the clip's transform). */
export function drawShape(ctx: Ctx, shape: ShapeProps, localT: number, duration: number, W: number, H: number): void {
  const q = shape.animation === 'none' ? 1 : easeOut(clamp01(localT / IN))
  const out = shape.animation === 'none' ? 1 : clamp01((duration - localT) / OUT)
  const w = shape.width * W
  const h = shape.height * H
  const lineWidth = shape.strokeWidth * H
  ctx.save()
  ctx.globalAlpha *= out * (shape.animation === 'fade' ? q : 1)
  if (shape.animation === 'grow' && shape.kind !== 'curve' && shape.kind !== 'tiles') ctx.scale(q, q)
  if (shape.kind === 'tiles') {
    // A row of rounded tiles that pop in one after another.
    const n = Math.max(1, Math.round(shape.count))
    const gap = w * 0.06
    const size = Math.min(h, (w - gap * (n - 1)) / n)
    for (let i = 0; i < n; i++) {
      const qi = shape.animation === 'none' ? 1 : easeOut(clamp01((localT - i * 0.12) / IN))
      if (qi <= 0) continue
      const x = -w / 2 + i * (size + gap) + size / 2
      ctx.save()
      ctx.translate(x, 0)
      ctx.globalAlpha *= qi
      ctx.scale(0.6 + 0.4 * qi, 0.6 + 0.4 * qi)
      ctx.beginPath()
      ctx.roundRect(-size / 2, -size / 2, size, size, shape.radius * size * 0.5)
      if (shape.fill) {
        ctx.fillStyle = shape.fill
        ctx.fill()
      }
      if (shape.stroke && lineWidth > 0) {
        ctx.lineWidth = lineWidth
        ctx.strokeStyle = shape.stroke
        ctx.shadowColor = shape.stroke
        ctx.shadowBlur = lineWidth * 4
        ctx.stroke()
      }
      ctx.restore()
    }
    return ctx.restore()
  }
  ctx.beginPath()
  if (shape.kind === 'curve') {
    // A connector that bends by `height` and draws on from left to right.
    const end = shape.animation === 'draw' || shape.animation === 'grow' ? q : 1
    const steps = 40
    ctx.moveTo(-w / 2, 0)
    for (let i = 1; i <= Math.round(steps * end); i++) {
      const u = i / steps
      ctx.lineTo(-w / 2 + w * u, -Math.sin(u * Math.PI) * h)
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(1, lineWidth)
    ctx.strokeStyle = shape.stroke || shape.fill
    ctx.shadowColor = shape.stroke || shape.fill
    ctx.shadowBlur = lineWidth * 3
    ctx.stroke()
    return ctx.restore()
  }
  if (shape.kind === 'line') {
    // A line draws on from left to right.
    const end = shape.animation === 'draw' ? q : 1
    ctx.moveTo(-w / 2, 0)
    ctx.lineTo(-w / 2 + w * end, 0)
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1, lineWidth)
    ctx.strokeStyle = shape.stroke || shape.fill
    ctx.stroke()
    return ctx.restore()
  }
  if (shape.kind === 'ellipse') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
  else ctx.roundRect(-w / 2, -h / 2, w, h, shape.radius * Math.min(w, h) * 0.5)
  if (shape.fill) {
    ctx.fillStyle = shape.fill
    ctx.fill()
  }
  if (shape.stroke && lineWidth > 0) {
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = shape.stroke
    if (shape.animation === 'draw') {
      // Reveal the outline progressively with a dash as long as the visible part.
      const length = shape.kind === 'ellipse' ? Math.PI * (w + h) : 2 * (w + h)
      ctx.setLineDash([length * q, length])
    }
    ctx.stroke()
  }
  ctx.restore()
}
