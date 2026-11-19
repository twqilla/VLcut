/**
 * Draws one frame of a project onto a canvas. The preview and the exporter both
 * call this, so what you see while editing is what gets rendered.
 */
import type { BlendMode, Clip, MediaAsset, Project, Transition } from '@shared/types'
import { activeClips, sourceTime } from '@shared/timeline/ops'
import { fadeAt, propAt } from '@shared/timeline/keyframes'
import './effects2'
import './effects3'
import './effects4'
import { displace, pixels } from './effects2'
import { alphaBounds } from './effects3'
import { type LutTable, decodeLut } from '@shared/color/cube'
import { maskPointsAt } from '@shared/timeline/mask'
import { type DrawState, type EffectEnv, applyPost, applyPre, POST, blurLayer, channelSplit, glitchLayer, hasPost, smearLayer } from './effects'
import { type Mod, transitionFrame } from './transitions'
import { drawText } from './text'
import { drawShape } from './shapes'
import { drawViz } from './viz'
import { clamp01, easeInOut, rand } from './util'
import { type Ctx, type Surface, SurfacePool } from './util'

export interface FrameSource {
  image: CanvasImageSource
  width: number
  height: number
}

export interface Sources {
  /** The decoded picture for a clip at the moment of drawing, or null if it is not ready. */
  get(clip: Clip, asset: MediaAsset): FrameSource | null
  /** An imported image by name, for icons inside text. */
  icon?(project: Project, name: string): FrameSource | null
  /** The next source frame and how much of it to mix in, for clips with frame blending. */
  getBlend?(clip: Clip, asset: MediaAsset): { frame: FrameSource; mix: number } | null
  /** Loudness of each frequency band (0..1) of the sound playing at `time`, or null when nothing is playing or the data is not loaded. */
  getSpectrum?(project: Project, time: number): ArrayLike<number> | null
}

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  softLight: 'soft-light',
  hardLight: 'hard-light',
  colorDodge: 'color-dodge',
  colorBurn: 'color-burn',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  exclusion: 'exclusion',
  add: 'lighter',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity'
}

export class Compositor {
  private pool = new SurfacePool()
  private pixelScaling = false
  /** Clips on screen at the moment being drawn, so a clip can find the clip that serves as its matte. */
  private active: ReturnType<typeof activeClips> = []
  /** Clips whose on-screen box the interface wants (the selection), and where each was drawn on the last frame. */
  watch = new Set<string>()
  rects = new Map<string, { cx: number; cy: number; w: number; h: number; rotation: number }>()
  private matteDepth = 0
  private lutCache = new Map<string, { key: string; table: LutTable }>()

  private lutsFor(project: Project): Map<string, LutTable> | undefined {
    if (!project.luts?.length) return undefined
    const out = new Map<string, LutTable>()
    for (const l of project.luts) {
      const key = `${l.size}:${l.data.length}`
      let hit = this.lutCache.get(l.id)
      if (!hit || hit.key !== key) this.lutCache.set(l.id, (hit = { key, table: decodeLut(l) }))
      out.set(l.id, hit.table)
    }
    return out
  }

  render(ctx: Ctx, project: Project, time: number, sources: Sources): void {
    const { width: W, height: H } = ctx.canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.filter = 'none'
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)

