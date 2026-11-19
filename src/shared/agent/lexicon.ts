/** Matches the words in a request to effects, transitions, text animations, fonts, stacks and text looks. */
import { EFFECTS, EFFECT_STACKS, FONT_CATEGORIES, TEXT_ANIMATIONS, TRANSITIONS, type EffectStack, type NamedOption } from '../effects/registry'
import type { TextProps } from '../types'

const words = (s: string): string => s.toLowerCase().replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const has = (text: string, phrase: string): boolean => new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text)

/** Everyday words that mean an effect, beyond its own name. */
const EFFECT_ALIASES: Record<string, string[]> = {
  blackWhite: ['black and white', 'black white', 'b w', 'bw', 'monochrome', 'greyscale', 'grayscale', 'noir'],
  sepia: ['sepia', 'old photo'],
  grain: ['film grain', 'grain', 'grainy', 'noise texture'],
  vhs: ['vhs', 'old tv', 'camcorder', 'tape look'],
  glitch: ['glitch', 'glitchy', 'digital glitch'],
  rgbSplit: ['rgb split', 'rgb separation', 'color split', 'colour split'],
  glow: ['glow', 'soft glow', 'dreamy glow'],
  bloom: ['bloom', 'bright glow', 'light bloom'],
  neonGlow: ['neon', 'neon glow'],
  vignette: ['vignette', 'dark corners', 'darker edges'],
  letterbox: ['letterbox', 'black bars', 'cinema bars', 'cinematic bars', 'widescreen bars'],
  blur: ['blur', 'blurry', 'blurred', 'soften'],
  backgroundBlur: ['background blur', 'blur the background', 'blurred background', 'portrait mode', 'depth of field'],
  bokehBlur: ['bokeh'],
  lensBlur: ['lens blur'],
  spinBlur: ['spin blur', 'rotational blur'],
  zoomBlur: ['zoom blur', 'radial blur'],
  tiltShift: ['tilt shift', 'miniature', 'toy look'],
  pixelate: ['pixelate', 'pixelated', 'pixel art', 'mosaic', 'censor'],
  shake: ['camera shake', 'shake', 'shaky look', 'earthquake'],
  handheld: ['handheld', 'hand held', 'documentary feel'],
  zoomPulse: ['zoom pulse', 'pulse', 'beat zoom', 'zoom on the beat'],
  strobe: ['strobe', 'strobing', 'flashing lights'],
  flashHit: ['flash hit', 'white flash', 'flash'],
  scanlines: ['scan lines', 'scanlines', 'crt'],
  lightLeak: ['light leak', 'light leaks', 'leaks'],
  lensFlare: ['lens flare', 'flare', 'sun flare'],
  anamorphicFlare: ['anamorphic', 'anamorphic flare', 'blue streak'],
  godRays: ['god rays', 'sun rays', 'light beams'],
  lightRays: ['light rays', 'rays'],
  halation: ['halation', 'red glow'],
  chromaticAberration: ['chromatic aberration', 'lens fringing', 'color fringing'],
  wave: ['wave', 'wavy', 'wave distortion'],
  ripple: ['ripple', 'water ripple'],
  fisheye: ['fisheye', 'fish eye', 'wide angle bulge'],
  heatDistortion: ['heat distortion', 'heat haze', 'mirage'],
  liquid: ['liquid', 'wobble', 'melting'],
  pixelSort: ['pixel sort', 'pixel sorting'],
  datamosh: ['datamosh', 'data mosh', 'datamoshing'],
  digitalNoise: ['digital noise', 'static', 'tv static'],
  hdr: ['hdr', 'hdr look', 'high dynamic range'],
  filmEmulation: ['film emulation', 'film stock', 'kodak', 'fuji'],
  halftone: ['halftone', 'comic dots', 'comic book'],
  dust: ['dust', 'dust and hairs', 'old film dust'],
  scratches: ['scratches', 'film scratches'],
  paperTexture: ['paper texture', 'paper look'],
  filmBurn: ['film burn', 'burn'],
  chromaKey: ['green screen', 'chroma key', 'chromakey', 'greenscreen', 'remove the green', 'key out'],
  lumaKey: ['luma key'],
  dropShadow: ['drop shadow', 'shadow'],
  innerShadow: ['inner shadow'],
  stroke: ['stroke', 'border', 'outline around'],
  roundedCorners: ['rounded corners', 'round corners', 'rounded edges'],
  reflection: ['reflection', 'mirror floor', 'floor reflection'],
  cornerPin: ['corner pin', 'perspective'],
  kenBurns: ['ken burns', 'slow pan and zoom'],
  dollyZoom: ['dolly zoom', 'vertigo effect', 'vertigo'],
  parallax: ['parallax'],
  camera3d: ['3d camera', '3d rotate', 'rotate in 3d', '3d tilt'],
  slowZoom: ['slow zoom', 'slow push in', 'push in', 'slow push'],
  spin: ['spin', 'rotate', 'rotating'],
  mirror: ['mirror', 'kaleidoscope', 'symmetry'],
  tile: ['tile', 'tiled', 'grid of copies'],
  invert: ['invert', 'negative', 'inverted colors', 'inverted colours'],
  duotone: ['split tone', 'duotone', 'two tone'],
  colorWash: ['color wash', 'colour wash', 'tint'],
  colorShift: ['color shift', 'colour shift', 'rainbow shift', 'hue cycle'],
  colorWheels: ['color wheels', 'colour wheels', 'color grade wheels'],
  selectiveColor: ['selective color', 'selective colour'],
  colorIsolation: ['color isolation', 'colour isolation', 'color pop', 'colour pop', 'keep only the red', 'keep only the blue'],
  spotlight: ['spotlight'],
  flicker: ['flicker', 'flickering'],
  motionBlur: ['motion blur'],
  displacementMap: ['displacement', 'displacement map'],
  lut: ['lut']
}

