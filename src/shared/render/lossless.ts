/**
 * Decides whether a timeline can be exported without re-encoding (stream copy),
 * the way dedicated lossless cutters work: only straight cuts of matching files.
 */
import type { Clip, Project } from '../types'
import { clipEnd } from '../timeline/ops'

export interface LosslessSegment {
  path: string
  /** Seconds into the source file. */
  start: number
  duration: number
}

export type LosslessPlan = { ok: true; segments: LosslessSegment[]; /** Every clip has its sound removed, so the copy has no audio. */ dropAudio: boolean } | { ok: false; reason: string }

function untouched(clip: Clip): string | null {
  if (clip.speed !== 1 || clip.reversed || clip.freeze) return 'a clip has a speed change, is reversed or is a freeze frame'
  if (clip.effects.some((e) => e.enabled)) return 'a clip has effects'
  if (clip.transitionIn) return 'a clip has a transition'
  if (clip.mask) return 'a clip has a mask'
  if (clip.fadeIn > 0 || clip.fadeOut > 0) return 'a clip has a fade'
  if (Object.values(clip.keyframes).some((k) => k?.length)) return 'a clip has keyframes'
  if (clip.opacity !== 1 || clip.volume !== 1 || clip.denoise) return 'a clip has changed opacity, volume or noise reduction'
  const { x, y, scale, rotation } = clip.transform
  if (x !== 0 || y !== 0 || scale !== 1 || rotation !== 0) return 'a clip is moved, resized or rotated'
  if (Object.values(clip.crop).some((v) => v !== 0)) return 'a clip is cropped'
  return null
}

export function losslessPlan(project: Project): LosslessPlan {
  const no = (reason: string): LosslessPlan => ({ ok: false, reason })
  const used = project.tracks.filter((t) => t.clips.length > 0 && !(t.kind !== 'audio' && t.hidden))
  if (!used.length) return no('the timeline is empty')
  if (used.length > 1) return no('more than one track has clips (text, effects layers, music or overlays need re-encoding)')
  const track = used[0]
  if (track.kind !== 'video') return no('the clips are not on a video track')
  if (track.muted) return no('the track is muted')
  const clips = [...track.clips].sort((a, b) => a.start - b.start)
  const assets = new Map(project.media.map((m) => [m.id, m]))
  const muted = clips.filter((c) => c.muted).length
  if (muted > 0 && muted < clips.length) return no('some clips have their audio removed and others do not')
  const segments: LosslessSegment[] = []
  let cursor = 0
  let first: { videoCodec?: string; audioCodec?: string; width?: number; height?: number; fps?: number } | undefined
  for (const clip of clips) {
    const asset = clip.assetId ? assets.get(clip.assetId) : undefined
    if (!asset || asset.kind !== 'video') return no('only video clips can be copied without re-encoding')
    if (asset.missing) return no(`${asset.name} is missing`)
    const changed = untouched(clip)
    if (changed) return no(changed)
    if (Math.abs(clip.start - cursor) > 1e-3) return no('there are gaps between clips')
    first ??= asset
    if (asset.videoCodec !== first.videoCodec || asset.audioCodec !== first.audioCodec || asset.width !== first.width || asset.height !== first.height || asset.fps !== first.fps) {
      return no('the clips come from files with different formats')
    }
    segments.push({ path: asset.path, start: clip.sourceIn, duration: clip.duration })
    cursor = clipEnd(clip)
  }
  return { ok: true, segments, dropAudio: muted > 0 }
}
