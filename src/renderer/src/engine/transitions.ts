import { clamp01, easeInOut, easeOut, noise } from './util'

/** How a transition alters one side of the cut at a given progress. */
export interface Mod {
  alpha?: number
  /** Offsets as fractions of the frame. */
  dx?: number
  dy?: number
  scale?: number
  rotation?: number
  /** Blur radius in 1080p pixels. */
  blur?: number
  /** Fraction of the layer revealed left-to-right. */
  wipe?: number
  /** Fraction of the layer revealed in a growing circle. */
  iris?: number
  glitch?: number
  smear?: { amount: number; angle: number }
  /** Colour-channel separation, as a fraction of the frame width. */
  rgb?: number
  /** Liquid warp strength, 0-1. */
  liquid?: number
  /** Zoom blur strength, 0-1. */
  zoomBlur?: number
  /** Pixelation block size in 1080p pixels (0 = none). */
  pixelate?: number
  /** Fraction revealed through vertical blinds. */
  blinds?: number
  /** Fraction of shards revealed (random tile order). */
  shards?: number
  /** Horizontal stretch multiplier. */
  stretchX?: number
}

export interface TransitionFrame {
  incoming: Mod
  outgoing: Mod
  /** A colour laid over both, e.g. the white of a flash. */
  overlay?: { color: string; alpha: number }
}

const peak = (p: number): number => 1 - Math.abs(p * 2 - 1)

/** Bump that jumps up at `at` and fades away: the hit of a beat. 0 before the hit builds up to 1 at `at`. */
const hit = (p: number, at: number): number => (p < at ? p / at : (1 - (p - at) / (1 - at)) ** 2)

/** Shake offsets (fractions of the frame) for a given amount, deterministic in progress. */
const jolt = (p: number, amount: number, seed: number): { dx: number; dy: number; rotation: number } => ({
  dx: noise(p * 38, seed) * amount,
  dy: noise(p * 38 + 17, seed + 1) * amount * 0.7,
  rotation: noise(p * 30 + 5, seed + 2) * amount * 90
})

type Fn = (p: number, k: number) => TransitionFrame
const whip = (dx: number, dy: number): Fn => (p, k) => {
  const smear = { amount: peak(p) * 1.8 * k, angle: dy ? 90 : 0 }
  return { incoming: { dx: dx * (1 - p), dy: dy * (1 - p), smear }, outgoing: { dx: -dx * p, dy: -dy * p, smear } }
}

const CLEAN: Record<string, Fn> = {
  whipLeft: whip(1, 0),
  whipRight: whip(-1, 0),
  whipUp: whip(0, 1),
  whipDown: whip(0, -1),
  rgbWhip: (p, k) => {
    const f = whip(1, 0)(p, k)
    return { incoming: { ...f.incoming, rgb: peak(p) * 0.05 * k }, outgoing: { ...f.outgoing, rgb: peak(p) * 0.05 * k } }
  },
  // The picture is struck at 15 % of the way: it shakes harder up to the hit, switches, then settles.
  beatShake: (p, k) => {
    const a = hit(p, 0.15)
    const j = jolt(p, 0.045 * a * k, 3)
    const side = { ...j, scale: 1 + 0.1 * a * k, blur: a * 9 * k, rgb: a * 0.018 * k }
    return { incoming: { alpha: p < 0.15 ? 0 : 1, ...side }, outgoing: side }
  },
  beatPunch: (p, k) => {
    const a = hit(p, 0.12)
    return {
      incoming: { alpha: p < 0.12 ? 0 : 1, scale: 1 + (p < 0.12 ? 0 : 0.28 * a * k), zoomBlur: a * 0.55 * k },
      outgoing: { scale: 1 + 0.28 * a * k, zoomBlur: a * 0.55 * k },
      overlay: { color: '#ffffff', alpha: Math.min(0.85, a * 0.55 * k) }
    }
  },
  flashShake: (p, k) => {
    const a = hit(p, 0.3)
    const j = jolt(p, 0.03 * a * k, 8)
    return { incoming: { alpha: p < 0.3 ? 0 : 1, ...j, blur: a * 5 * k }, outgoing: { ...j, blur: a * 5 * k }, overlay: { color: '#ffffff', alpha: Math.min(0.9, a * 0.8) } }
  },
  slamZoom: (p, k) => ({
    incoming: { alpha: p < 0.5 ? 0 : 1, scale: p < 0.5 ? 1 : 1 + 0.6 * (1 - (p - 0.5) * 2) * k, zoomBlur: (p < 0.5 ? 0 : 1 - (p - 0.5) * 2) * 0.8 * k },
    outgoing: { scale: 1 + p * 1.4 * k, zoomBlur: peak(p) * 0.8 * k }
  }),
  zoomBlurIn: (p, k) => ({
    incoming: { alpha: clamp01(p * 2 - 0.5), scale: 0.75 + 0.25 * p, zoomBlur: (1 - p) * 0.8 * k },
    outgoing: { scale: 1 + p * 0.9 * k, zoomBlur: p * 0.8 * k, alpha: clamp01(1.5 - p * 1.5) }
  }),
  zoomBlurOut: (p, k) => ({
    incoming: { alpha: clamp01(p * 2 - 0.5), scale: 1.5 - 0.5 * p, zoomBlur: (1 - p) * 0.8 * k },
    outgoing: { scale: 1 - p * 0.35 * k, zoomBlur: p * 0.8 * k, alpha: clamp01(1.5 - p * 1.5) }
  }),
  spinBlur: (p, k) => ({
    incoming: { alpha: clamp01(p * 2 - 0.4), rotation: (1 - p) * -70 * k, blur: (1 - p) * 20 * k, scale: 1 + (1 - p) * 0.3 },
    outgoing: { rotation: p * 70 * k, blur: p * 20 * k, scale: 1 + p * 0.3, alpha: clamp01(1.4 - p * 1.4) }
  }),
  glide: (p, k) => {
    const smear = { amount: peak(p) * 0.6 * k, angle: 0 }
    return { incoming: { dx: 1 - p, smear, blur: peak(p) * 3 * k }, outgoing: { dx: -p * 0.45, alpha: clamp01(1.3 - p), smear } }
  },
  shakeSlide: (p, k) => {
    const j = jolt(p, 0.02 * peak(p) * k, 12)
    const smear = { amount: peak(p) * 1.2 * k, angle: 0 }
    return { incoming: { dx: 1 - p + j.dx, dy: j.dy, rotation: j.rotation, smear }, outgoing: { dx: -p + j.dx, dy: j.dy, rotation: j.rotation, smear } }
  }
}

