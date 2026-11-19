/**
 * Motion-blurred clips. A clip is blurred by pointing it at a blurred copy of the part of the file it uses.
 * Nothing is destroyed: the original stays in the project, and the clip can go straight back to it.
 */
import type { BlurredFrom, Clip, MediaAsset, Project } from '../types'

/** Seconds of footage kept before and after the used part, for transitions and frame blending. */
export const BLUR_MARGIN = 0.5

/** The clip's footage as it is in the *original* file, even if the clip currently shows a blurred copy. */
export function sourceOf(project: Project, clip: Clip): { asset: MediaAsset; sourceIn: number } | null {
  const asset = project.media.find((m) => m.id === clip.assetId)
  if (!asset) return null
  if (!asset.blurredFrom) return { asset, sourceIn: clip.sourceIn }
  const original = project.media.find((m) => m.id === asset.blurredFrom!.assetId)
  return original ? { asset: original, sourceIn: clip.sourceIn + asset.blurredFrom.start } : null
}

/** The stretch of the original file that has to be blurred for a clip, on a frame boundary. */
export function blurRangeFor(original: MediaAsset, sourceIn: number, clip: Pick<Clip, 'duration' | 'speed'>): { start: number; end: number } {
  const fps = original.fps ?? 30
  const used = clip.duration * clip.speed
  const start = Math.floor(Math.max(0, sourceIn - BLUR_MARGIN) * fps + 1e-6) / fps
  const end = Math.min(original.duration, sourceIn + used + BLUR_MARGIN)
  return { start, end: Math.max(end, start + 1 / fps) }
}

/** Points a clip at a blurred copy (adding the copy to the project's media if it is not there yet). */
export function swapInBlurred(project: Project, clipId: string, blurred: MediaAsset): Project {
  const from = blurred.blurredFrom
  if (!from) return project
  const media = project.media.some((m) => m.id === blurred.id) ? project.media : [...project.media, blurred]
  return {
    ...project,
    media,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (c.id !== clipId) return c
        const here = project.media.find((m) => m.id === c.assetId)
        // A clip that already shows a blurred copy is re-pointed from the original.
        const sourceIn = here?.blurredFrom ? c.sourceIn + here.blurredFrom.start : c.sourceIn
        return { ...c, assetId: blurred.id, sourceIn: Math.max(0, sourceIn - from.start) }
      })
    }))
  }
}

/** Sends a blurred clip back to the original footage. */
export function removeBlur(project: Project, clipId: string): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        const here = c.id === clipId ? project.media.find((m) => m.id === c.assetId) : undefined
        if (!here?.blurredFrom || !project.media.some((m) => m.id === here.blurredFrom!.assetId)) return c
        return { ...c, assetId: here.blurredFrom.assetId, sourceIn: c.sourceIn + here.blurredFrom.start }
      })
    }))
  }
}

export const describeBlurred = (from: BlurredFrom): string => `${from.settings.engine.toUpperCase()} · ${from.settings.fps} → ${from.blendFps} fps · intensity ${from.settings.intensity} · ${from.settings.weighting}`
