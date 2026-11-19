/**
 * Audio effects. Each one is described once and produces both the FFmpeg filters used by the export
 * and, where possible, the Web Audio nodes used by the live preview, so what you hear matches what you export.
 */
import type { ParamSpec } from './registry'
import { newId } from '../timeline/model'

export interface AudioEffect {
  id: string
  type: string
  enabled: boolean
  params: Record<string, number>
}

/** Web Audio building blocks the preview understands. */
export type PreviewNode =
  | { kind: 'biquad'; type: 'lowshelf' | 'highshelf' | 'peaking' | 'highpass' | 'lowpass' | 'bandpass'; freq: number; q: number; gain: number }
  | { kind: 'compressor'; threshold: number; ratio: number; attack: number; release: number }
  | { kind: 'gain'; gain: number }
  | { kind: 'shaper'; drive: number }
  | { kind: 'taps'; taps: [number, number][] }
  | { kind: 'tremolo'; freq: number; depth: number }
  | { kind: 'matrix'; m: [number, number, number, number] }
  | { kind: 'pitch'; semitones: number }

export interface AudioEffectSpec {
  type: string
  name: string
  group: 'Tone' | 'Space' | 'Dynamics' | 'Character' | 'Voice' | 'Stereo'
  params: ParamSpec[]
  /** False when only the export applies it (the live preview plays the sound unchanged). */
  preview: boolean
  filters: (p: Record<string, number>) => string[]
  nodes: (p: Record<string, number>) => PreviewNode[]
}

const p = (key: string, label: string, min: number, max: number, def: number, step = 0.01): ParamSpec => ({ key, label, min, max, step, default: def })
const n = (v: number): string => (Math.round(v * 10000) / 10000).toString()
const db = (v: number): number => 10 ** (v / 20)

/** Echo taps: `count` repeats, each quieter by `feedback`, scaled by `mix`. */
export function echoTaps(timeMs: number, count: number, feedback: number, mix: number): [number, number][] {
  return Array.from({ length: Math.round(count) }, (_, k): [number, number] => [Math.round(timeMs * (k + 1)), mix * feedback ** k])
}

const REVERB_DELAYS = [29, 43, 67, 97, 131, 173, 229, 307]
export function reverbTaps(size: number, mix: number): [number, number][] {
  return REVERB_DELAYS.map((d, k): [number, number] => [Math.round(d * (0.5 + size * 1.5)), mix * 0.55 * 0.84 ** k])
}

const tapsFilter = (taps: [number, number][]): string[] => (taps.length ? [`aecho=0.9:0.9:${taps.map((t) => t[0]).join('|')}:${taps.map((t) => n(Math.min(1, t[1]))).join('|')}`] : [])

const PRESETS = ['Chipmunk', 'Deep', 'Robot', 'Telephone', 'Megaphone', 'Old radio']
const pitchFilters = (semitones: number): string[] => {
  const f = 2 ** (semitones / 12)
  // Resample to shift pitch, then stretch the time back so the speed does not change.
  return Math.abs(semitones) < 0.01 ? [] : [`asetrate=48000*${n(f)}`, 'aresample=48000', ...(f > 2 ? ['atempo=0.5', `atempo=${n(2 / f)}`] : [`atempo=${n(1 / f)}`])]
}
const voiceDef = (preset: number): { filters: string[]; nodes: PreviewNode[] } => {
  switch (Math.round(preset)) {
    case 0: return { filters: pitchFilters(7), nodes: [{ kind: 'pitch', semitones: 7 }] }
    case 1: return { filters: pitchFilters(-6), nodes: [{ kind: 'pitch', semitones: -6 }] }
    case 2: return { filters: ['tremolo=f=40:d=1', 'aecho=0.8:0.8:12:0.5'], nodes: [{ kind: 'tremolo', freq: 40, depth: 1 }, { kind: 'taps', taps: [[12, 0.5]] }] }
    case 3: return { filters: ['highpass=f=400', 'lowpass=f=3200', 'asoftclip=type=tanh', 'volume=1.4'], nodes: [{ kind: 'biquad', type: 'highpass', freq: 400, q: 0.7, gain: 0 }, { kind: 'biquad', type: 'lowpass', freq: 3200, q: 0.7, gain: 0 }, { kind: 'shaper', drive: 1 }, { kind: 'gain', gain: 1.4 }] }
    case 4: return { filters: ['highpass=f=500', 'lowpass=f=4000', 'volume=3', 'asoftclip=type=tanh', 'volume=0.7'], nodes: [{ kind: 'biquad', type: 'highpass', freq: 500, q: 0.7, gain: 0 }, { kind: 'biquad', type: 'lowpass', freq: 4000, q: 0.7, gain: 0 }, { kind: 'gain', gain: 3 }, { kind: 'shaper', drive: 1 }, { kind: 'gain', gain: 0.7 }] }
    default: return { filters: ['highpass=f=250', 'lowpass=f=5000', 'volume=1.5', 'asoftclip=type=tanh', 'volume=0.8'], nodes: [{ kind: 'biquad', type: 'highpass', freq: 250, q: 0.7, gain: 0 }, { kind: 'biquad', type: 'lowpass', freq: 5000, q: 0.7, gain: 0 }, { kind: 'gain', gain: 1.5 }, { kind: 'shaper', drive: 1 }, { kind: 'gain', gain: 0.8 }] }
  }
}
export const VOICE_PRESETS = PRESETS