const TABLE: Record<string, (p: number) => TransitionFrame> = {
  fade: (p) => ({ incoming: { alpha: p }, outgoing: {} }),
  dipBlack: (p) => ({ incoming: { alpha: clamp01(p * 2 - 1) }, outgoing: { alpha: clamp01(1 - p * 2) } }),
  flash: (p) => ({ incoming: { alpha: p < 0.4 ? 0 : 1 }, outgoing: {}, overlay: { color: '#ffffff', alpha: peak(clamp01(p / 0.8)) } }),
  slideLeft: (p) => ({ incoming: { dx: 1 - easeInOut(p) }, outgoing: {} }),
  slideRight: (p) => ({ incoming: { dx: easeInOut(p) - 1 }, outgoing: {} }),
  slideUp: (p) => ({ incoming: { dy: 1 - easeInOut(p) }, outgoing: {} }),
  slideDown: (p) => ({ incoming: { dy: easeInOut(p) - 1 }, outgoing: {} }),
  push: (p) => ({ incoming: { dx: 1 - easeInOut(p) }, outgoing: { dx: -easeInOut(p) } }),
  whip: (p) => {
    const e = easeInOut(p)
    const smear = { amount: peak(p) * 1.6, angle: 0 }
    return { incoming: { dx: 1 - e, smear }, outgoing: { dx: -e, smear } }
  },
  zoomIn: (p) => ({ incoming: { alpha: clamp01(p * 2), scale: 0.6 + 0.4 * easeOut(p) }, outgoing: { scale: 1 + easeInOut(p) * 1.2, blur: p * 16 } }),
  zoomOut: (p) => ({ incoming: { alpha: clamp01(p * 2), scale: 1.8 - 0.8 * easeOut(p), blur: (1 - p) * 14 }, outgoing: { scale: 1 - easeInOut(p) * 0.3 } }),
  spin: (p) => ({ incoming: { alpha: clamp01(p * 2), rotation: (1 - easeOut(p)) * -90, scale: 0.5 + 0.5 * easeOut(p) }, outgoing: { rotation: easeInOut(p) * 90, scale: 1 + p } }),
  wipe: (p) => ({ incoming: { wipe: easeInOut(p) }, outgoing: {} }),
  iris: (p) => ({ incoming: { iris: easeInOut(p) }, outgoing: {} }),
  blur: (p) => ({ incoming: { alpha: p, blur: (1 - p) * 30 }, outgoing: { blur: p * 30 } }),
  glitch: (p) => ({ incoming: { alpha: p < 0.5 ? 0 : 1, glitch: peak(p) }, outgoing: { glitch: peak(p) } }),
  cut: (p) => ({ incoming: { alpha: p < 0.5 ? 0 : 1 }, outgoing: { alpha: p < 0.5 ? 1 : 0 } }),
  smoothFade: (p) => ({ incoming: { alpha: easeInOut(p) }, outgoing: {} }),
  dipWhite: (p) => ({ incoming: { alpha: clamp01(p * 2 - 1) }, outgoing: { alpha: clamp01(1 - p * 2) }, overlay: { color: '#ffffff', alpha: peak(p) } }),
  swipe: (p) => ({ incoming: { dx: (1 - easeInOut(p)) * 0.6, alpha: clamp01(p * 1.6) }, outgoing: { dx: -easeInOut(p) * 0.6, alpha: clamp01(1 - p * 1.2) } }),
  pan: (p) => {
    const e = easeInOut(p)
    const smear = { amount: peak(p) * 0.9, angle: 0 }
    return { incoming: { dx: (1 - e) * 0.5, alpha: clamp01(p * 2), smear }, outgoing: { dx: -e * 0.5, smear } }
  },
  cameraShake: (p) => {
    const s = peak(p)
    const j = Math.sin(p * 90) * s
    return { incoming: { alpha: p < 0.5 ? 0 : 1, dx: j * 0.03, dy: Math.cos(p * 70) * s * 0.02, scale: 1 + s * 0.08, blur: s * 6 }, outgoing: { dx: j * 0.03, dy: Math.cos(p * 70) * s * 0.02, scale: 1 + s * 0.08, blur: s * 6 } }
  },
  roll: (p) => ({ incoming: { dy: 1 - easeInOut(p) }, outgoing: { dy: -easeInOut(p) } }),
  tilt: (p) => ({ incoming: { dx: 1 - easeInOut(p), rotation: (1 - easeInOut(p)) * 18, alpha: clamp01(p * 2) }, outgoing: { dx: -easeInOut(p), rotation: -easeInOut(p) * 18 } }),
  rgbSplitTransition: (p) => ({ incoming: { alpha: p, rgb: peak(p) * 0.06 }, outgoing: { rgb: peak(p) * 0.06 } }),
  liquidTransition: (p) => ({ incoming: { alpha: easeInOut(p), liquid: peak(p) }, outgoing: { liquid: peak(p) } }),
  warp: (p) => ({ incoming: { alpha: clamp01(p * 2 - 0.4), scale: 0.5 + 0.5 * easeOut(p), zoomBlur: (1 - p) * 0.9 }, outgoing: { scale: 1 + easeInOut(p) * 1.6, zoomBlur: p * 0.9, alpha: clamp01(1 - p * 1.5) } }),
  morph: (p) => ({ incoming: { alpha: easeInOut(p), scale: 1.08 - 0.08 * easeInOut(p), blur: peak(p) * 14 }, outgoing: { scale: 1 + 0.08 * easeInOut(p), blur: peak(p) * 14 } }),
  blinds: (p) => ({ incoming: { blinds: easeInOut(p) }, outgoing: {} }),
  shatter: (p) => ({ incoming: { shards: easeInOut(p) }, outgoing: { scale: 1 + p * 0.06, alpha: clamp01(1 - p * 0.35) } }),
  pixelateTransition: (p) => ({ incoming: { alpha: p < 0.5 ? 0 : 1, pixelate: peak(p) * 60 }, outgoing: { pixelate: peak(p) * 60 } }),
  stretch: (p) => ({ incoming: { alpha: clamp01(p * 2 - 0.5), stretchX: 1 + (1 - easeOut(p)) * 3, blur: (1 - p) * 8 }, outgoing: { stretchX: 1 + easeInOut(p) * 3, blur: p * 8, alpha: clamp01(1 - p * 1.4) } }),
  spinZoom: (p) => ({ incoming: { alpha: clamp01(p * 2 - 0.3), rotation: (1 - easeOut(p)) * -180, scale: 0.2 + 0.8 * easeOut(p), zoomBlur: (1 - p) * 0.5 }, outgoing: { rotation: easeInOut(p) * 180, scale: 1 + easeInOut(p) * 2, alpha: clamp01(1 - p * 1.6), zoomBlur: p * 0.5 } }),
  filmBurn: (p) => ({ incoming: { alpha: clamp01(p * 2 - 0.5) }, outgoing: {}, overlay: { color: '#ff8a2a', alpha: peak(p) * 0.85 } })
}

export function transitionFrame(type: string, progress: number, strength = 1): TransitionFrame {
  const clean = CLEAN[type]
  if (clean) return clean(clamp01(progress), Math.min(2, Math.max(0.2, strength)))
  return (TABLE[type] ?? TABLE.fade)(clamp01(progress))
}