export interface Match<T> { item: T; matched: string }

function aliasesFor(type: string, name: string): string[] {
  return [...new Set([...(EFFECT_ALIASES[type] ?? []), words(name), words(type)])].filter((a) => a.length > 1)
}

/** All effects mentioned, longest phrases first so "motion blur" is not also read as "blur". Text after a match is blanked. */
export function findEffects(text: string): { type: string; name: string; alias: string }[] {
  let t = ` ${words(text)} `
  const found: { type: string; name: string; alias: string; at: number }[] = []
  const candidates = EFFECTS.flatMap((e) => aliasesFor(e.type, e.name).map((a) => ({ e, a }))).sort((x, y) => y.a.length - x.a.length)
  for (const { e, a } of candidates) {
    const i = t.indexOf(` ${a} `)
    if (i < 0 || found.some((f) => f.type === e.type)) continue
    found.push({ type: e.type, name: e.name, alias: a, at: i })
    t = t.slice(0, i) + ' '.repeat(a.length + 2) + t.slice(i + a.length + 2)
  }
  return found.sort((a, b) => a.at - b.at).map(({ type, name, alias }) => ({ type, name, alias }))
}

const TRANSITION_ALIASES: Record<string, string[]> = {
  fade: ['fade', 'cross dissolve', 'crossfade', 'dissolve'], dipBlack: ['dip to black', 'fade to black', 'fade through black'], dipWhite: ['dip to white', 'fade to white'],
  flash: ['flash'], slideLeft: ['slide left'], slideRight: ['slide right'], slideUp: ['slide up'], slideDown: ['slide down'], push: ['push'], whip: ['whip pan', 'whip', 'swish', 'swish pan'],
  zoomIn: ['zoom in', 'zoom'], zoomOut: ['zoom out'], spin: ['spin', 'twirl'], wipe: ['wipe'], iris: ['iris', 'circle reveal'], blur: ['blur'], glitch: ['glitch'], filmBurn: ['film burn'],
  cut: ['hard cut', 'plain cut'], smoothFade: ['smooth fade'], swipe: ['swipe'], pan: ['camera pan'], cameraShake: ['shake cut', 'camera shake'], roll: ['roll'], tilt: ['tilt'],
  rgbSplitTransition: ['rgb split'], liquidTransition: ['liquid', 'water'], warp: ['warp', 'hyperspace'], morph: ['morph'], blinds: ['blinds', 'venetian'], shatter: ['shatter', 'break apart', 'glass'],
  pixelateTransition: ['pixelate', 'pixel'], stretch: ['stretch'], spinZoom: ['spin zoom', 'spiral'],
  whipLeft: ['motion blur whip', 'motion blur transition', 'blur whip', 'whip left', 'clean whip'], whipRight: ['whip right'], whipUp: ['whip up'], whipDown: ['whip down'], rgbWhip: ['rgb whip', 'chromatic whip'],
  beatShake: ['beat shake', 'shake transition', 'bass shake', 'shake hit'], beatPunch: ['beat punch', 'punch transition', 'bass punch', 'punch in'], flashShake: ['flash shake', 'impact'], slamZoom: ['slam zoom', 'slam'],
  zoomBlurIn: ['zoom blur', 'zoom blur in', 'blur zoom'], zoomBlurOut: ['zoom blur out'], spinBlur: ['spin blur', 'rotate blur'], glide: ['glide', 'smooth slide'], shakeSlide: ['shake slide']
}

export function findTransition(text: string): NamedOption | undefined {
  const t = ` ${words(text)} `
  const all = TRANSITIONS.flatMap((tr) => [...(TRANSITION_ALIASES[tr.type] ?? []), words(tr.name), words(tr.type)].map((a) => ({ tr, a }))).filter((x) => x.a.length > 1).sort((x, y) => y.a.length - x.a.length)
  return all.find(({ a }) => t.includes(` ${a} `))?.tr
}

