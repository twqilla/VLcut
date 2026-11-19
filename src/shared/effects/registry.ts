/**
 * Effect, transition and text-animation definitions. This file only describes
 * them (names and adjustable parameters); the drawing code lives in the
 * renderer's engine so the same code draws the preview and the export.
 */
import type { EffectInstance } from '../types'
import { newId } from '../timeline/model'
import { MORE_EFFECTS, MORE_TRANSITIONS } from './more'

export interface ParamSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  /** The value is a packed 0xRRGGBB colour, edited with a colour picker. */
  color?: boolean
}

export interface EffectSpec {
  type: string
  name: string
  category: 'Color' | 'Blur' | 'Stylize' | 'Motion' | 'Distort' | 'Light' | 'Texture' | 'Composite'
  params: ParamSpec[]
}

const p = (key: string, label: string, min: number, max: number, def: number, step = 0.01): ParamSpec => ({ key, label, min, max, step, default: def })

const BASE_EFFECTS: EffectSpec[] = [
  { type: 'color', name: 'Color adjust', category: 'Color', params: [p('exposure', 'Exposure', -1, 1, 0), p('contrast', 'Contrast', -1, 1, 0), p('saturation', 'Saturation', -1, 1, 0), p('temperature', 'Temperature', -1, 1, 0), p('tint', 'Tint', -1, 1, 0), p('fade', 'Faded blacks', 0, 1, 0), p('hue', 'Hue shift', -180, 180, 0, 1)] },
  { type: 'duotone', name: 'Split tone', category: 'Color', params: [p('shadowHue', 'Shadow hue', 0, 360, 200, 1), p('highlightHue', 'Highlight hue', 0, 360, 35, 1), p('amount', 'Amount', 0, 1, 0.35)] },
  { type: 'blur', name: 'Blur', category: 'Blur', params: [p('radius', 'Radius', 0, 60, 8, 0.5)] },
  { type: 'motionBlur', name: 'Motion blur', category: 'Blur', params: [p('amount', 'Amount', 0, 1, 0.4), p('angle', 'Angle', 0, 360, 0, 1)] },
  { type: 'glow', name: 'Glow', category: 'Stylize', params: [p('amount', 'Amount', 0, 1, 0.5), p('radius', 'Radius', 1, 60, 18, 0.5)] },
  { type: 'vignette', name: 'Vignette', category: 'Stylize', params: [p('amount', 'Amount', 0, 1, 0.5), p('size', 'Size', 0.1, 1, 0.55)] },
  { type: 'grain', name: 'Film grain', category: 'Stylize', params: [p('amount', 'Amount', 0, 1, 0.35), p('size', 'Grain size', 1, 4, 1.5, 0.1)] },
  { type: 'flicker', name: 'Flicker', category: 'Stylize', params: [p('amount', 'Amount', 0, 1, 0.25), p('speed', 'Speed', 1, 30, 12, 1)] },
  { type: 'letterbox', name: 'Letterbox', category: 'Stylize', params: [p('ratio', 'Aspect ratio', 1.5, 3, 2.39)] },
  { type: 'pixelate', name: 'Pixelate', category: 'Stylize', params: [p('size', 'Block size', 2, 80, 12, 1)] },
  { type: 'rgbSplit', name: 'RGB separation', category: 'Distort', params: [p('amount', 'Amount', 0, 1, 0.3), p('angle', 'Angle', 0, 360, 0, 1)] },
  { type: 'glitch', name: 'Glitch', category: 'Distort', params: [p('amount', 'Amount', 0, 1, 0.5), p('speed', 'Speed', 1, 30, 10, 1), p('density', 'Density', 0, 1, 0.5)] },
  { type: 'wave', name: 'Wave distortion', category: 'Distort', params: [p('amount', 'Amount', 0, 1, 0.3), p('frequency', 'Frequency', 1, 30, 6, 0.5), p('speed', 'Speed', 0, 10, 2, 0.1)] },
  { type: 'shake', name: 'Camera shake', category: 'Motion', params: [p('amount', 'Amount', 0, 1, 0.3), p('speed', 'Speed', 1, 30, 12, 1), p('rotation', 'Rotation', 0, 1, 0.3)] },
  { type: 'zoomPulse', name: 'Zoom pulse', category: 'Motion', params: [p('amount', 'Amount', 0, 1, 0.25), p('bpm', 'Tempo (BPM)', 30, 240, 120, 1)] },
  { type: 'blackWhite', name: 'Black & white', category: 'Color', params: [p('amount', 'Amount', 0, 1, 1), p('contrast', 'Contrast', -0.5, 1, 0.15)] },
  { type: 'sepia', name: 'Sepia', category: 'Color', params: [p('amount', 'Amount', 0, 1, 0.8)] },
  { type: 'invert', name: 'Invert', category: 'Color', params: [p('amount', 'Amount', 0, 1, 1)] },
  { type: 'colorWash', name: 'Colour wash', category: 'Color', params: [p('hue', 'Hue', 0, 360, 200, 1), p('amount', 'Amount', 0, 1, 0.5)] },
  { type: 'tiltShift', name: 'Tilt-shift', category: 'Blur', params: [p('blur', 'Blur', 0, 40, 12, 0.5), p('center', 'Focus position', 0, 1, 0.5), p('size', 'Focus size', 0.05, 0.9, 0.3)] },
  { type: 'zoomBlur', name: 'Zoom blur', category: 'Blur', params: [p('amount', 'Amount', 0, 1, 0.35)] },
  { type: 'scanlines', name: 'Scan lines', category: 'Stylize', params: [p('amount', 'Amount', 0, 1, 0.35), p('spacing', 'Spacing', 2, 12, 4, 1)] },
  { type: 'vhs', name: 'VHS tape', category: 'Stylize', params: [p('amount', 'Amount', 0, 1, 0.5), p('tracking', 'Tracking noise', 0, 1, 0.4)] },
  { type: 'lightLeak', name: 'Light leak', category: 'Stylize', params: [p('amount', 'Amount', 0, 1, 0.5), p('hue', 'Hue', 0, 360, 28, 1), p('speed', 'Speed', 0, 3, 0.6)] },
  { type: 'spotlight', name: 'Spotlight', category: 'Stylize', params: [p('amount', 'Darkness', 0, 1, 0.7), p('x', 'Position X', 0, 1, 0.5), p('y', 'Position Y', 0, 1, 0.5), p('size', 'Size', 0.05, 1, 0.3)] },
  { type: 'mirror', name: 'Mirror', category: 'Distort', params: [p('vertical', 'Vertical (0 or 1)', 0, 1, 0, 1)] },
  { type: 'tile', name: 'Tile', category: 'Distort', params: [p('count', 'Tiles per side', 2, 6, 2, 1)] },
  { type: 'strobe', name: 'Strobe', category: 'Motion', params: [p('amount', 'Amount', 0, 1, 0.5), p('bpm', 'Tempo (BPM)', 30, 480, 120, 1)] },
  { type: 'spin', name: 'Spin', category: 'Motion', params: [p('speed', 'Degrees per second', -360, 360, 45, 1)] },
  { type: 'slowZoom', name: 'Slow push-in', category: 'Motion', params: [p('amount', 'Amount', -0.5, 0.5, 0.12), p('driftX', 'Drift X', -0.2, 0.2, 0), p('driftY', 'Drift Y', -0.2, 0.2, 0)] }
]

