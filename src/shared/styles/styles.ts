/**
 * Editing styles. A style is a complete creative direction: grade, camera
 * movement, transitions, typography, caption look, sound design and pacing.
 * Applying one writes ordinary effects, clips and keyframes onto the timeline,
 * so everything it does stays editable.
 */
import type { TextProps } from '../types'

export interface StyleEffect {
  type: string
  params: Record<string, number>
}

export interface StyleDef {
  id: string
  name: string
  tagline: string
  description: string
  builtin: boolean
  /** Effects on a full-length effects layer above the footage. */
  look: StyleEffect[]
  /** Effects added to every picture clip; `alternate` flips the sign of the named params on every other clip. */
  clipEffects: StyleEffect[]
  alternate?: string[]
  transitions: { types: string[]; duration: number }
  /** Built-in sound effect played on each transition ('' = none). */
  transitionSfx: string
  sfxVolume: number
  pacing: {
    /** Target seconds per shot when the app builds a sequence. */
    shotLength: number
    /** Move cuts onto musical beats when music is present. */
    beatSync: boolean
    /** Beats per shot when beat-syncing. */
    beatsPerShot: number
  }
  title: Partial<TextProps>
  caption: Partial<TextProps>
  /** Vertical caption position, fraction of the frame from the centre. */
  captionY: number
  audio: { fadeIn: number; fadeOut: number; duckMusic: boolean }
}

const fx = (type: string, params: Record<string, number>): StyleEffect => ({ type, params })