const ANIMATION_ALIASES: Record<string, string[]> = {
  fade: ['fade in', 'fades in'], pop: ['pop', 'pops'], slideUp: ['slide up', 'rise'], words: ['word by word', 'one word at a time'], typewriter: ['typewriter', 'typing', 'type on'],
  blurIn: ['blur in'], tracking: ['tracking in', 'spread out'], drop: ['drop in', 'drop', 'fall in'], glitch: ['glitch'], wave: ['wave', 'wavy'], letters: ['letter by letter', 'one letter at a time'],
  stagger: ['stagger'], slideLeft: ['slide in from the right', 'slide left'], slideRight: ['slide in from the left', 'slide right'], slideDown: ['slide down'], bounce: ['bounce', 'bouncy'],
  elastic: ['elastic', 'rubber'], scaleUp: ['scale up', 'grow'], scaleDown: ['scale down', 'shrink in'], maskReveal: ['mask reveal', 'reveal', 'wipe in'], rotating: ['rotate in', 'spin in'],
  flip3D: ['flip', '3d flip'], kinetic: ['kinetic'], shake: ['shake', 'shaking'], morph: ['morph', 'scramble', 'decode', 'hacker'], splitText: ['split']
}

export function findTextAnimation(text: string): NamedOption | undefined {
  const t = ` ${words(text)} `
  const all = TEXT_ANIMATIONS.flatMap((a) => [...(ANIMATION_ALIASES[a.type] ?? []), words(a.name)].map((x) => ({ a, x }))).filter((x) => x.x.length > 1 && x.a.type !== 'none').sort((p, q) => q.x.length - p.x.length)
  return all.find(({ x }) => t.includes(` ${x} `))?.a
}

export function findFont(text: string): string | undefined {
  const t = ` ${words(text)} `
  if (/ minecraft( font)? /.test(t)) return 'Monocraft'
  return FONT_CATEGORIES.flatMap((c) => c.fonts).filter((f) => has(t, words(f))).sort((a, b) => b.length - a.length)[0]
}

const STACK_ALIASES: Record<string, string[]> = {
  'Teal & Orange': ['teal and orange', 'teal orange', 'orange and teal', 'blockbuster look'], Dream: ['dreamy', 'dream', 'soft glow'], 'VHS Tape': ['vhs tape', 'vhs'], 'Old Film': ['old film', 'aged film'],
  Noir: ['noir', 'film noir'], 'Neon Night': ['neon night', 'neon look'], 'Retro Film': ['retro film'], Cyberpunk: ['cyberpunk', 'cyber punk'], 'Golden Hour': ['golden hour', 'sunset look'],
  Miniature: ['miniature look'], 'Security Cam': ['security cam', 'cctv', 'surveillance'], Vaporwave: ['vaporwave', 'vapor wave', 'synthwave', 'retrowave'], 'Broken Signal': ['broken signal', 'signal loss'],
  'Modern Minimal': ['modern minimal', 'minimal look'], 'Analog Film': ['analog film', 'analogue film'], Kinetic: ['kinetic energy']
}

export function findStack(text: string): EffectStack | undefined {
  return findStackMatch(text)?.stack
}

/** The stack and the words that named it. */
export function findStackMatch(text: string): { stack: EffectStack; alias: string } | undefined {
  const t = ` ${words(text)} `
  const hit = EFFECT_STACKS.flatMap((s) => [...(STACK_ALIASES[s.name] ?? []), words(s.name)].map((a) => ({ s, a }))).filter(({ a }) => t.includes(` ${a} `)).sort((x, y) => y.a.length - x.a.length)[0]
  return hit ? { stack: hit.s, alias: hit.a } : undefined
}

