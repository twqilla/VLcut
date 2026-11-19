/** Camera and motion effects: handheld, dolly zoom, parallax, Ken Burns and a 3-D camera. */
import { type Post, type Pre, POST, PRE } from './effects'
import { displace } from './effects2'
import { warpQuad } from './effects3'
import { clamp01, easeInOut, noise } from './util'

const pre: Record<string, Pre> = {
  handheld(p, s, env) {
    // Slow wandering plus a quicker tremor, so it reads as a person holding a camera rather than a shake.
    const t = env.time * p.speed
    const a = p.amount
    s.x += (noise(t * 0.5, 11) * 0.7 + noise(t * 2.3, 12) * 0.3) * a * 0.03
    s.y += (noise(t * 0.5, 13) * 0.7 + noise(t * 2.1, 14) * 0.3) * a * 0.03
    s.rotation += (noise(t * 0.4, 15) * 0.8 + noise(t * 1.7, 16) * 0.2) * a * 1.6
    s.scale *= 1 + a * 0.05
  },
  dollyZoom(p, s, env) {
    const q = env.duration > 0 ? easeInOut(clamp01(env.localT / env.duration)) : 0
    s.scale *= 1 + p.amount * 0.6 * (p.direction >= 0.5 ? 1 - q : q)
  },
  kenBurns(p, s, env) {
    const q = env.duration > 0 ? easeInOut(clamp01(env.localT / env.duration)) : 0
    const zoom = p.startZoom + (p.endZoom - p.startZoom) * q
    s.scale *= zoom
    // Pan is measured in fractions of the visible area, so a bigger zoom allows a bigger move.
    s.x += (p.startX + (p.endX - p.startX) * q) * zoom
    s.y += (p.startY + (p.endY - p.startY) * q) * zoom
  }
}

const post: Record<string, Post> = {
  dollyZoom(layer, p, env) {
    // The pinch is the other half of the move: as the camera pushes in, the background is pulled the other way.
    const q = env.duration > 0 ? easeInOut(clamp01(env.localT / env.duration)) : 0
    const amount = p.amount * 1.2 * (p.direction >= 0.5 ? 1 - q : q)
    if (amount < 0.01) return
    const [cx, cy] = [env.W / 2, env.H / 2]
    const rad = Math.hypot(cx, cy)
    displace(layer, env, (x, y, v) => {
      const [dx, dy] = [x - cx, y - cy]
      const r = Math.min(1, Math.hypot(dx, dy) / rad)
      const f = 1 + amount * 0.5 * r * r
      v[0] = dx * f - dx
      v[1] = dy * f - dy
    }, 6)
  },
  parallax(layer, p, env) {
    // Faked depth without a depth map: the far part of the picture (top) glides less than the near part (bottom).
    const sway = Math.sin(env.time * p.speed) * p.amount * 0.05 * env.W
    displace(layer, env, (_x, y, v) => {
      const depth = clamp01((y / env.H - p.horizon) / Math.max(0.05, 1 - p.horizon)) // 0 far .. 1 near
      v[0] = sway * (depth * 2 - 0.4)
      v[1] = 0
    }, 8)
  },
  camera3d(layer, p, env) {
    const { W, H } = env
    const yaw = ((p.rotateY + p.orbit * env.localT) * Math.PI) / 180
    const pitch = (p.rotateX * Math.PI) / 180
    const roll = (p.roll * Math.PI) / 180
    const f = 2.4 / Math.max(0.2, p.perspective)
    const a = H / W
    const corners = [[-1, -a], [1, -a], [-1, a], [1, a]].map(([x, y]) => {
      // Rotate the picture's plane about Y, then X, then Z, then project it onto the screen.
      let [px, py, pz] = [x, y, 0]
      ;[px, pz] = [px * Math.cos(yaw) + pz * Math.sin(yaw), -px * Math.sin(yaw) + pz * Math.cos(yaw)]
      ;[py, pz] = [py * Math.cos(pitch) - pz * Math.sin(pitch), py * Math.sin(pitch) + pz * Math.cos(pitch)]
      ;[px, py] = [px * Math.cos(roll) - py * Math.sin(roll), px * Math.sin(roll) + py * Math.cos(roll)]
      const k = (f / (f + pz)) * p.distance
      return [W / 2 + px * k * (W / 2), H / 2 + py * k * (W / 2)]
    })
    warpQuad(layer, env, corners)
  }
}

Object.assign(PRE, pre)
Object.assign(POST, post)
