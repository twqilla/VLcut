/**
 * Everything about driving interpolini (https://github.com/Z1xus/interpolini, GPL-3.0): the settings it
 * understands, the way it weights frames when blending (ported from its weights.rs and checked against
 * the real Rust code by tests/interpolini.test.ts), the command line to run it, and its JSON event lines.
 *
 * interpolini does the work itself (RIFE or SVP interpolation on the graphics card, then the blend).
 * This file never blends pictures; it only prepares the call and reads the reply.
 */

export const WEIGHTINGS = ['equal', 'gaussian', 'gaussian_sym', 'pyramid', 'ascending', 'descending', 'vegas', 'custom'] as const
export type Weighting = (typeof WEIGHTINGS)[number]

export interface InterpoliniSettings {
  /** Make extra frames first (SVP or RIFE). Off means the clip's own frames are only blended down. */
  interpolate: boolean
  /** Frame rate to blend down to. Empty means the same as the export's frame rate. */
  blendFps?: number
  /** 'svp' (default) or 'rife' (AI). */
  engine: 'svp' | 'rife'
  /** Interpolate up to this many frames per second ("960"), or a multiple of the clip's rate ("x16"). */
  fps: string
  speed: 'medium' | 'fast' | 'faster' | 'fastest'
  tuning: 'weak' | 'smooth' | 'film' | 'animation'
  /** interpolini's algorithm numbers: 2 sharp, 13 standard, 23 smooth. */
  algorithm: '2' | '13' | '23'
  /** Search for motion on a half-size picture: faster, a little less exact. */
  half: boolean
  /** Remove repeated frames (typical of game capture) before interpolating. */
  dedup: boolean
  /** Shutter length: 1 blends a whole frame interval. */
  intensity: number
  /** Blend in a gamma-corrected space (1 = off). */
  gamma: number
  weighting: Weighting
  /** Used when weighting is 'custom': relative weights spread across the blend window. */
  custom: number[]
}

/** interpolini's own defaults (crates/core/src/config.rs). */
export const DEFAULT_INTERPOLINI: InterpoliniSettings = {
  interpolate: true, engine: 'svp', fps: '960', speed: 'faster', tuning: 'film', algorithm: '13', half: true, dedup: true, intensity: 1, gamma: 1, weighting: 'equal', custom: [1, 2, 5]
}

export const WEIGHTING_LABELS: Record<Weighting, string> = {
  equal: 'Equal', gaussian: 'Gaussian (favours the end)', gaussian_sym: 'Gaussian (centred)', pyramid: 'Pyramid', ascending: 'Ascending', descending: 'Descending', vegas: 'Vegas', custom: 'Custom'
}

/** An interpolation rate: a number of frames per second, or a multiple of the clip's rate ("x16" or "16x"). */
export function resolveRate(rate: string, sourceFps: number): number {
  const text = rate.trim().toLowerCase()
  const times = text.startsWith('x') ? text.slice(1) : text.endsWith('x') ? text.slice(0, -1) : null
  if (times !== null) {
    const n = Number(times)
    return n >= 1 && n <= 1000 ? Math.round(sourceFps * Math.fround(n)) : Math.round(sourceFps)
  }
  const fps = Number(text)
  return Number.isInteger(fps) && fps >= 2 && fps <= 100000 ? fps : Math.round(sourceFps)
}

// ---------- blend weights (port of interpolini's weights.rs) ----------

function normalize(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map((w) => w / total)
}

function spread(count: number, start: number, end: number): number[] {
  const last = Math.max(count - 1, 1)
  return Array.from({ length: count }, (_, x) => (x * (end - start)) / last + start)
}

function gaussian(count: number, mean: number, start: number, end: number): number[] {
  return spread(count, start, end).map((x) => Math.exp(-((x - mean) * (x - mean)) / 2))
}

function vegas(ratio: number): number[] {
  const factor = Math.trunc(ratio)
  if (factor % 2 === 1) return new Array(factor).fill(1)
  const weights = new Array(factor + 1).fill(2)
  weights[0] = 1
  weights[factor] = 1
  return weights
}

/**
 * The weights interpolini gives the frames of one blend window.
 * @param sourceFps the frame rate after interpolation
 * @param blendFps the frame rate of the finished clip (blending.fps)
 */