    this.pixelScaling = Boolean(project.settings.pixelScaling)
    const assets = new Map(project.media.map((m) => [m.id, m]))
    this.active = activeClips(project, time)
    // A clip that serves as another's matte is not shown by itself.
    const matteIds = new Set(this.active.flatMap((a) => (a.clip.matte ? [a.clip.matte.clipId] : [])))
    for (const { track, clip, role, progress } of this.active) {
      if (track.kind === 'audio' || track.hidden || matteIds.has(clip.id)) continue
      const frame = progress !== undefined && clip.transitionIn === undefined && role === 'main' ? undefined : progress
      let mod: Mod = {}
      let overlay: { color: string; alpha: number } | undefined
      if (frame !== undefined) {
        // The outgoing clip carries the type of the clip that is replacing it.
        const tr = role === 'main' ? clip.transitionIn! : this.incomingTransition(project, track.id, clip)
        const tf = transitionFrame(tr.type, frame, tr.strength)
        mod = role === 'main' ? tf.incoming : tf.outgoing
        if (role === 'main') overlay = tf.overlay
      }
      this.drawClip(ctx, project, clip, assets, time, mod, sources)
      if (overlay && overlay.alpha > 0) {
        ctx.save()
        ctx.globalAlpha = overlay.alpha
        ctx.globalCompositeOperation = 'screen'
        ctx.fillStyle = overlay.color
        ctx.fillRect(0, 0, W, H)
        ctx.restore()
      }
    }
  }

  private incomingTransition(project: Project, trackId: string, outgoing: Clip): Transition {
    const track = project.tracks.find((t) => t.id === trackId)!
    const end = outgoing.start + outgoing.duration
    return track.clips.find((c) => Math.abs(c.start - end) < 1e-3)?.transitionIn ?? { type: 'fade', duration: 0.5 }
  }

  private drawClip(ctx: Ctx, project: Project, clip: Clip, assets: Map<string, MediaAsset>, time: number, mod: Mod, sources: Sources): void {
    const { width: W, height: H } = ctx.canvas
    const localT = time - clip.start
    // An outgoing clip is drawn past its end; hold its last animated values.
    const animT = Math.min(localT, clip.duration)
    const env: EffectEnv = { W, H, px: H / 1080, fps: project.settings.fps, time, localT, duration: clip.duration, pool: this.pool }
    const state: DrawState = {
      x: propAt(clip, 'x', animT) + (mod.dx ?? 0),
      y: propAt(clip, 'y', animT) + (mod.dy ?? 0),
      scale: propAt(clip, 'scale', animT) * (mod.scale ?? 1),
      rotation: propAt(clip, 'rotation', animT) + (mod.rotation ?? 0),
      alpha: propAt(clip, 'opacity', animT) * fadeAt(clip, animT) * (mod.alpha ?? 1),
      filters: [],
      stretchX: mod.stretchX ?? 1,
      stretchY: 1
    }
    if (state.alpha <= 0) return
    applyPre(clip.effects, state, env)
    env.luts = this.lutsFor(project)
    // Cut out through another clip: draw that clip first, on its own surface.
    let matte: Surface | undefined
    if (clip.matte && this.matteDepth < 2) {
      const m = this.active.find((a) => a.clip.id === clip.matte!.clipId)
      if (!m || m.track.hidden) return
      matte = this.pool.get(`matte-${this.matteDepth}`, W, H)
      this.matteDepth++
      this.drawClip(matte.ctx, project, m.clip, assets, time, {}, sources)
      this.matteDepth--
    }

    const asset = clip.assetId ? assets.get(clip.assetId) : undefined
    const isAdjustment = !clip.text && !clip.shape && !clip.viz && !clip.assetId
    const source = asset ? sources.get(clip, asset) : null
    if (asset && !source) return
    const blend = asset && clip.frameBlend ? sources.getBlend?.(clip, asset) ?? null : null

    const needsLayer = Boolean(matte) || isAdjustment || Boolean(clip.text) || Boolean(clip.shape) || Boolean(clip.viz) || Boolean(clip.mask) || hasPost(clip.effects) || mod.blur || mod.glitch || mod.smear || mod.rgb || mod.liquid || mod.zoomBlur || mod.pixelate || mod.blinds !== undefined || mod.shards !== undefined || mod.wipe !== undefined || mod.iris !== undefined
    if (!needsLayer) {
      ctx.save()
      ctx.globalAlpha = state.alpha
      if (clip.blend) ctx.globalCompositeOperation = BLEND[clip.blend]
      const geom = this.drawSource(ctx, source!, clip, state, blend)
      if (this.watch.has(clip.id)) this.rects.set(clip.id, geom)
      ctx.restore()
      return
    }

    const layer = this.pool.get('layer', W, H)
    if (isAdjustment) {
      // An adjustment clip re-processes everything already drawn beneath it.
      const below = this.pool.get('below', W, H)
      below.ctx.drawImage(ctx.canvas, 0, 0)
      this.drawSource(layer.ctx, { image: below.canvas, width: W, height: H }, clip, state)
    } else if (clip.text) {
      layer.ctx.save()
      layer.ctx.translate(W / 2 + state.x * W, H / 2 + state.y * H)
      layer.ctx.rotate((state.rotation * Math.PI) / 180)
      layer.ctx.scale(state.scale * state.stretchX, state.scale * state.stretchY)
      if (state.filters.length) layer.ctx.filter = state.filters.join(' ')
      drawText(layer.ctx, clip, localT, W, H, (name) => sources.icon?.(project, name) ?? null)
      layer.ctx.restore()
    } else if (clip.viz) {
      layer.ctx.save()
      layer.ctx.translate(W / 2 + state.x * W, H / 2 + state.y * H)
      layer.ctx.rotate((state.rotation * Math.PI) / 180)
      layer.ctx.scale(state.scale * state.stretchX, state.scale * state.stretchY)
      drawViz(layer.ctx, clip.viz, sources.getSpectrum?.(project, time) ?? null, W, H)
      layer.ctx.restore()
    } else if (clip.shape) {
      layer.ctx.save()
      layer.ctx.translate(W / 2 + state.x * W, H / 2 + state.y * H)
      layer.ctx.rotate((state.rotation * Math.PI) / 180)
      layer.ctx.scale(state.scale * state.stretchX, state.scale * state.stretchY)
      if (state.filters.length) layer.ctx.filter = state.filters.join(' ')
      drawShape(layer.ctx, clip.shape, localT, clip.duration, W, H)
      layer.ctx.restore()
    } else {
      env.rect = this.drawSource(layer.ctx, source!, clip, state, blend)
    }
    if (this.watch.has(clip.id)) {
      if (env.rect) this.rects.set(clip.id, env.rect)
      else if (!isAdjustment) {
        // Text, shapes and visualisers have no fixed size, so the box is where their pixels are.
        const b = alphaBounds(layer, env)
        if (b) this.rects.set(clip.id, { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, w: b.x1 - b.x0, h: b.y1 - b.y0, rotation: 0 })
      }
    }
    if (clip.mask) this.applyMask(layer, clip, clip.duration > 0 ? Math.min(1, Math.max(0, animT / clip.duration)) : 0, animT)

    if (matte && clip.matte) {
      if (clip.matte.mode === 'luma') {
        // Brightness becomes opacity: white shows the clip, black hides it.
        pixels(matte, env, (d) => {
          for (let i = 0; i < d.length; i += 4) d[i + 3] = (d[i + 3] * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])) / 255
        })
      }
      layer.ctx.save()
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0)
      layer.ctx.globalCompositeOperation = clip.matte.invert ? 'destination-out' : 'destination-in'
      layer.ctx.drawImage(matte.canvas, 0, 0)
      layer.ctx.restore()
    }
    applyPost(clip.effects, layer, env)
    if (mod.blur) blurLayer(layer, env, mod.blur * env.px)
    if (mod.smear) smearLayer(layer, env, mod.smear.amount, mod.smear.angle)
    if (mod.glitch) glitchLayer(layer, env, mod.glitch, Math.floor(time * 24))
    if (mod.rgb) channelSplit(layer, env, mod.rgb * W, 0)
    if (mod.liquid) {
      const amp = mod.liquid * 40 * env.px
      displace(layer, env, (x, y, v) => {
        v[0] = Math.sin(y / H * 9 + time * 6) * amp
        v[1] = Math.cos(x / W * 7 + time * 5) * amp * 0.6
      })
    }
    if (mod.zoomBlur) POST.zoomBlur(layer, { amount: mod.zoomBlur }, env)
    if (mod.pixelate) POST.pixelate(layer, { size: Math.max(2, mod.pixelate) }, env)
    this.composite(ctx, layer, state.alpha, mod, clip.blend)
  }

  /** Keeps (or, inverted, removes) the part of the layer inside the mask shape, with a soft edge. */
  private applyMask(layer: Surface, clip: Clip, progress: number, localT: number): void {
    const { width: W, height: H } = layer.canvas
    const m = clip.mask!
    // An animated mask glides from its own position to `moveTo` across the clip.
    const q = m.moveTo ? easeInOut(progress) : 0
    const x = m.x + ((m.moveTo?.x ?? m.x) - m.x) * q
    const y = m.y + ((m.moveTo?.y ?? m.y) - m.y) * q
    const scale = 1 + ((m.moveTo?.scale ?? 1) - 1) * q
    const [w, h] = [Math.max(1, m.width * W * scale), Math.max(1, m.height * H * scale)]
    const ctx = layer.ctx
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = m.invert ? 'destination-out' : 'destination-in'
    const blur = clamp01(m.feather) * Math.min(w, h) * 0.25
    if (blur > 0.5) ctx.filter = `blur(${blur}px)`
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    const [cx, cy] = [W / 2 + x * W, H / 2 + y * H]
    if (m.shape === 'polygon') {
      const points = maskPointsAt(m, localT)
      if (points.length >= 3) {
        // Hand-drawn corners move and grow about their own centre.
        const mx = points.reduce((a, p) => a + p[0], 0) / points.length
        const my = points.reduce((a, p) => a + p[1], 0) / points.length
        points.forEach(([px, py], i) => {
          const sx = W / 2 + (mx + (px - mx) * scale + (x - m.x)) * W
          const sy = H / 2 + (my + (py - my) * scale + (y - m.y)) * H
          if (i === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        })
        ctx.closePath()
      } else ctx.rect(0, 0, W, H) // not drawn yet: show everything
    } else if (m.shape === 'ellipse') ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
    else ctx.rect(cx - w / 2, cy - h / 2, w, h)
    if (m.shape === 'polygon' && (m.points ?? []).length < 3 && m.invert) ctx.beginPath()
    ctx.fill()
    ctx.restore()
  }

  private composite(ctx: Ctx, layer: Surface, alpha: number, mod: Mod, blend?: BlendMode): void {
    const { width: W, height: H } = ctx.canvas
    ctx.save()
    ctx.globalAlpha = alpha
    if (blend) ctx.globalCompositeOperation = BLEND[blend]
    if (mod.wipe !== undefined || mod.iris !== undefined) {
      ctx.beginPath()
      if (mod.wipe !== undefined) ctx.rect(0, 0, W * mod.wipe, H)
      else ctx.arc(W / 2, H / 2, (Math.hypot(W, H) / 2) * mod.iris!, 0, Math.PI * 2)
      ctx.clip()
    }
    if (mod.blinds !== undefined || mod.shards !== undefined) {
      // Reveal through vertical blinds, or through shards that appear in a scrambled order.
      ctx.beginPath()
      if (mod.blinds !== undefined) {
        const n = 12
        for (let i = 0; i < n; i++) ctx.rect((i * W) / n, 0, (W / n) * mod.blinds, H)
      } else {
        const [cols, rows] = [10, 6]
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (rand(c * 7 + 1, r * 13 + 5) < mod.shards!) ctx.rect((c * W) / cols, (r * H) / rows, W / cols + 1, H / rows + 1)
          }
        }
      }
      ctx.clip()
    }
    ctx.drawImage(layer.canvas, 0, 0)
    ctx.restore()
  }

  /** Draws a picture fitted inside the frame, then cropped, moved, scaled and rotated. */
  private drawSource(ctx: Ctx, source: FrameSource, clip: Clip, state: DrawState, blend: { frame: FrameSource; mix: number } | null = null): { cx: number; cy: number; w: number; h: number; rotation: number } {
    const { width: W, height: H } = ctx.canvas
    const { left, top, right, bottom } = clip.crop
    const sw = source.width * Math.max(0.01, 1 - left - right)
    const sh = source.height * Math.max(0.01, 1 - top - bottom)
    const fit = Math.min(W / sw, H / sh) * state.scale
    ctx.save()
    ctx.translate(W / 2 + state.x * W, H / 2 + state.y * H)
    ctx.rotate((state.rotation * Math.PI) / 180)
    ctx.scale(fit * state.stretchX, fit * state.stretchY)
    if (state.filters.length) ctx.filter = state.filters.join(' ')
    // Nearest-neighbour keeps hard pixel edges when a small picture is enlarged.
    ctx.imageSmoothingEnabled = !this.pixelScaling
    ctx.drawImage(source.image, source.width * left, source.height * top, sw, sh, -sw / 2, -sh / 2, sw, sh)
    if (blend && blend.mix > 0) {
      // Frame blending: the next source frame fades in over this one.
      ctx.globalAlpha *= blend.mix
      ctx.drawImage(blend.frame.image, blend.frame.width * left, blend.frame.height * top, blend.frame.width * Math.max(0.01, 1 - left - right), blend.frame.height * Math.max(0.01, 1 - top - bottom), -sw / 2, -sh / 2, sw, sh)
    }
    ctx.restore()
    return { cx: W / 2 + state.x * W, cy: H / 2 + state.y * H, w: sw * fit * state.stretchX, h: sh * fit * state.stretchY, rotation: state.rotation }
  }
}

/** Source time for a clip, clamped inside the file (an outgoing clip may run past its end). */
export function clampedSourceTime(clip: Clip, asset: MediaAsset, time: number, fps: number): number {
  const t = sourceTime(clip, time)
  return asset.kind === 'image' ? 0 : Math.max(0, Math.min(t, Math.max(0, asset.duration - 1 / fps)))
}
