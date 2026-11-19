/** Runs inside the hidden render window: draws every frame of a job and hands the pixels to the main process. */
import { Compositor } from '../engine/compositor'
import { MediaPool } from '../engine/mediaPool'
import { ensureFonts } from '../engine/fonts'

export async function runRenderJob(jobId: string): Promise<void> {
  try {
    const job = await window.api.render.job(jobId)
    const canvas = document.createElement('canvas')
    canvas.width = job.width
    canvas.height = job.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const compositor = new Compositor()
    const pool = new MediaPool()
    pool.silent = true
    await ensureFonts()
    const blur = job.motionBlur
    // Only quick mode blends moments here. interpolini mode already blurred the footage before this window started.
    const samples = blur.mode === 'quick' ? Math.max(1, blur.samples) : 1
    const weight = (u: number): number => (blur.weighting === 'gaussian' ? Math.exp(-0.5 * (u / 0.45) ** 2) : blur.weighting === 'triangle' ? 1 - 0.95 * Math.abs(u) : 1)
    const lastTime = (job.totalFrames - 0.5) / job.fps
    const subCanvas = document.createElement('canvas')
    subCanvas.width = job.width
    subCanvas.height = job.height
    const sub = subCanvas.getContext('2d')!
    const done = new Set(job.doneParts)
    for (let frame = 0; frame < job.totalFrames; frame++) {
      if (done.has(Math.floor(frame / job.partFrames))) continue // rendered by an earlier, interrupted run
      const time = frame / job.fps
      if (samples <= 1) {
        await pool.prepareExact(job.project, time)
        compositor.render(ctx, job.project, time, pool)
      } else {
        // Motion blur: draw several moments centred on the frame's time and average them, weighted.
        let total = 0
        for (let k = 0; k < samples; k++) {
          const u = (2 * k + 1) / samples - 1 // -1 .. 1 across the exposure
          const t = Math.max(0, Math.min(lastTime, time + (u * 0.5 * blur.amount) / job.fps))
          const w = weight(u)
          total += w
          await pool.prepareExact(job.project, t)
          compositor.render(sub, job.project, t, pool)
          ctx.globalAlpha = w / total // a running weighted average
          ctx.drawImage(sub.canvas, 0, 0)
        }
        ctx.globalAlpha = 1
      }
      const pixels = ctx.getImageData(0, 0, job.width, job.height).data
      if (!(await window.api.render.frame(jobId, frame, pixels.buffer as ArrayBuffer))) return // cancelled
    }
    pool.dispose()
    await window.api.render.finish(jobId)
  } catch (err) {
    await window.api.render.fail(jobId, err instanceof Error ? err.message : String(err))
  }
}