export function blendWeights(sourceFps: number, blendFps: number, intensity: number, weighting: Weighting, custom: number[] = DEFAULT_INTERPOLINI.custom): number[] {
  const ratio = (sourceFps / blendFps) * Math.fround(intensity) // interpolini keeps intensity as a 32-bit float
  if (Math.round(ratio) <= 1) return [1]
  const count = Math.round(ratio) | 1 // the blend takes an odd window only
  const half = (count - 1) / 2
  switch (weighting) {
    case 'equal': return normalize(new Array(count).fill(1))
    case 'gaussian': return normalize(gaussian(count, 2, 0, 2))
    case 'gaussian_sym': return normalize(gaussian(count, 0, -2, 2))
    case 'pyramid': return normalize(Array.from({ length: count }, (_, x) => half - Math.abs(x - half) + 1))
    case 'ascending': return normalize(Array.from({ length: count }, (_, x) => x + 1))
    case 'descending': return normalize(Array.from({ length: count }, (_, x) => count - x))
    case 'vegas': return normalize(vegas(ratio))
    case 'custom': return normalize(spread(count, 0, custom.length - 0.1).map((x) => Math.fround(custom[Math.trunc(x)])))
  }
}

/** Brings settings from the interface into range. Values end up on a command line, so each is checked against what interpolini accepts. */
export function normalizeInterpolini(input: Partial<InterpoliniSettings> | undefined): InterpoliniSettings {
  const i: Partial<InterpoliniSettings> = input ?? {}
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
  const blendFps = Number(i.blendFps)
  return {
    interpolate: i.interpolate !== false,
    ...(Number.isFinite(blendFps) && blendFps >= 1 && blendFps <= 1000 ? { blendFps: Math.round(blendFps) } : {}),
    engine: pick(i.engine, ['svp', 'rife'], DEFAULT_INTERPOLINI.engine),
    fps: /^(x\d{1,4}|\d{1,4}x|\d{2,5})$/i.test(String(i.fps ?? '')) ? String(i.fps).toLowerCase() : DEFAULT_INTERPOLINI.fps,
    speed: pick(i.speed, ['medium', 'fast', 'faster', 'fastest'], DEFAULT_INTERPOLINI.speed),
    tuning: pick(i.tuning, ['weak', 'smooth', 'film', 'animation'], DEFAULT_INTERPOLINI.tuning),
    algorithm: pick(i.algorithm, ['2', '13', '23'], DEFAULT_INTERPOLINI.algorithm),
    half: i.half !== false,
    dedup: i.dedup !== false,
    intensity: Math.max(0, Math.min(10, Number(i.intensity ?? 1))) || DEFAULT_INTERPOLINI.intensity,
    gamma: Math.max(1, Math.min(10, Number(i.gamma ?? 1))) || 1,
    weighting: pick(i.weighting, WEIGHTINGS, DEFAULT_INTERPOLINI.weighting),
    custom: Array.isArray(i.custom) && i.custom.length > 0 && i.custom.length <= 64 && i.custom.every((v) => Number(v) > 0 && Number(v) < 1e6) ? i.custom.map(Number) : DEFAULT_INTERPOLINI.custom
  }
}

// ---------- command line ----------

const listText = (values: number[]): string => `[${values.join(', ')}]`

/** The `-s section.key=value` settings for one run. */
export function interpoliniSettingArgs(s: InterpoliniSettings, blendFps: number): string[] {
  const set = (name: string, value: string | number | boolean): string[] => ['-s', `${name}=${typeof value === 'boolean' ? (value ? 'yes' : 'no') : value}`]
  return [
    ...set('dedup.enabled', s.dedup),
    ...set('interpolation.enabled', s.interpolate),
    ...set('interpolation.engine', s.engine),
    ...set('interpolation.fps', s.fps),
    ...set('interpolation.speed', s.speed),
    ...set('interpolation.tuning', s.tuning),
    ...set('interpolation.algorithm', s.algorithm),
    ...set('interpolation.half size', s.half),
    ...set('blending.enabled', true),
    ...set('blending.fps', Math.max(1, Math.min(1000, Math.round(s.blendFps ?? blendFps)))),
    ...set('blending.intensity', s.intensity),
    ...set('blending.gamma', s.gamma),
    ...set('blending.weighting', s.weighting === 'custom' ? listText(s.custom) : s.weighting),
    // The result is only an intermediate: keep it clean, and leave everything else to this editor.
    ...set('color.enabled', false),
    ...set('upscale.enabled', false),
    ...set('output.codec', 'h264'),
    ...set('output.container', 'mp4'),
    ...set('output.quality', 12)
  ]
}

/** `-g` ignores configs next to the clip, `-j` prints JSON lines. */
export function interpoliniArgs(s: InterpoliniSettings, blendFps: number, clip: string): string[] {
  return ['-g', '-j', ...interpoliniSettingArgs(s, blendFps), clip]
}

// ---------- reply ----------

export type InterpoliniEvent =
  | { event: 'start'; clip: string }
  | { event: 'info' | 'warning'; message: string }
  | { event: 'preparing'; done: number }
  | { event: 'progress'; frame: number; frames: number; fps: number }
  | { event: 'done'; clip: string; output: string; seconds: number }
  | { event: 'failed'; clip: string; error: string }

