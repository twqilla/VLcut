/**
 * Nesting: several clips become one clip, so effects, transitions, speed and position apply to them as a group.
 * The group is rendered into a video (the app's normal export, same quality as the project) that replaces the clips, and the
 * original clips are kept inside the new library item so "Unnest" can put them back. Pure helpers; the rendering is done by the app.
 */
import type { Clip, MediaAsset, Project, Track } from '../types'
import { makeClip, newId } from './model'
import * as ops from './ops'

export interface NestPlan {
  ids: string[]
  t0: number
  duration: number
  /** A project holding only the chosen clips, moved to start at zero, ready to render. */
  sub: Project
  /** Whether the group has any picture clip (a text-only group has no background, so it is blended with Screen). */
  hasPicture: boolean
  /** The track the nested clip goes on: the lowest picture track among the chosen clips, else the lowest chosen track. */
  trackId: string
}

export type NestedParts = NonNullable<MediaAsset['nested']>

/** Works out what nesting the selection would do, or says why it cannot be done. */
export function planNest(project: Project, selection: readonly string[]): { ok: true; plan: NestPlan } | { ok: false; reason: string } {
  const picked: { track: Track; clip: Clip }[] = []
  for (const id of selection) {
    const f = ops.findClip(project, id)
    if (f) picked.push(f)
  }
  if (!picked.length) return { ok: false, reason: 'Select the clips to nest first.' }
  if (picked.some(({ clip }) => project.media.find((m) => m.id === clip.assetId)?.nested)) return { ok: false, reason: 'A nested clip is already in the selection. Unnest it first, or nest other clips.' }
  const t0 = Math.min(...picked.map((p) => p.clip.start))
  const t1 = Math.max(...picked.map((p) => p.clip.start + p.clip.duration))
  if (t1 - t0 < 0.1) return { ok: false, reason: 'The selection is too short to nest.' }
  const trackIds = new Set(picked.map((p) => p.track.id))
  const tracks = project.tracks.filter((t) => trackIds.has(t.id)).map((t) => ({ ...t, clips: t.clips.filter((c) => selection.includes(c.id)).map((c) => ({ ...c, start: c.start - t0, transitionIn: c.transitionIn })) }))
  const usedMedia = new Set(picked.map((p) => p.clip.assetId).filter(Boolean))
  const sub: Project = { ...project, id: newId(), tracks, media: project.media.filter((m) => usedMedia.has(m.id)) }
  const visual = (t: Track): boolean => t.kind === 'video' && t.clips.some((c) => project.media.find((m) => m.id === c.assetId))
  const lowestPicture = [...project.tracks].reverse().find((t) => trackIds.has(t.id) && visual({ ...t, clips: t.clips.filter((c) => selection.includes(c.id)) }))
  const hasPicture = Boolean(lowestPicture)
  const lowest = lowestPicture ?? [...project.tracks].reverse().find((t) => trackIds.has(t.id) && t.kind !== 'audio') ?? picked[0].track
  return { ok: true, plan: { ids: picked.map((p) => p.clip.id), t0, duration: t1 - t0, sub, hasPicture, trackId: lowest.kind === 'audio' ? picked.find((p) => p.track.kind !== 'audio')?.track.id ?? lowest.id : lowest.id } }
}

/** Removes the chosen clips, adds the rendered file to the library and puts it where the group began. */
export function applyNest(project: Project, plan: NestPlan, rendered: MediaAsset): { project: Project; clipId: string } {
  const parts: NestedParts = {
    t0: plan.t0,
    duration: plan.duration,
    tracks: plan.sub.tracks.map((t) => ({ id: t.id, name: t.name, kind: t.kind, clips: t.clips.map((c) => ({ ...c, start: c.start + plan.t0 })) })),
    media: plan.sub.media
  }
  const asset: MediaAsset = { ...rendered, name: 'Nested clip', nested: parts }
  let next = ops.removeClips(project, new Set(plan.ids))
  next = { ...next, media: [...next.media.filter((m) => m.id !== asset.id), asset] }
  const clip: Clip = { ...makeClip({ assetId: asset.id, start: plan.t0, duration: plan.duration }), ...(plan.hasPicture ? {} : { blend: 'screen' as const }) }
  const track = next.tracks.find((t) => t.id === plan.trackId && !t.locked && ops.freeStart(t, clip.start, clip.duration) === clip.start)
  if (track) return { project: ops.addClip(next, track.id, clip), clipId: clip.id }
  const withTrack = ops.addTrack(next, 'video')
  return { project: ops.addClip(withTrack, withTrack.tracks[0].id, clip), clipId: clip.id }
}

/** Puts the original clips back where the nested clip now sits (it may have been moved or trimmed), and removes the nested clip. */
export function unnest(project: Project, clipId: string): { project: Project; ids: string[] } | null {
  const found = ops.findClip(project, clipId)
  const asset = found && project.media.find((m) => m.id === found.clip.assetId)
  if (!found || !asset?.nested) return null
  const { nested } = asset
  const shift = found.clip.start - nested.t0
  let next = ops.removeClips(project, new Set([clipId]))
  const known = new Set(next.media.map((m) => m.id))
  next = { ...next, media: [...next.media, ...nested.media.filter((m) => !known.has(m.id))] }
  const ids: string[] = []
  for (const t of nested.tracks) {
    let target = next.tracks.find((x) => x.id === t.id)
    for (const original of t.clips) {
      const clip = { ...original, start: Math.max(0, original.start + shift) }
      if (!target || target.locked || ops.freeStart(target, clip.start, clip.duration) !== clip.start) {
        next = ops.addTrack(next, t.kind)
        target = next.tracks[t.kind === 'audio' ? next.tracks.length - 1 : 0]
      }
      next = ops.addClip(next, target.id, clip)
      target = next.tracks.find((x) => x.id === target!.id)
      ids.push(clip.id)
    }
  }
  // Drop the nested file from the library when nothing uses it any more.
  const stillUsed = next.tracks.some((t) => t.clips.some((c) => c.assetId === asset.id))
  if (!stillUsed) next = { ...next, media: next.media.filter((m) => m.id !== asset.id) }
  return { project: next, ids }
}
