/** Turns raw per-frame measurements into described, scored shots. Pure functions. */
import type { MediaAsset, Project, Shot, TimeRange } from '../types'

export interface FrameStat {
  t: number
  /** Mean luma 0-255, mean saturation 0-~180, mean luma change from previous frame 0-255. */
  yavg: number
  satavg: number
  ydif: number
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
const round = (v: number): number => Math.round(v * 1000) / 1000

function overlap(a: TimeRange, b: TimeRange): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

export function describeShot(shot: Omit<Shot, 'tags' | 'score'>, hasAudio: boolean): Pick<Shot, 'tags' | 'score'> {
  const tags: string[] = []
  tags.push(shot.motion < 0.12 ? 'static' : shot.motion < 0.4 ? 'gentle-motion' : 'fast-motion')
  tags.push(shot.brightness < 0.25 ? 'dark' : shot.brightness > 0.65 ? 'bright' : 'mid-tone')
  tags.push(shot.saturation < 0.15 ? 'muted' : shot.saturation > 0.45 ? 'colorful' : 'natural-color')
  if (hasAudio) tags.push(shot.speech > 0.5 ? 'sound' : 'quiet')
  const length = shot.end - shot.start
  tags.push(length < 1.5 ? 'short' : length > 8 ? 'long' : 'medium-length')

  // Usable shots are well exposed, have some life in them, and last long enough to cut from.
  const exposure = 1 - Math.min(1, Math.abs(shot.brightness - 0.5) / 0.5) ** 2
  const life = shot.motion < 0.03 ? 0.4 : shot.motion > 0.75 ? 0.5 : 1
  const colour = 0.6 + 0.4 * clamp01(shot.saturation / 0.4)
  const duration = clamp01(length / 2)
  return { tags, score: round(exposure * life * colour * (0.5 + 0.5 * duration)) }
}

/** Builds shots from scene-cut times and sampled frame statistics. */
export function buildShots(duration: number, cuts: number[], stats: FrameStat[], hashes: { t: number; hash: string }[], silences: TimeRange[], hasAudio: boolean): Shot[] {
  const edges = [0, ...cuts.filter((c) => c > 0.2 && c < duration - 0.2).sort((a, b) => a - b), duration]
  const shots: Shot[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    const [start, end] = [edges[i], edges[i + 1]]
    if (end - start < 0.1) continue
    // Skip the first sample after a cut: its frame difference measures the cut, not the motion.
    const inside = stats.filter((s) => s.t >= start && s.t < end)
    const moving = inside.length > 1 ? inside.slice(1) : inside
    const avg = (list: FrameStat[], key: keyof FrameStat): number => (list.length ? list.reduce((a, s) => a + s[key], 0) / list.length : 0)
    const mid = (start + end) / 2
    const hash = hashes.length ? hashes.reduce((a, b) => (Math.abs(b.t - mid) < Math.abs(a.t - mid) ? b : a)).hash : ''
    const silent = silences.reduce((a, s) => a + overlap(s, { start, end }), 0)
    const base = {
      start: round(start),
      end: round(end),
      motion: round(clamp01(avg(moving, 'ydif') / 24)),
      brightness: round(clamp01(avg(inside, 'yavg') / 255)),
      saturation: round(clamp01(avg(inside, 'satavg') / 120)),
      speech: hasAudio ? round(clamp01(1 - silent / (end - start))) : 0,
      hash
    }
    shots.push({ ...base, ...describeShot(base, hasAudio) })
  }
  return shots
}

/** 64-bit difference hash from a 9x8 greyscale thumbnail. */
export function dHash(gray: Uint8Array): string {
  let out = ''
  for (let y = 0; y < 8; y++) {
    let byte = 0
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0)
    out += byte.toString(16).padStart(2, '0')
  }
  return out
}

export function hashDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

/** Marks shots that look the same as an earlier shot anywhere in the project. */
export function markDuplicates(media: MediaAsset[], threshold = 5): MediaAsset[] {
  const seen: { assetId: string; shot: number; hash: string }[] = []
  return media.map((asset) => {
    if (!asset.analysis) return asset
    const shots = asset.analysis.shots.map((shot, index) => {
      // A flat hash (all zero) carries no information; black frames would all "match".
      const match = /^0+$/.test(shot.hash) ? undefined : seen.find((s) => hashDistance(s.hash, shot.hash) <= threshold)
      seen.push({ assetId: asset.id, shot: index, hash: shot.hash })
      const { duplicateOf: _old, ...rest } = shot
      return match ? { ...rest, duplicateOf: { assetId: match.assetId, shot: match.shot } } : rest
    })
    return { ...asset, analysis: { ...asset.analysis, shots } }
  })
}

export interface RankedShot {
  asset: MediaAsset
  shot: Shot
  index: number
}

/** The project's shots, best first, skipping duplicates. */
export function bestShots(project: Project): RankedShot[] {
  return project.media
    .flatMap((asset) => (asset.kind === 'video' && !asset.missing ? (asset.analysis?.shots ?? []).map((shot, index) => ({ asset, shot, index })) : []))
    .filter((r) => !r.shot.duplicateOf)
    .sort((a, b) => b.shot.score - a.shot.score)
}