export const BUILTIN_STYLES: StyleDef[] = [
  {
    id: 'cinematic', name: 'Cinematic', tagline: 'Atmosphere and restraint', builtin: true,
    description: 'Teal-and-amber grade, widescreen bars, slow push-ins and long dissolves. Serif titles with wide tracking.',
    look: [fx('color', { exposure: -0.04, contrast: 0.14, saturation: -0.12, temperature: 0.1, tint: 0, fade: 0.1, hue: 0 }), fx('duotone', { shadowHue: 195, highlightHue: 32, amount: 0.3 }), fx('vignette', { amount: 0.5, size: 0.5 }), fx('grain', { amount: 0.14, size: 1.4 }), fx('letterbox', { ratio: 2.39 })],
    clipEffects: [fx('slowZoom', { amount: 0.08, driftX: 0.02, driftY: 0 })], alternate: ['amount', 'driftX'],
    transitions: { types: ['fade', 'dipBlack', 'fade', 'blur'], duration: 0.9 }, transitionSfx: 'swell', sfxVolume: 0.35,
    pacing: { shotLength: 4.5, beatSync: true, beatsPerShot: 8 },
    title: { fontFamily: 'Cormorant Garamond', weight: 400, italic: false, uppercase: true, letterSpacing: 0.3, fontSize: 0.06, color: '#efe6d2', animation: 'tracking', shadow: 0.5, outlineWidth: 0, boxColor: '' },
    caption: { fontFamily: 'Cormorant Garamond', weight: 600, italic: true, uppercase: false, fontSize: 0.05, color: '#f4ecda', highlightColor: '#e9b872', activeWordBox: '', animation: 'fade', outlineWidth: 0, shadow: 0.8, boxColor: '', wordsPerPage: 6 },
    captionY: 0.36, audio: { fadeIn: 1.2, fadeOut: 2, duckMusic: true }
  },
  {
    id: 'editorial', name: 'Editorial', tagline: 'Type-led and composed', builtin: true,
    description: 'Clean neutral grade with gentle contrast. Bold grotesque paired with an italic serif, crisp slides and wipes.',
    look: [fx('color', { exposure: 0.03, contrast: 0.08, saturation: -0.06, temperature: 0.03, tint: 0, fade: 0.05, hue: 0 })],
    clipEffects: [fx('slowZoom', { amount: 0.04, driftX: 0, driftY: 0 })],
    transitions: { types: ['slideUp', 'wipe', 'push', 'fade'], duration: 0.45 }, transitionSfx: 'tick', sfxVolume: 0.3,
    pacing: { shotLength: 3, beatSync: true, beatsPerShot: 4 },
    title: { fontFamily: 'Inter', weight: 900, italic: false, uppercase: false, letterSpacing: -0.02, fontSize: 0.1, color: '#f6f1e6', accentFontFamily: 'Instrument Serif', accentItalic: true, accentColor: '', animation: 'words', shadow: 0.25, outlineWidth: 0, boxColor: '' },
    caption: { fontFamily: 'Inter', weight: 700, italic: false, uppercase: false, fontSize: 0.046, color: '#f6f1e6', highlightColor: '#e8b45a', activeWordBox: '', animation: 'words', outlineWidth: 0, shadow: 0.7, boxColor: '', wordsPerPage: 4 },
    captionY: 0.3, audio: { fadeIn: 0.4, fadeOut: 1, duckMusic: true }
  },
  {
    id: 'hype', name: 'Hype', tagline: 'Fast, loud, on the beat', builtin: true,
    description: 'Punchy contrast and saturation, cuts on every beat, zoom pulses, shake and impact transitions with condensed caps.',
    look: [fx('color', { exposure: 0.04, contrast: 0.26, saturation: 0.28, temperature: 0, tint: 0, fade: 0, hue: 0 }), fx('vignette', { amount: 0.3, size: 0.6 })],
    clipEffects: [fx('zoomPulse', { amount: 0.22, bpm: 120 }), fx('shake', { amount: 0.12, speed: 14, rotation: 0.3 })],
    transitions: { types: ['flash', 'whip', 'zoomIn', 'glitch', 'spin'], duration: 0.25 }, transitionSfx: 'impact', sfxVolume: 0.7,
    pacing: { shotLength: 1.2, beatSync: true, beatsPerShot: 2 },
    title: { fontFamily: 'Anton', weight: 400, italic: false, uppercase: true, letterSpacing: 0.01, fontSize: 0.17, color: '#ffffff', animation: 'pop', shadow: 0.6, outlineWidth: 0.04, outlineColor: '#000000', boxColor: '' },
    caption: { fontFamily: 'Anton', weight: 400, italic: false, uppercase: true, fontSize: 0.075, color: '#ffffff', highlightColor: '#ffe14a', activeWordBox: '', animation: 'pop', outlineWidth: 0.08, outlineColor: '#000000', shadow: 0.4, boxColor: '', wordsPerPage: 2 },
    captionY: 0.2, audio: { fadeIn: 0, fadeOut: 0.4, duckMusic: false }
  },
  {
    id: 'analog', name: 'Analog', tagline: 'Warm, grainy, remembered', builtin: true,
    description: 'Faded warm film stock with grain, gentle flicker and soft glow. Film-burn transitions and a typewritten voice.',
    look: [fx('color', { exposure: 0.02, contrast: -0.06, saturation: -0.16, temperature: 0.22, tint: 0.04, fade: 0.26, hue: 0 }), fx('glow', { amount: 0.22, radius: 22 }), fx('grain', { amount: 0.42, size: 1.9 }), fx('flicker', { amount: 0.12, speed: 14 }), fx('vignette', { amount: 0.42, size: 0.45 })],
    clipEffects: [fx('shake', { amount: 0.03, speed: 3, rotation: 0.15 })],
    transitions: { types: ['filmBurn', 'fade', 'dipBlack'], duration: 0.7 }, transitionSfx: 'tape', sfxVolume: 0.4,
    pacing: { shotLength: 3.5, beatSync: false, beatsPerShot: 4 },
    title: { fontFamily: 'Playfair Display', weight: 700, italic: true, uppercase: false, letterSpacing: 0, fontSize: 0.09, color: '#f3dfb8', animation: 'fade', shadow: 0.35, outlineWidth: 0, boxColor: '' },
    caption: { fontFamily: 'JetBrains Mono', weight: 400, italic: false, uppercase: false, fontSize: 0.036, color: '#f6e7c4', highlightColor: '#ff9d5c', activeWordBox: '', animation: 'typewriter', outlineWidth: 0, shadow: 0.9, boxColor: '', wordsPerPage: 6 },
    captionY: 0.36, audio: { fadeIn: 0.8, fadeOut: 1.5, duckMusic: true }
  },
  {
    id: 'luxury', name: 'Luxury', tagline: 'Slow, polished, expensive', builtin: true,
    description: 'Deep blacks with soft highlights, controlled push-ins and unhurried dissolves. Hairline serif titles in champagne.',
    look: [fx('color', { exposure: -0.03, contrast: 0.18, saturation: -0.22, temperature: 0.06, tint: 0, fade: 0, hue: 0 }), fx('glow', { amount: 0.3, radius: 30 }), fx('vignette', { amount: 0.55, size: 0.42 })],
    clipEffects: [fx('slowZoom', { amount: 0.06, driftX: 0, driftY: -0.01 })],
    transitions: { types: ['fade', 'blur', 'iris'], duration: 1.1 }, transitionSfx: 'swell', sfxVolume: 0.25,
    pacing: { shotLength: 4, beatSync: true, beatsPerShot: 8 },
    title: { fontFamily: 'Cormorant Garamond', weight: 400, italic: false, uppercase: true, letterSpacing: 0.42, fontSize: 0.05, color: '#e4cfa3', animation: 'blurIn', shadow: 0.3, outlineWidth: 0, boxColor: '' },
    caption: { fontFamily: 'DM Sans', weight: 400, italic: false, uppercase: true, letterSpacing: 0.16, fontSize: 0.026, color: '#ece2cc', highlightColor: '#e4cfa3', activeWordBox: '', animation: 'fade', outlineWidth: 0, shadow: 0.8, boxColor: '', wordsPerPage: 5 },
    captionY: 0.4, audio: { fadeIn: 1.5, fadeOut: 2.5, duckMusic: true }
  },
  {
    id: 'glitch', name: 'Glitch', tagline: 'Broken on purpose', builtin: true,
    description: 'Cold digital grade with RGB separation and bursts of signal damage. Glitch cuts and terminal type.',
    look: [fx('color', { exposure: 0, contrast: 0.2, saturation: 0.1, temperature: -0.14, tint: 0.06, fade: 0.04, hue: 0 }), fx('rgbSplit', { amount: 0.14, angle: 0 }), fx('glitch', { amount: 0.4, speed: 8, density: 0.16 }), fx('grain', { amount: 0.2, size: 1 })],
    clipEffects: [],
    transitions: { types: ['glitch', 'flash', 'glitch', 'whip'], duration: 0.3 }, transitionSfx: 'glitch', sfxVolume: 0.5,
    pacing: { shotLength: 1.8, beatSync: true, beatsPerShot: 4 },
    title: { fontFamily: 'Space Grotesk', weight: 700, italic: false, uppercase: true, letterSpacing: 0.06, fontSize: 0.11, color: '#eafcff', animation: 'glitch', shadow: 0, outlineWidth: 0, boxColor: '' },
    caption: { fontFamily: 'VT323', weight: 400, italic: false, uppercase: false, fontSize: 0.06, color: '#d7fbe0', highlightColor: '#ff3d81', activeWordBox: '', animation: 'glitch', outlineWidth: 0, shadow: 0.9, boxColor: '#000000cc', wordsPerPage: 5 },
    captionY: 0.34, audio: { fadeIn: 0, fadeOut: 0.5, duckMusic: false }
  },
  // The four below translate principles from the user's reference videos (see docs/STYLE_REFERENCES.md).
  {
    id: 'studio-warm', name: 'Studio Warm', tagline: 'Olive, cream and one amber accent', builtin: true,
    description: 'Warm olive-brown grade for talking-head explainers. Heavy sans with italic serif accents, mono label chips, word-by-word captions with an amber keyword.',
    look: [fx('color', { exposure: 0, contrast: 0.1, saturation: -0.1, temperature: 0.16, tint: -0.03, fade: 0.08, hue: 0 }), fx('duotone', { shadowHue: 62, highlightHue: 40, amount: 0.22 }), fx('vignette', { amount: 0.35, size: 0.55 }), fx('grain', { amount: 0.1, size: 1.2 })],
    clipEffects: [fx('slowZoom', { amount: 0.05, driftX: 0, driftY: 0 })],
    transitions: { types: ['slideUp', 'fade', 'push'], duration: 0.4 }, transitionSfx: 'tick', sfxVolume: 0.3,
    pacing: { shotLength: 3, beatSync: false, beatsPerShot: 4 },
    title: { fontFamily: 'Inter', weight: 900, italic: false, uppercase: false, letterSpacing: -0.02, fontSize: 0.1, color: '#f3ead7', accentFontFamily: 'Instrument Serif', accentItalic: true, accentColor: '', animation: 'words', shadow: 0.2, outlineWidth: 0, boxColor: '' },
    caption: { fontFamily: 'Inter', weight: 700, italic: false, uppercase: false, fontSize: 0.05, color: '#f8f2e4', highlightColor: '#e8b45a', activeWordBox: '', animation: 'words', outlineWidth: 0, shadow: 0.85, boxColor: '', wordsPerPage: 3 },
    captionY: 0.26, audio: { fadeIn: 0.3, fadeOut: 0.8, duckMusic: true }
  },
  {
    id: 'neon-product', name: 'Neon Product', tagline: 'Black room, one glowing colour', builtin: true,
    description: 'Crushed blacks with a green-tinted glow for screen and product demos. Floating zoom transitions and clean rounded captions.',
    look: [fx('color', { exposure: -0.08, contrast: 0.24, saturation: 0.1, temperature: -0.05, tint: -0.14, fade: 0, hue: 0 }), fx('glow', { amount: 0.4, radius: 26 }), fx('vignette', { amount: 0.6, size: 0.4 })],
    clipEffects: [fx('slowZoom', { amount: 0.07, driftX: 0, driftY: 0.01 })],
    transitions: { types: ['zoomOut', 'blur', 'zoomIn'], duration: 0.55 }, transitionSfx: 'whoosh', sfxVolume: 0.4,
    pacing: { shotLength: 2.5, beatSync: true, beatsPerShot: 4 },
    title: { fontFamily: 'DM Sans', weight: 700, italic: false, uppercase: false, letterSpacing: -0.01, fontSize: 0.075, color: '#f2fff5', animation: 'blurIn', shadow: 0.3, outlineWidth: 0, boxColor: '' },
    caption: { fontFamily: 'DM Sans', weight: 700, italic: false, uppercase: false, fontSize: 0.044, color: '#ffffff', highlightColor: '#39ff7a', activeWordBox: '', animation: 'fade', outlineWidth: 0, shadow: 0.4, boxColor: '#0b0d0bdd', boxRadius: 0.45, boxPadding: 0.4, wordsPerPage: 4 },
    captionY: 0.28, audio: { fadeIn: 0.3, fadeOut: 1, duckMusic: true }
  },
  {
    id: 'kinetic', name: 'Kinetic Type', tagline: 'Every word moves', builtin: true,
    description: 'Hot orange grade with words that drop, pop and scatter. Marker scribble titles, whip and spin cuts, a sound on every move.',
    look: [fx('color', { exposure: 0.02, contrast: 0.18, saturation: 0.22, temperature: 0.2, tint: 0.03, fade: 0, hue: 0 }), fx('vignette', { amount: 0.3, size: 0.55 })],
    clipEffects: [fx('zoomPulse', { amount: 0.1, bpm: 120 })],
    transitions: { types: ['whip', 'spin', 'zoomIn', 'slideLeft'], duration: 0.32 }, transitionSfx: 'whoosh', sfxVolume: 0.6,
    pacing: { shotLength: 1.8, beatSync: true, beatsPerShot: 4 },
    title: { fontFamily: 'Permanent Marker', weight: 400, italic: false, uppercase: true, letterSpacing: 0, fontSize: 0.15, color: '#ff4a3d', layout: 'scatter', tilt: 0.25, animation: 'drop', shadow: 0.5, outlineWidth: 0.02, outlineColor: '#ffffff', boxColor: '' },
    caption: { fontFamily: 'Archivo Black', weight: 400, italic: false, uppercase: false, fontSize: 0.07, color: '#ffffff', layout: 'scatter', tilt: 0.15, highlightColor: '#ffd23d', activeWordBox: '', animation: 'drop', outlineWidth: 0.03, outlineColor: '#7a1d00', shadow: 0.6, boxColor: '', wordsPerPage: 2 },
    captionY: 0.12, audio: { fadeIn: 0, fadeOut: 0.5, duckMusic: true }
  },
  {
    id: 'explainer', name: 'Explainer Pop', tagline: 'Big captions, boxed keyword', builtin: true,
    description: 'Bright, clean talking-head look on deep navy. Heavy outlined caps with the spoken word on a red-pink box, quick pushes between points.',
    look: [fx('color', { exposure: 0.05, contrast: 0.12, saturation: 0.12, temperature: 0.02, tint: 0, fade: 0, hue: 0 })],
    clipEffects: [fx('slowZoom', { amount: 0.05, driftX: 0, driftY: 0 })],
    transitions: { types: ['push', 'zoomIn', 'slideLeft'], duration: 0.3 }, transitionSfx: 'whoosh', sfxVolume: 0.35,
    pacing: { shotLength: 2.2, beatSync: false, beatsPerShot: 4 },
    title: { fontFamily: 'Archivo Black', weight: 400, italic: false, uppercase: true, letterSpacing: 0, fontSize: 0.09, color: '#ffffff', animation: 'pop', shadow: 0.4, outlineWidth: 0.06, outlineColor: '#000000', boxColor: '' },
    caption: { fontFamily: 'Archivo Black', weight: 400, italic: false, uppercase: true, fontSize: 0.058, color: '#ffffff', highlightColor: '#ffffff', activeWordBox: '#e83a5f', animation: 'none', outlineWidth: 0.09, outlineColor: '#000000', shadow: 0.3, boxColor: '', wordsPerPage: 3 },
    captionY: 0.22, audio: { fadeIn: 0.2, fadeOut: 0.6, duckMusic: true }
  }
]

export function findStyle(id: string, custom: StyleDef[] = []): StyleDef | undefined {
  return [...custom, ...BUILTIN_STYLES].find((s) => s.id === id)
}

/** Scales how strongly a style's look and movement are applied (1 = as designed). */
export function withIntensity(style: StyleDef, intensity: number): StyleDef {
  const scale = (list: StyleEffect[]): StyleEffect[] =>
    list.map((e) => ({ type: e.type, params: Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, ['size', 'radius', 'speed', 'bpm', 'ratio', 'shadowHue', 'highlightHue', 'angle', 'frequency', 'density'].includes(k) ? v : v * intensity])) }))
  return { ...style, look: scale(style.look), clipEffects: scale(style.clipEffects) }
}