export const EFFECTS: EffectSpec[] = [...BASE_EFFECTS, ...MORE_EFFECTS]

export function effectSpec(type: string): EffectSpec | undefined {
  return EFFECTS.find((e) => e.type === type)
}

export function makeEffect(type: string, params: Record<string, number> = {}): EffectInstance {
  const spec = effectSpec(type)
  if (!spec) throw new Error(`Unknown effect: ${type}`)
  return { id: newId(), type, enabled: true, params: { ...Object.fromEntries(spec.params.map((s) => [s.key, s.default])), ...params } }
}

/** A named combination of effects applied in one click, on top of whatever the clip already has. */
export interface EffectStack {
  name: string
  effects: { type: string; params: Record<string, number> }[]
  /** True for stacks the user saved. */
  custom?: boolean
}

export const EFFECT_STACKS: EffectStack[] = [
  { name: 'VHS Tape', effects: [{ type: 'color', params: { saturation: 0.15, contrast: -0.08, fade: 0.12 } }, { type: 'vhs', params: { amount: 0.6, tracking: 0.5 } }, { type: 'grain', params: { amount: 0.25 } }] },
  { name: 'Old Film', effects: [{ type: 'sepia', params: { amount: 0.75 } }, { type: 'grain', params: { amount: 0.5, size: 2 } }, { type: 'flicker', params: { amount: 0.2 } }, { type: 'vignette', params: { amount: 0.55 } }] },
  { name: 'Noir', effects: [{ type: 'blackWhite', params: { amount: 1, contrast: 0.45 } }, { type: 'vignette', params: { amount: 0.6, size: 0.45 } }, { type: 'grain', params: { amount: 0.3 } }] },
  { name: 'Dream', effects: [{ type: 'color', params: { exposure: 0.06, saturation: 0.12, fade: 0.1 } }, { type: 'glow', params: { amount: 0.55, radius: 30 } }, { type: 'tiltShift', params: { blur: 10, size: 0.4 } }] },
  { name: 'Music Video', effects: [{ type: 'zoomPulse', params: { amount: 0.25 } }, { type: 'strobe', params: { amount: 0.35 } }, { type: 'rgbSplit', params: { amount: 0.25 } }, { type: 'color', params: { contrast: 0.2, saturation: 0.25 } }] },
  { name: 'Impact Hit', effects: [{ type: 'shake', params: { amount: 0.45, speed: 18 } }, { type: 'zoomBlur', params: { amount: 0.4 } }, { type: 'color', params: { contrast: 0.25 } }] },
  { name: 'Neon Night', effects: [{ type: 'color', params: { exposure: -0.1, contrast: 0.25, saturation: 0.2 } }, { type: 'duotone', params: { shadowHue: 265, highlightHue: 320, amount: 0.45 } }, { type: 'glow', params: { amount: 0.5, radius: 24 } }] },
  { name: 'Vaporwave', effects: [{ type: 'duotone', params: { shadowHue: 285, highlightHue: 180, amount: 0.6 } }, { type: 'scanlines', params: { amount: 0.3 } }, { type: 'rgbSplit', params: { amount: 0.2 } }] },
  { name: 'Security Cam', effects: [{ type: 'blackWhite', params: { amount: 1, contrast: 0.2 } }, { type: 'scanlines', params: { amount: 0.5, spacing: 3 } }, { type: 'grain', params: { amount: 0.35 } }, { type: 'vignette', params: { amount: 0.4 } }] },
  { name: 'Golden Hour', effects: [{ type: 'color', params: { temperature: 0.3, saturation: 0.1, exposure: 0.04 } }, { type: 'lightLeak', params: { amount: 0.55 } }, { type: 'glow', params: { amount: 0.25 } }] },
  { name: 'Miniature', effects: [{ type: 'tiltShift', params: { blur: 18, size: 0.22 } }, { type: 'color', params: { saturation: 0.35, contrast: 0.15 } }] },
  { name: 'Broken Signal', effects: [{ type: 'glitch', params: { amount: 0.6, density: 0.4 } }, { type: 'rgbSplit', params: { amount: 0.35 } }, { type: 'scanlines', params: { amount: 0.25 } }] },
  { name: 'Spotlight Focus', effects: [{ type: 'spotlight', params: { amount: 0.75, size: 0.28 } }, { type: 'color', params: { contrast: 0.12 } }] },
  { name: 'Kaleidoscope', effects: [{ type: 'mirror', params: { vertical: 0 } }, { type: 'mirror', params: { vertical: 1 } }, { type: 'spin', params: { speed: 20 } }] },
  { name: 'Teal & Orange', effects: [{ type: 'colorWheels', params: { shadowHue: 190, shadowAmount: 0.35, midHue: 40, midAmount: 0.05, highHue: 30, highAmount: 0.35 } }, { type: 'color', params: { contrast: 0.15, saturation: 0.1 } }] },
  { name: 'Retro Film', effects: [{ type: 'filmEmulation', params: { stock: 0, strength: 0.7, grain: 0.3 } }, { type: 'dust', params: { amount: 0.5 } }, { type: 'scratches', params: { amount: 0.3 } }, { type: 'halation', params: { amount: 0.35 } }, { type: 'vignette', params: { amount: 0.4 } }] },
  { name: 'Cyberpunk', effects: [{ type: 'duotone', params: { shadowHue: 280, highlightHue: 180, amount: 0.5 } }, { type: 'neonGlow', params: { amount: 0.6 } }, { type: 'chromaticAberration', params: { amount: 0.4 } }, { type: 'scanlines', params: { amount: 0.2 } }] },
  { name: 'Modern Minimal', effects: [{ type: 'color', params: { saturation: -0.15, contrast: 0.1, fade: 0.05 } }, { type: 'vignette', params: { amount: 0.2 } }] },
  { name: 'Analog Film', effects: [{ type: 'filmEmulation', params: { stock: 1, strength: 0.6, grain: 0.35 } }, { type: 'halation', params: { amount: 0.3 } }, { type: 'dust', params: { amount: 0.3 } }] },
  { name: 'Kinetic', effects: [{ type: 'zoomPulse', params: { amount: 0.25 } }, { type: 'rgbSplit', params: { amount: 0.2 } }, { type: 'flashHit', params: { amount: 0.5, decay: 0.15 } }, { type: 'color', params: { contrast: 0.15 } }] }
]

