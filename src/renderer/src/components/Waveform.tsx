import { useEffect, useRef, useState } from 'react'
import type { Clip, MediaAsset } from '@shared/types'

const cache = new Map<string, Promise<Uint8Array>>()
const PEAKS_PER_SECOND = 50

function peaksFor(path: string): Promise<Uint8Array> {
  let p = cache.get(path)
  if (!p) cache.set(path, (p = window.api.media.waveform(path)))
  return p
}

/** Draws the part of an asset's waveform that a clip uses. */
export function Waveform({ clip, asset, width, height }: { clip: Clip; asset: MediaAsset; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<Uint8Array | null>(null)

  useEffect(() => {
    let alive = true
    peaksFor(asset.path).then((p) => alive && setPeaks(p), () => {})
    return () => {
      alive = false
    }
  }, [asset.path])

  const w = Math.max(1, Math.min(4000, Math.round(width)))
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !peaks) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, w, height)
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    const span = clip.duration * clip.speed
    for (let x = 0; x < w; x++) {
      const f0 = x / w
      const f1 = (x + 1) / w
      const s0 = clip.sourceIn + (clip.reversed ? 1 - f1 : f0) * span
      const s1 = clip.sourceIn + (clip.reversed ? 1 - f0 : f1) * span
      const i0 = Math.floor(s0 * PEAKS_PER_SECOND)
      const i1 = Math.max(i0 + 1, Math.ceil(s1 * PEAKS_PER_SECOND))
      let peak = 0
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > peak) peak = peaks[i]
      const h = Math.max(1, (peak / 255) * height * Math.min(1.5, clip.volume))
      ctx.fillRect(x, (height - h) / 2, 1, h)
    }
  }, [peaks, w, height, clip.sourceIn, clip.duration, clip.speed, clip.reversed, clip.volume])

  return <canvas ref={ref} className="waveform" width={w} height={height} />
}

const thumbs = new Map<string, Promise<string>>()

/** The clip's first frame, shown at its left edge on the timeline. */
export function Thumbnail({ clip, asset }: { clip: Clip; asset: MediaAsset }) {
  const [src, setSrc] = useState<string | null>(null)
  // Round so trimming by a few frames does not request a new image each time.
  const time = asset.kind === 'image' ? 0 : Math.round((clip.reversed ? clip.sourceIn + clip.duration * clip.speed : clip.sourceIn) * 2) / 2
  useEffect(() => {
    let alive = true
    const key = `${asset.path}@${time}`
    let p = thumbs.get(key)
    if (!p) thumbs.set(key, (p = window.api.media.thumbnail(asset.path, time)))
    p.then((url) => alive && setSrc(url), () => {})
    return () => {
      alive = false
    }
  }, [asset.path, asset.kind, time])
  return src ? <img className="clip-thumb" src={src} alt="" draggable={false} /> : null
}
