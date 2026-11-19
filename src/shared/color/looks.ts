/**
 * Built-in colour looks: 3-D lookup tables computed from formulas, so there are no files to ship and no licences.
 * Each look maps a colour (0..1 per channel) to a new colour; `buildLook` bakes it into a table the LUT effect uses.
 */
import { type LutTable } from './cube'

type RGB = [number, number, number]
type Grade = (c: RGB) => RGB

export type LookCategory = 'Cinematic' | 'Film' | 'Black and white' | 'Social' | 'Dark and moody'
export interface LookDef { id: string; name: string; category: LookCategory; grade: Grade }

const clamp = (v: number): number => Math.min(1, Math.max(0, v))
const luma = ([r, g, b]: RGB): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const smooth = (e0: number, e1: number, x: number): number => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t) }
const sCurve = (c: RGB, amount: number): RGB => c.map((v) => clamp(v + amount * (smooth(0, 1, v) - v))) as RGB
const saturate = (c: RGB, s: number): RGB => { const l = luma(c); return [clamp(l + (c[0] - l) * s), clamp(l + (c[1] - l) * s), clamp(l + (c[2] - l) * s)] }
const gain = (c: RGB, g: RGB): RGB => [clamp(c[0] * g[0]), clamp(c[1] * g[1]), clamp(c[2] * g[2])]
const lift = (c: RGB, l: RGB): RGB => [clamp(c[0] + l[0] * (1 - c[0])), clamp(c[1] + l[1] * (1 - c[1])), clamp(c[2] + l[2] * (1 - c[2]))]
const gamma = (c: RGB, g: number): RGB => [clamp(c[0] ** g), clamp(c[1] ** g), clamp(c[2] ** g)]
/** Tints the shadows and the highlights separately (the "split tone"). */
const splitTone = (c: RGB, shadow: RGB, high: RGB, amount: number): RGB => {
  const l = luma(c)
  const t = mix(shadow, high, smooth(0.25, 0.75, l))
  const w = amount * (1 - Math.abs(l - 0.5) * 0.8)
  return [clamp(c[0] + (t[0] - 0.5) * w), clamp(c[1] + (t[1] - 0.5) * w), clamp(c[2] + (t[2] - 0.5) * w)]
}
const grey = (c: RGB): RGB => { const l = luma(c); return [l, l, l] }
const fade = (c: RGB, black: number, white = 1): RGB => c.map((v) => black + v * (white - black)) as RGB

const L = (id: string, name: string, category: LookCategory, grade: Grade): LookDef => ({ id, name, category, grade })

