import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { focus, stabilize, track } from '../src/main/analysis/motion'

const W = 640
const H = 360
const FPS = 30
const FRAMES = 150
/** Where the camera is at source frame n, in pixels of the 640-wide picture (the content moves the opposite way, i.e. by +this). */
const shakeX = (n: number): number => 7 * Math.sin(n * 0.43) + 3 * Math.sin(n * 1.1)
const shakeY = (n: number): number => 5 * Math.cos(n * 0.37)

/** A video of a detailed picture that is moved by exactly known amounts, frame by frame. */
function shakyVideo(): string {
  const [tw, th] = [W + 80, H + 80]
  const tex = new Float32Array(tw * th)
  // Blurred noise: detail at a few pixels, like real footage.
  const hash = (i: number, j: number): number => { let n = (i * 374761393 + j * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) tex[y * tw + x] = 40 + 175 * (0.6 * hash(x >> 1, y >> 1) + 0.4 * hash(x, y))
  const frames = Buffer.alloc(W * H * FRAMES)
  for (let n = 0; n < FRAMES; n++) {
    const [ox, oy] = [shakeX(n), shakeY(n)]
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // The picture at (x, y) is the texture at (x - ox, y - oy), sampled bilinearly.
        const [sx, sy] = [x + 40 - ox, y + 40 - oy]
        const [ix, iy] = [Math.floor(sx), Math.floor(sy)]
        const [fx, fy] = [sx - ix, sy - iy]
        const a = tex[iy * tw + ix] * (1 - fx) + tex[iy * tw + ix + 1] * fx
        const b = tex[(iy + 1) * tw + ix] * (1 - fx) + tex[(iy + 1) * tw + ix + 1] * fx
        frames[n * W * H + y * W + x] = a * (1 - fy) + b * fy
      }
    }
  }
  const path = join(mkdtempSync(join(tmpdir(), 'motion-')), 'shaky.mp4')
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-pix_fmt', 'yuv420p', '-crf', '18', path], { input: frames, maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error(String(r.stderr))
  return path
}

const rms = (v: number[]): number => Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length)
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length
const centred = (v: number[]): number[] => v.map((x) => x - mean(v))

test('stabilising shaky footage cancels most of the shake, in both directions', async () => {
  const path = shakyVideo()
  const result = await stabilize({ path, sourceStart: 0, sourceDuration: FRAMES / FPS, smoothSeconds: 0.8 })
  expect(result.fps).toBe(20)
  expect(result.points.length).toBeGreaterThan(90)
  // Analysed frame i is source frame round(i * 1.5). Content shift in fractions of the picture width/height.
  const truthX = result.points.map((_, i) => shakeX(Math.round(i * 1.5)) / W)
  const truthY = result.points.map((_, i) => shakeY(Math.round(i * 1.5)) / H)
  // After the correction the content sits at truth + offset; what remains is the wobble.
  const resX = truthX.map((t, i) => t + result.points[i].x)
  const resY = truthY.map((t, i) => t + result.points[i].y)
  const mid = (v: number[]): number[] => v.slice(20, v.length - 20) // the smoothing window shrinks at the ends
  expect(rms(centred(mid(truthX)))).toBeGreaterThan(0.006) // there really was shake
  expect(rms(centred(mid(resX)))).toBeLessThan(rms(centred(mid(truthX))) * 0.3)
  expect(rms(centred(mid(resY)))).toBeLessThan(rms(centred(mid(truthY))) * 0.3)
}, 120000)

test('tracking follows a patch of the shaking picture; focus returns a path', async () => {
  const path = shakyVideo()
  const t = await track({ path, sourceStart: 0, sourceDuration: 3, point: { x: 0.5, y: 0.5 } })
  expect(t.lostAt).toBeUndefined()
  expect(t.points.length).toBeGreaterThan(50)
  // The tracked patch rides with the content, so it ends up where the content was moved to.
  for (const i of [10, 30, t.points.length - 1]) {
    const n = Math.round((i / 20) * 30)
    const closest = Math.min(...[-1, 0, 1].map((d) => Math.abs(t.points[i].x - (0.5 + (shakeX(n + d) - shakeX(0)) / W))))
    expect(closest, `frame ${i}`).toBeLessThan(0.006)
  }
  const f = await focus({ path, sourceStart: 0, sourceDuration: 3 })
  expect(f.points.length).toBeGreaterThan(10)
}, 120000)