/** Ready-made looks for text. */
export const TEXT_LOOKS: Record<string, { name: string; words: string[]; look: Partial<TextProps> }> = {
  title: { name: 'Big title', words: [], look: { fontFamily: 'Anton', fontSize: 0.12, weight: 400, uppercase: true, letterSpacing: 0.02, animation: 'pop', shadow: 0.6 } },
  lowerThird: { name: 'Lower third', words: ['lower third', 'name tag', 'name label'], look: { fontFamily: 'DM Sans', fontSize: 0.045, weight: 700, align: 'left', boxColor: '#0b1020cc', boxPadding: 0.4, boxRadius: 0.15, animation: 'slideRight', shadow: 0 } },
  subtitle: { name: 'Subtitle', words: ['subtitle', 'caption line', 'small text'], look: { fontFamily: 'Inter', fontSize: 0.045, weight: 600, outlineWidth: 0.05, animation: 'fade', shadow: 0.8 } },
  neon: { name: 'Neon sign', words: ['neon'], look: { fontFamily: 'Orbitron', fontSize: 0.1, weight: 700, color: '#e8ffff', glowColor: '#22d3ee', glowAmount: 1, animation: 'fade', shadow: 0 } },
  gold: { name: 'Gold 3D', words: ['gold', 'golden', 'luxury', 'luxurious'], look: { fontFamily: 'Cinzel', fontSize: 0.11, weight: 700, fillKind: 'gold', extrudeDepth: 0.06, extrudeColor: '#4a3206', extrudeAngle: 60, letterSpacing: 0.06, animation: 'fade', shadow: 0.5 } },
  chrome: { name: 'Chrome', words: ['chrome', 'metal', 'metallic', 'silver'], look: { fontFamily: 'Archivo Black', fontSize: 0.11, weight: 400, fillKind: 'chrome', outlineWidth: 0.01, animation: 'scaleUp' } },
  threeD: { name: '3D block', words: ['3d', 'extruded', 'block letters'], look: { fontFamily: 'Bowlby One', fontSize: 0.12, weight: 400, extrudeDepth: 0.09, extrudeColor: '#1b2a6b', extrudeAngle: 55, animation: 'drop' } },
  outline: { name: 'Outline', words: ['outline', 'outlined', 'hollow', 'stroked'], look: { fontFamily: 'Anton', fontSize: 0.12, weight: 400, hollow: true, outlineWidth: 0.025, uppercase: true, animation: 'maskReveal', shadow: 0 } },
  retro: { name: 'Retro game', words: ['retro', 'pixel', '8 bit', '8bit', 'arcade'], look: { fontFamily: 'Press Start 2P', fontSize: 0.05, weight: 400, color: '#ffe14a', outlineWidth: 0.04, animation: 'typewriter' } },
  handwritten: { name: 'Handwritten', words: ['handwritten', 'handwriting', 'scribble', 'signature'], look: { fontFamily: 'Caveat', fontSize: 0.09, weight: 700, animation: 'maskReveal', shadow: 0.3 } },
  cinematic: { name: 'Cinematic', words: ['cinematic', 'movie title', 'film title'], look: { fontFamily: 'Cormorant Garamond', fontSize: 0.08, weight: 600, uppercase: true, letterSpacing: 0.3, animation: 'tracking', shadow: 0.7 } },
  gradient: { name: 'Gradient', words: ['gradient', 'colorful', 'colourful', 'rainbow'], look: { fontFamily: 'Montserrat', fontSize: 0.11, weight: 700, fillKind: 'gradient', color: '#ff3d81', fillColor2: '#ffb347', fillAngle: 90, animation: 'pop' } },
  meme: { name: 'Meme caption', words: ['meme'], look: { fontFamily: 'Anton', fontSize: 0.09, weight: 400, uppercase: true, outlineWidth: 0.09, outlineColor: '#000000', animation: 'pop' } },
  kinetic: { name: 'Kinetic', words: ['kinetic', 'dynamic text'], look: { fontFamily: 'Archivo Black', fontSize: 0.1, weight: 400, uppercase: true, animation: 'kinetic' } },
  minimal: { name: 'Minimal', words: ['minimal', 'clean', 'simple', 'modern'], look: { fontFamily: 'Inter', fontSize: 0.05, weight: 500, letterSpacing: 0.12, uppercase: true, animation: 'fade', shadow: 0 } },
  glitch: { name: 'Glitch', words: ['glitch', 'cyber', 'cyberpunk'], look: { fontFamily: 'Chakra Petch', fontSize: 0.09, weight: 700, color: '#e8fff3', glowColor: '#ff2bd6', glowAmount: 0.6, animation: 'glitch' } },
  minecraft: { name: 'Blocky game style', words: ['minecraft', 'blocky', 'block game'], look: { fontFamily: 'Monocraft', fontSize: 0.07, weight: 400, color: '#ffffff', extrudeDepth: 0.02, extrudeAngle: 45, extrudeColor: '#3a3a3a', animation: 'fade', shadow: 0 } },
  comic: { name: 'Comic', words: ['comic', 'cartoon', 'fun'], look: { fontFamily: 'Bangers', fontSize: 0.1, weight: 400, color: '#ffe14a', outlineWidth: 0.07, outlineColor: '#111111', extrudeDepth: 0.03, extrudeColor: '#111111', animation: 'bounce' } }
}

export function findTextLook(text: string): string | undefined {
  const t = ` ${words(text)} `
  return Object.entries(TEXT_LOOKS).flatMap(([id, l]) => l.words.map((w) => ({ id, w }))).sort((a, b) => b.w.length - a.w.length).find(({ w }) => t.includes(` ${w} `))?.id
}