export const LOOKS: LookDef[] = [
  L('tealOrange', 'Teal and orange', 'Cinematic', (c) => saturate(sCurve(splitTone(c, [0.1, 0.5, 0.6], [0.95, 0.6, 0.3], 0.9), 0.35), 1.1)),
  L('blockbuster', 'Blockbuster', 'Cinematic', (c) => saturate(sCurve(splitTone(c, [0.15, 0.45, 0.55], [0.9, 0.65, 0.4], 0.6), 0.5), 1.15)),
  L('bleach', 'Bleach bypass', 'Cinematic', (c) => { const g = grey(c); return sCurve(mix(c, [g[0], g[1], g[2]], 0.55), 0.55) }),
  L('moodyBlue', 'Moody blue', 'Cinematic', (c) => saturate(sCurve(gain(gamma(c, 1.1), [0.9, 0.98, 1.1]), 0.3), 0.8)),
  L('goldenHour', 'Golden hour', 'Cinematic', (c) => saturate(gain(lift(c, [0.03, 0.01, 0]), [1.12, 1.0, 0.82]), 1.15)),
  L('coldSteel', 'Cold steel', 'Cinematic', (c) => saturate(sCurve(gain(c, [0.88, 0.98, 1.12]), 0.35), 0.7)),
  L('kodak', 'Warm film', 'Film', (c) => sCurve(saturate(gain(lift(c, [0.02, 0.01, 0]), [1.07, 1.0, 0.9]), 1.12), 0.3)),
  L('fuji', 'Green film', 'Film', (c) => sCurve(saturate(gain(c, [0.96, 1.05, 0.98]), 1.05), 0.25)),
  L('fadedFilm', 'Faded film', 'Film', (c) => saturate(fade(sCurve(c, 0.2), 0.07, 0.94), 0.85)),
  L('crossProcess', 'Cross process', 'Film', (c) => [clamp(c[0] ** 0.8 * 1.05), clamp(c[1] * 1.0), clamp(c[2] ** 1.3 * 0.9 + 0.04)]),
  L('seventies', 'Vintage 70s', 'Film', (c) => saturate(fade(gain(c, [1.1, 0.98, 0.8]), 0.05, 0.96), 0.9)),
  L('sepia', 'Sepia', 'Film', (c) => { const l = luma(c); return [clamp(l * 1.1 + 0.04), clamp(l * 0.95 + 0.02), clamp(l * 0.75)] }),
  L('noirBW', 'Noir', 'Black and white', (c) => { const g = grey(c)[0]; const v = sCurve([g, g, g], 0.8)[0]; return [v, v, v] }),
  L('silverBW', 'Soft silver', 'Black and white', (c) => { const g = fade(grey(c), 0.04, 0.97)[0]; return [g, g, g] }),
  L('highKeyBW', 'High-key black and white', 'Black and white', (c) => { const g = clamp(grey(c)[0] ** 0.7 * 1.05); return [g, g, g] }),
  L('vivid', 'Vivid pop', 'Social', (c) => saturate(sCurve(c, 0.3), 1.45)),
  L('cleanBright', 'Clean and bright', 'Social', (c) => saturate(gamma(gain(c, [1.04, 1.04, 1.04]), 0.9), 1.1)),
  L('pastel', 'Pastel', 'Social', (c) => saturate(fade(gamma(c, 0.85), 0.08, 1), 0.7)),
  L('matte', 'Matte', 'Social', (c) => fade(sCurve(c, 0.15), 0.1, 0.95)),
  L('neonNight', 'Neon night', 'Social', (c) => saturate(sCurve(splitTone(c, [0.3, 0.1, 0.7], [0.1, 0.8, 0.9], 1.1), 0.45), 1.4)),
  L('darkTrap', 'Dark trap', 'Dark and moody', (c) => saturate(sCurve(splitTone(gamma(c, 1.25), [0.45, 0.4, 0.55], [0.85, 0.55, 0.5], 0.7), 0.6), 0.65)),
  L('crimson', 'Crimson night', 'Dark and moody', (c) => saturate(sCurve(gain(gamma(c, 1.3), [1.15, 0.8, 0.85]), 0.5), 0.9)),
  L('ashGrey', 'Ash grey', 'Dark and moody', (c) => saturate(sCurve(gamma(c, 1.15), 0.5), 0.35))
]

export const lookById = (id: string): LookDef | undefined => LOOKS.find((l) => l.id === id)

/** Bakes a look into a lookup table (red varies fastest). 21 samples per side is smooth for these gentle grades. */
export function buildLook(id: string, size = 21): LutTable | undefined {
  const look = lookById(id)
  if (!look) return undefined
  const data = new Float32Array(size ** 3 * 3)
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const out = look.grade([r / (size - 1), g / (size - 1), b / (size - 1)])
        data.set([clamp(out[0]), clamp(out[1]), clamp(out[2])], (r + g * size + b * size * size) * 3)
      }
  return { size, data }
}

/** Other ways to name a look in a request. */
export const LOOK_ALIASES: Record<string, string[]> = {
  tealOrange: ['teal and orange', 'teal orange', 'teal & orange'], bleach: ['bleach bypass', 'bleach'], kodak: ['kodak', 'warm film'], fuji: ['fuji', 'green film'], fadedFilm: ['faded film', 'faded'],
  crossProcess: ['cross process', 'cross processed'], seventies: ['70s', 'seventies', 'vintage'], noirBW: ['noir', 'black and white', 'b&w', 'monochrome'], silverBW: ['soft silver', 'silver'], highKeyBW: ['high key'],
  vivid: ['vivid', 'vibrant', 'pop'], cleanBright: ['clean and bright', 'bright and clean'], neonNight: ['neon night', 'neon'], darkTrap: ['dark trap', 'trap', 'rage'], crimson: ['crimson', 'red night'],
  ashGrey: ['ash grey', 'ash gray', 'ash'], goldenHour: ['golden hour', 'sunset'], coldSteel: ['cold steel', 'steel'], moodyBlue: ['moody blue'], blockbuster: ['blockbuster'], sepia: ['sepia'], pastel: ['pastel'], matte: ['matte']
}