/** Reads one JSON line printed by `interpolini-cli -j`; anything else is ignored. */
export function parseInterpoliniLine(line: string): InterpoliniEvent | null {
  const text = line.trim()
  if (!text.startsWith('{')) return null
  try {
    const value = JSON.parse(text) as { event?: string }
    return typeof value.event === 'string' ? (value as InterpoliniEvent) : null
  } catch {
    return null
  }
}

/** The frame rate of the frames that get blended: the interpolation rate, or the clip's own rate when interpolation is off. */
export const sourceRate = (s: InterpoliniSettings, clipFps: number): number => (s.interpolate ? resolveRate(s.fps, clipFps) : Math.round(clipFps))

/** One sentence for the export dialog about what a setting combination will do to each frame. */
export function describeBlend(s: InterpoliniSettings, clipFps: number, blendFps: number): string {
  const high = sourceRate(s, clipFps)
  const target = s.blendFps ?? blendFps
  const weights = blendWeights(high, target, s.intensity, s.weighting, s.custom)
  const what = s.interpolate ? `${high} fps interpolated frames` : `${high} fps frames of the clip`
  return weights.length === 1
    ? `${s.interpolate ? `Interpolated to ${high} fps` : `The clip is ${high} fps`} but blended into ${target} fps with a window of 1 frame, so there is no visible blur. ${s.interpolate ? 'Raise the interpolation rate or the intensity.' : 'Use footage with a higher frame rate than the target, or turn interpolation on.'}`
    : `Each ${target} fps frame blends ${weights.length} of the ${what}.`
}

// ---------- config files (.cfg) ----------

/** A safe file name (without extension) for a saved configuration. */
export const cfgFileName = (name: string): string => name.replace(/[^\w .()-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'config'


/** The settings as a .cfg text file, in sections like interpolini's own configuration, so it can be read and edited by hand. */
export function interpoliniToCfg(s: InterpoliniSettings, title = 'VLcut interpolini settings'): string {
  const v = (x: string | number | boolean): string => (typeof x === 'boolean' ? (x ? 'yes' : 'no') : String(x))
  const lines = [
    `# ${title}`,
    '# Edit the values, save the file, then use Reload in VLcut. "fps" under [blending] is optional: leave it out to use the export frame rate.',
    '', '[dedup]', `enabled = ${v(s.dedup)}`,
    '', '[interpolation]', `enabled = ${v(s.interpolate)}`, `engine = ${s.engine}`, `fps = ${s.fps}`, `speed = ${s.speed}`, `tuning = ${s.tuning}`, `algorithm = ${s.algorithm}`, `half size = ${v(s.half)}`,
    '', '[blending]', ...(s.blendFps ? [`fps = ${s.blendFps}`] : []), `intensity = ${s.intensity}`, `gamma = ${s.gamma}`, `weighting = ${s.weighting === 'custom' ? listText(s.custom) : s.weighting}`
  ]
  return lines.join('\n') + '\n'
}

/** Reads a .cfg text back into settings. Unknown lines are ignored; every value is checked, so a typo cannot break a run. */
export function cfgToInterpolini(text: string): InterpoliniSettings {
  const got: Record<string, string> = {}
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const head = /^\[([^\]]+)\]$/.exec(line)
    if (head) { section = head[1].trim().toLowerCase(); continue }
    const eq = line.indexOf('=')
    if (eq > 0) got[`${section}.${line.slice(0, eq).trim().toLowerCase()}`] = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1')
  }
  const yes = (k: string, d: boolean): boolean => (k in got ? /^(yes|true|on|1)$/i.test(got[k]) : d)
  const weightingText = got['blending.weighting'] ?? ''
  const custom = /^\[.*\]$/.test(weightingText) ? weightingText.replace(/[[\]]/g, '').split(',').map((x) => Number(x.trim())) : undefined
  return normalizeInterpolini({
    interpolate: yes('interpolation.enabled', true), dedup: yes('dedup.enabled', true), half: yes('interpolation.half size', true),
    engine: got['interpolation.engine'] as InterpoliniSettings['engine'], fps: got['interpolation.fps'], speed: got['interpolation.speed'] as InterpoliniSettings['speed'],
    tuning: got['interpolation.tuning'] as InterpoliniSettings['tuning'], algorithm: got['interpolation.algorithm'] as InterpoliniSettings['algorithm'],
    blendFps: got['blending.fps'] ? Number(got['blending.fps']) : undefined, intensity: got['blending.intensity'] !== undefined ? Number(got['blending.intensity']) : undefined,
    gamma: got['blending.gamma'] !== undefined ? Number(got['blending.gamma']) : undefined,
    weighting: (custom ? 'custom' : weightingText) as InterpoliniSettings['weighting'], ...(custom ? { custom } : {})
  })
}
