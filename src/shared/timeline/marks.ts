/** Beat and snare positions on the timeline, taken from the project's music. Depends only on types. */
import type { Clip, MediaAsset, Project } from '../types'

const EPS = 1e-4

/** Maps a time in the source file to the timeline, or null if the clip does not show it. */
export function toTimeline(clip: Clip, sourceT: number): number | null {
  const local = clip.reversed ? clip.duration - (sourceT - clip.sourceIn) / clip.speed : (sourceT - clip.sourceIn) / clip.speed
  return local < -EPS || local > clip.duration + EPS ? null : clip.start + Math.max(0, Math.min(clip.duration, local))
}

export interface MusicMarks {
  /** Beat times on the timeline, in order. */
  beats: number[]
  /** Snare hit times on the timeline, in order. */
  snares: number[]
}

const sortedUnique = (list: (number | null)[]): number[] => (list.filter((t): t is number => t !== null) as number[]).sort((a, b) => a - b)

/** Marks from the music clip (an audio-track clip that is not a built-in sound effect) with the most detected beats and snares. */
export function musicMarks(project: Project): MusicMarks {
  const assets = new Map<string, MediaAsset>(project.media.map((m) => [m.id, m]))
  let best: { clip: Clip; asset: MediaAsset; score: number } | undefined
  for (const track of project.tracks) {
    if (track.kind !== 'audio' || track.muted) continue
    for (const clip of track.clips) {
      const asset = clip.assetId ? assets.get(clip.assetId) : undefined
      if (!asset || asset.builtinSfx || clip.muted || !asset.analysis) continue
      const score = asset.analysis.beats.length + (asset.analysis.snares?.length ?? 0)
      if (score > (best?.score ?? 0)) best = { clip, asset, score }
    }
  }
  if (!best) return { beats: [], snares: [] }
  const { clip, asset } = best
  return {
    beats: sortedUnique(asset.analysis!.beats.map((b) => toTimeline(clip, b))),
    snares: sortedUnique((asset.analysis!.snares ?? []).map((s) => toTimeline(clip, s)))
  }
}
