import { useEffect, useState } from 'react'
import type { Clip, MediaAsset } from '@shared/types'

const cache = new Map<string, Promise<string>>()
const queue: (() => void)[] = []
let running = 0
const MAX_PARALLEL = 3

/** Runs thumbnail requests a few at a time, so a long timeline does not start dozens of FFmpeg processes at once. */
function request(path: string, time: number): Promise<string> {
  const key = `${path}@${time}`
  let p = cache.get(key)
  if (!p) {
    p = new Promise<string>((resolve, reject) => {
      const start = (): void => {
        running++
        window.api.media.thumbnail(path, time).then(resolve, reject).finally(() => {
          running--
          queue.shift()?.()
        })
      }
      if (running < MAX_PARALLEL) start()
      else queue.push(start)
    })
    cache.set(key, p)
  }
  return p
}

/** How many frames fit along a clip of this size, so each picture keeps its natural shape. */
export function thumbCount(width: number, height: number): number {
  return Math.max(1, Math.min(14, Math.floor(width / Math.max(24, height * 1.6))))
}

/** Source times (rounded to half seconds) of the frames to show, spread evenly over what the clip plays. */
export function thumbTimes(clip: Pick<Clip, 'sourceIn' | 'duration' | 'speed' | 'reversed'>, count: number): number[] {
  const span = clip.duration * clip.speed
  return Array.from({ length: count }, (_, i) => {
    const f = (i + 0.5) / count
    return Math.round((clip.sourceIn + (clip.reversed ? 1 - f : f) * span) * 2) / 2
  })
}

/** A row of frames along the clip, like a film strip. */
export function ThumbStrip({ clip, asset, width, height }: { clip: Clip; asset: MediaAsset; width: number; height: number }) {
  const count = asset.kind === 'image' ? thumbCount(width, height) : thumbCount(width, height)
  const times = asset.kind === 'image' ? Array.from({ length: count }, () => 0) : thumbTimes(clip, count)
  const key = times.join(',')
  const [srcs, setSrcs] = useState<(string | null)[]>([])
  useEffect(() => {
    let alive = true
    setSrcs(times.map(() => null))
    times.forEach((t, i) => {
      request(asset.path, t).then((url) => alive && setSrcs((cur) => cur.map((s, k) => (k === i ? url : s))), () => undefined)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.path, key])
  return (
    <div className="thumb-strip" aria-hidden="true">
      {times.map((_, i) => (srcs[i] ? <img key={i} src={srcs[i]!} alt="" draggable={false} style={{ width: `${100 / count}%` }} /> : <span key={i} style={{ width: `${100 / count}%` }} />))}
    </div>
  )
}
