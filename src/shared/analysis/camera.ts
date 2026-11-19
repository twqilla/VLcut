/** Estimates camera movement (push-in, pull-out, pans, tilts) from tiny greyscale frames. Pure maths. */

export interface CameraMotion {
  /** Positive = picture expanding (camera moving or zooming in). Pixels per frame at analysis size. */
  zoom: number
  /** Positive = picture content moving right / down. */
  panX: number
  panY: number
}

const SEARCH = 5

/** Best integer shift of a block between two frames, by sum of absolute differences. */
function blockShift(a: Uint8Array, b: Uint8Array, w: number, x0: number, y0: number, bw: number, bh: number): { dx: number; dy: number; confident: boolean } {
  let best = Infinity
  let still = 0
  let dx = 0
  let dy = 0
  for (let sy = -SEARCH; sy <= SEARCH; sy++) {
    for (let sx = -SEARCH; sx <= SEARCH; sx++) {
      let sad = 0
      for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) sad += Math.abs(a[y * w + x] - b[(y + sy) * w + x + sx])
      // Prefer the smaller movement when two shifts match equally well.
      const cost = sad + (Math.abs(sx) + Math.abs(sy)) * bw * bh * 0.15
      if (sx === 0 && sy === 0) still = sad
      if (cost < best) {
        best = cost
        dx = sx
        dy = sy
      }
    }
  }
  // Flat areas match everywhere; only trust blocks with real texture and a clear winner.
  return { dx, dy, confident: still > bw * bh * 1.5 }
}

function measure(frames: Uint8Array[], w: number, h: number, stride: number): CameraMotion & { samples: number } {
  const m = SEARCH + 1
  const bw = Math.floor((w - 2 * m) / 2)
  const bh = Math.floor((h - 2 * m) / 2)
  // Four blocks, one per quadrant, with the direction pointing away from the centre.
  const blocks = [[m, m, -1, -1], [m + bw, m, 1, -1], [m, m + bh, -1, 1], [m + bw, m + bh, 1, 1]]
  let zoom = 0
  let panX = 0
  let panY = 0
  let n = 0
  for (let i = stride; i < frames.length; i += Math.max(1, Math.floor(stride / 2))) {
    const shifts = blocks.map(([x, y]) => blockShift(frames[i - stride], frames[i], w, x, y, bw, bh))
    if (shifts.filter((s) => s.confident).length < 3) continue
    const mx = shifts.reduce((a, s) => a + s.dx, 0) / 4
    const my = shifts.reduce((a, s) => a + s.dy, 0) / 4
    panX += mx
    panY += my
    zoom += shifts.reduce((a, s, k) => a + (s.dx - mx) * blocks[k][2] + (s.dy - my) * blocks[k][3], 0) / 8
    n++
  }
  const d = Math.max(1, n) * stride
  return { zoom: zoom / d, panX: panX / d, panY: panY / d, samples: n }
}

/**
 * Average movement per frame over the sequence. Frames are w*h greyscale.
 * Pans are measured between neighbouring frames; a push-in or pull-out moves the picture far less
 * per frame, so when the camera is not panning it is measured across a longer gap.
 */
export function estimateCameraMotion(frames: Uint8Array[], w: number, h: number): CameraMotion {
  const near = measure(frames, w, h, 1)
  if (Math.hypot(near.panX, near.panY) >= 1 || frames.length < 8) return near
  const far = measure(frames, w, h, 4)
  return far.samples ? { zoom: far.zoom, panX: near.panX, panY: near.panY } : near
}

/** A plain word for the dominant movement, or undefined when the camera is steady or movement is mixed. */
export function describeCamera(m: CameraMotion): string | undefined {
  const pan = Math.hypot(m.panX, m.panY)
  if (Math.abs(m.zoom) >= 0.1 && Math.abs(m.zoom) > pan * 0.6) return m.zoom > 0 ? 'push-in' : 'pull-out'
  if (pan < 0.5) return undefined
  // Content moving right means the camera turned left.
  if (Math.abs(m.panX) >= Math.abs(m.panY)) return m.panX > 0 ? 'pan-left' : 'pan-right'
  return m.panY > 0 ? 'tilt-up' : 'tilt-down'
}