export interface NamedOption {
  type: string
  name: string
}

const BASE_TRANSITIONS: NamedOption[] = [
  { type: 'fade', name: 'Cross dissolve' },
  { type: 'dipBlack', name: 'Dip to black' },
  { type: 'flash', name: 'Flash' },
  { type: 'slideLeft', name: 'Slide left' },
  { type: 'slideRight', name: 'Slide right' },
  { type: 'slideUp', name: 'Slide up' },
  { type: 'slideDown', name: 'Slide down' },
  { type: 'push', name: 'Push' },
  { type: 'whip', name: 'Whip pan' },
  { type: 'zoomIn', name: 'Zoom in' },
  { type: 'zoomOut', name: 'Zoom out' },
  { type: 'spin', name: 'Spin' },
  { type: 'wipe', name: 'Wipe' },
  { type: 'iris', name: 'Iris' },
  { type: 'blur', name: 'Blur dissolve' },
  { type: 'glitch', name: 'Glitch cut' },
  { type: 'filmBurn', name: 'Film burn' }
]

export const TRANSITIONS: NamedOption[] = [...BASE_TRANSITIONS, ...MORE_TRANSITIONS]

export const TEXT_ANIMATIONS: NamedOption[] = [
  { type: 'none', name: 'None' },
  { type: 'fade', name: 'Fade' },
  { type: 'pop', name: 'Pop' },
  { type: 'slideUp', name: 'Slide up' },
  { type: 'words', name: 'Word by word' },
  { type: 'typewriter', name: 'Typewriter' },
  { type: 'blurIn', name: 'Blur in' },
  { type: 'tracking', name: 'Tracking in' },
  { type: 'drop', name: 'Drop in' },
  { type: 'glitch', name: 'Glitch in' },
  { type: 'wave', name: 'Wave' },
  { type: 'letters', name: 'Letter by letter' },
  { type: 'stagger', name: 'Stagger rise' },
  { type: 'slideLeft', name: 'Slide in from right' },
  { type: 'slideRight', name: 'Slide in from left' },
  { type: 'slideDown', name: 'Slide down' },
  { type: 'bounce', name: 'Bounce' },
  { type: 'elastic', name: 'Elastic' },
  { type: 'scaleUp', name: 'Scale up' },
  { type: 'scaleDown', name: 'Scale down' },
  { type: 'maskReveal', name: 'Mask reveal' },
  { type: 'rotating', name: 'Rotate in' },
  { type: 'flip3D', name: '3D flip' },
  { type: 'kinetic', name: 'Kinetic' },
  { type: 'shake', name: 'Shake' },
  { type: 'morph', name: 'Morph (scramble)' },
  { type: 'splitText', name: 'Split text' }
]

/** How text can leave at the end of its clip. */
export const TEXT_OUT_ANIMATIONS: NamedOption[] = [
  { type: 'fade', name: 'Fade out' },
  { type: 'none', name: 'Cut (stay until the end)' },
  { type: 'slideUp', name: 'Slide up' },
  { type: 'slideDown', name: 'Slide down' },
  { type: 'slideLeft', name: 'Slide left' },
  { type: 'slideRight', name: 'Slide right' },
  { type: 'scaleDown', name: 'Shrink' },
  { type: 'scaleUp', name: 'Grow' },
  { type: 'blurOut', name: 'Blur out' }
]

export { ALL_FONTS as FONTS, FONT_CATEGORIES } from './fonts'
