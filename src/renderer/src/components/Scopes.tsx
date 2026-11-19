import { useEffect, useRef, useState } from 'react'
import { usePlayback } from '../engine/player'

type Mode = 'histogram' | 'waveform' | 'parade' | 'vectorscope'

/** Reads the preview picture and draws a histogram, waveform, RGB parade or vectorscope of it. */
export function Scopes() {
  const [mode, setMode] = useState<Mode>('waveform')
  const [open, setOpen] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const time = usePlayback((s) => s.time)
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => draw(), 60)
    return () => window.clearTimeout(timer)
    function draw(): void {
      const src = document.querySelector<HTMLCanvasElement>('.preview canvas')
      const out = canvas.current
      if (!src || !out || src.width < 2) return
      const [w, h] = [160, Math.max(8, Math.round((160 * src.height) / src.width))]
      const probe = document.createElement('canvas')
      probe.width = w
      probe.height = h
      const pctx = probe.getContext('2d', { willReadFrequently: true })!
      pctx.drawImage(src, 0, 0, w, h)
      const d = pctx.getImageData(0, 0, w, h).data
      const ctx = out.getContext('2d')!
      const [W, H] = [out.width, out.height]
      ctx.fillStyle = '#05070c'
      ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'
      if (mode === 'histogram') {
        const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
        for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) bins[c][d[i + c]]++
        const peak = Math.max(...bins.map((b) => Math.max(...b.slice(1, 255))), 1)
        ;['#ff3b3b', '#3bff6b', '#3b7bff'].forEach((col, c) => {
          ctx.fillStyle = col + '99'
          for (let v = 0; v < 256; v++) ctx.fillRect((v / 256) * W, H, W / 256 + 0.5, -Math.min(1, bins[c][v] / peak) * H)
        })
      } else if (mode === 'waveform' || mode === 'parade') {
        // One dot per pixel at (its column, its brightness). Parade splits the columns across three colour channels.
        const third = mode === 'parade' ? W / 3 : W
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4
            if (mode === 'waveform') {
              const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
              ctx.fillStyle = 'rgba(120,255,160,0.35)'
              ctx.fillRect((x / w) * W, H - (l / 255) * H, 2, 2)
            } else {
              ;['rgba(255,60,60,0.35)', 'rgba(60,255,100,0.35)', 'rgba(70,120,255,0.35)'].forEach((col, c) => {
                ctx.fillStyle = col
                ctx.fillRect(c * third + (x / w) * third, H - (d[i + c] / 255) * H, 2, 2)
              })
            }
          }
        }
      } else {
        // Vectorscope: hue and saturation as a position around the centre.
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'
        ctx.beginPath()
        ctx.arc(W / 2, H / 2, H * 0.45, 0, Math.PI * 2)
        ctx.stroke()
        for (let i = 0; i < d.length; i += 4) {
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]]
          const cb = -0.169 * r - 0.331 * g + 0.5 * b
          const cr = 0.5 * r - 0.419 * g - 0.081 * b
          ctx.fillStyle = `rgba(${r},${g},${b},0.6)`
          ctx.fillRect(W / 2 + (cb / 128) * H * 0.45, H / 2 - (cr / 128) * H * 0.45, 2, 2)
        }
      }
    }
  }, [open, mode, time])
  return (
    <details className="scopes" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Video scopes</summary>
      <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Scope type">
        <option value="waveform">Waveform</option>
        <option value="parade">RGB parade</option>
        <option value="histogram">Histogram</option>
        <option value="vectorscope">Vectorscope</option>
      </select>
      <canvas ref={canvas} width={320} height={160} aria-label="Video scope" style={{ width: '100%', borderRadius: 0 }} />
    </details>
  )
}