const matrixFilter = (m: [number, number, number, number]): string[] => [`pan=stereo|c0=${n(m[0])}*c0+${n(m[1])}*c1|c1=${n(m[2])}*c0+${n(m[3])}*c1`]
const driveGain = (drive: number): number => 1 + drive * 8

export const AUDIO_EFFECTS: AudioEffectSpec[] = [
  { type: 'eq', name: 'Equalizer (3-band)', group: 'Tone', preview: true, params: [p('low', 'Low (dB)', -18, 18, 0, 0.5), p('mid', 'Mid (dB)', -18, 18, 0, 0.5), p('midFreq', 'Mid frequency (Hz)', 200, 8000, 1000, 10), p('high', 'High (dB)', -18, 18, 0, 0.5)],
    filters: (v) => [`bass=g=${n(v.low)}:f=120`, `equalizer=f=${n(v.midFreq)}:t=q:w=1:g=${n(v.mid)}`, `treble=g=${n(v.high)}:f=6000`],
    nodes: (v) => [{ kind: 'biquad', type: 'lowshelf', freq: 120, q: 0.7, gain: v.low }, { kind: 'biquad', type: 'peaking', freq: v.midFreq, q: 1, gain: v.mid }, { kind: 'biquad', type: 'highshelf', freq: 6000, q: 0.7, gain: v.high }] },
  { type: 'bass', name: 'Bass boost', group: 'Tone', preview: true, params: [p('amount', 'Boost (dB)', 0, 18, 8, 0.5)],
    filters: (v) => [`bass=g=${n(v.amount)}:f=100`], nodes: (v) => [{ kind: 'biquad', type: 'lowshelf', freq: 100, q: 0.7, gain: v.amount }] },
  { type: 'echo', name: 'Echo / delay', group: 'Space', preview: true, params: [p('time', 'Time between echoes (ms)', 40, 1000, 300, 5), p('repeats', 'Repeats', 1, 6, 3, 1), p('feedback', 'Fade per repeat', 0.1, 0.95, 0.5), p('mix', 'Level', 0, 1, 0.6)],
    filters: (v) => tapsFilter(echoTaps(v.time, v.repeats, v.feedback, v.mix)), nodes: (v) => [{ kind: 'taps', taps: echoTaps(v.time, v.repeats, v.feedback, v.mix) }] },
  { type: 'reverb', name: 'Reverb', group: 'Space', preview: true, params: [p('size', 'Room size', 0, 1, 0.5), p('mix', 'Amount', 0, 1, 0.5)],
    filters: (v) => tapsFilter(reverbTaps(v.size, v.mix)), nodes: (v) => [{ kind: 'taps', taps: reverbTaps(v.size, v.mix) }] },
  { type: 'compressor', name: 'Compressor', group: 'Dynamics', preview: true, params: [p('threshold', 'Threshold (dB)', -60, 0, -18, 1), p('ratio', 'Ratio', 1, 20, 4, 0.5), p('attack', 'Attack (ms)', 1, 200, 10, 1), p('release', 'Release (ms)', 10, 1000, 200, 5), p('makeup', 'Make-up gain (dB)', 0, 24, 4, 0.5)],
    filters: (v) => [`acompressor=threshold=${n(db(v.threshold))}:ratio=${n(v.ratio)}:attack=${n(v.attack)}:release=${n(v.release)}:makeup=${n(Math.min(64, db(v.makeup)))}`],
    nodes: (v) => [{ kind: 'compressor', threshold: v.threshold, ratio: v.ratio, attack: v.attack / 1000, release: v.release / 1000 }, { kind: 'gain', gain: db(v.makeup) }] },
  { type: 'limiter', name: 'Limiter', group: 'Dynamics', preview: true, params: [p('ceiling', 'Ceiling (dB)', -20, 0, -1, 0.5)],
    filters: (v) => [`alimiter=limit=${n(Math.max(0.0625, db(v.ceiling)))}:level=0`], nodes: (v) => [{ kind: 'compressor', threshold: v.ceiling, ratio: 20, attack: 0.001, release: 0.08 }] },
  { type: 'distortion', name: 'Distortion', group: 'Character', preview: true, params: [p('drive', 'Drive', 0, 1, 0.4)],
    filters: (v) => [`volume=${n(driveGain(v.drive))}`, 'asoftclip=type=tanh', `volume=${n(1 / Math.sqrt(driveGain(v.drive)))}`], nodes: (v) => [{ kind: 'gain', gain: driveGain(v.drive) }, { kind: 'shaper', drive: 1 }, { kind: 'gain', gain: 1 / Math.sqrt(driveGain(v.drive)) }] },
  { type: 'pitch', name: 'Pitch shift', group: 'Voice', preview: true, params: [p('semitones', 'Semitones', -12, 12, 3, 0.5)], filters: (v) => pitchFilters(v.semitones), nodes: (v) => (Math.abs(v.semitones) < 0.01 ? [] : [{ kind: 'pitch', semitones: v.semitones }]) },
  { type: 'voice', name: 'Voice changer', group: 'Voice', preview: true, params: [p('preset', 'Voice (0 chipmunk, 1 deep, 2 robot, 3 telephone, 4 megaphone, 5 old radio)', 0, 5, 2, 1)], filters: (v) => voiceDef(v.preset).filters, nodes: (v) => voiceDef(v.preset).nodes },
  { type: 'width', name: 'Stereo width', group: 'Stereo', preview: true, params: [p('amount', 'Width (0 mono, 1 normal, 3 very wide)', 0, 3, 1.6)],
    filters: (v) => matrixFilter([(1 + v.amount) / 2, (1 - v.amount) / 2, (1 - v.amount) / 2, (1 + v.amount) / 2]), nodes: (v) => [{ kind: 'matrix', m: [(1 + v.amount) / 2, (1 - v.amount) / 2, (1 - v.amount) / 2, (1 + v.amount) / 2] }] },
  { type: 'vocals', name: 'Voice isolate / remove (centre channel)', group: 'Stereo', preview: true, params: [p('mode', 'Mode (0 keep the centre voice, 1 remove it)', 0, 1, 0, 1)],
    filters: (v) => (v.mode >= 0.5 ? matrixFilter([0.5, -0.5, 0.5, -0.5]) : [...matrixFilter([0.5, 0.5, 0.5, 0.5]), 'highpass=f=120', 'lowpass=f=6500']),
    nodes: (v) => (v.mode >= 0.5 ? [{ kind: 'matrix', m: [0.5, -0.5, 0.5, -0.5] }] : [{ kind: 'matrix', m: [0.5, 0.5, 0.5, 0.5] }, { kind: 'biquad', type: 'highpass', freq: 120, q: 0.7, gain: 0 }, { kind: 'biquad', type: 'lowpass', freq: 6500, q: 0.7, gain: 0 }]) },
  { type: 'voiceEnhance', name: 'Voice enhance (no AI)', group: 'Voice', preview: true, params: [p('amount', 'Amount', 0, 1, 0.7)],
    filters: (v) => ['highpass=f=80', `afftdn=nr=${n(4 + v.amount * 10)}:nf=-40`, `equalizer=f=3000:t=q:w=1:g=${n(v.amount * 4)}`, 'acompressor=threshold=0.1:ratio=3:attack=10:release=150:makeup=2'],
    // The preview has the rumble filter, the presence boost and the compressor; the hiss remover (afftdn) is only in the export.
    nodes: (v) => [{ kind: 'biquad', type: 'highpass', freq: 80, q: 0.7, gain: 0 }, { kind: 'biquad', type: 'peaking', freq: 3000, q: 1, gain: v.amount * 4 }, { kind: 'compressor', threshold: -20, ratio: 3, attack: 0.01, release: 0.15 }, { kind: 'gain', gain: 2 }] }
]

export const audioEffectSpec = (type: string): AudioEffectSpec | undefined => AUDIO_EFFECTS.find((e) => e.type === type)

export function makeAudioEffect(type: string, params: Record<string, number> = {}): AudioEffect {
  const spec = audioEffectSpec(type)
  if (!spec) throw new Error(`Unknown audio effect: ${type}`)
  return { id: newId(), type, enabled: true, params: { ...Object.fromEntries(spec.params.map((s) => [s.key, s.default])), ...params } }
}

/** FFmpeg filters for a clip's audio effects, in order. */
export function audioEffectFilters(effects: AudioEffect[] | undefined): string[] {
  return (effects ?? []).filter((e) => e.enabled).flatMap((e) => audioEffectSpec(e.type)?.filters(e.params) ?? [])
}

/** Web Audio nodes for the live preview, in order. */
export function audioPreviewNodes(effects: AudioEffect[] | undefined): PreviewNode[] {
  return (effects ?? []).filter((e) => e.enabled).flatMap((e) => audioEffectSpec(e.type)?.nodes(e.params) ?? [])
}
