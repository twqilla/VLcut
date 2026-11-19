/** Multicam: line up clips from several cameras by sound, then cut between the angles. */
import type { Clip, Project } from '../types'
import { clipEnd, findClip, sourceTime } from './ops'
import { makeTrack, newId } from './model'

/**
 * Moves `others` so that the same real-world moment lines up with `reference` on the timeline.
 * `lag` is `syncOffset(referenceAudio, otherAudio).lag`: an event at x in the reference's file is at x − lag in the other's.
 */
export function alignBySync(project: Project, referenceId: string, others: { id: string; lag: number }[]): Project {
  const ref = findClip(project, referenceId)?.clip
  if (!ref) return project
  const moves = new Map<string, number>()
  for (const { id, lag } of others) {
    const c = findClip(project, id)?.clip
    if (!c || c.speed !== 1 || ref.speed !== 1) continue
    // Timeline time of source time sa in the reference is start_r + (sa − in_r); the matching source time in the other is sa − lag.
    moves.set(id, ref.start - ref.sourceIn + lag + c.sourceIn)
  }
  // A camera that started recording earlier would land before time zero: shift the whole group later instead.
  const shift = Math.max(0, -Math.min(0, ...moves.values()))
  if (shift > 0) moves.set(referenceId, ref.start)
  for (const [id, start] of moves) moves.set(id, start + shift)
  return { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (moves.has(c.id) ? { ...c, start: moves.get(c.id)! } : c)) })) }
}

export interface MulticamResult {
  project: Project
  pieces: number
  /** Seconds covered (the time all the angles overlap). */
  length: number
}

/**
 * Builds a new "Multicam" track that shows the angles in turn, `segment` seconds each, over the time they all overlap.
 * Each piece shows exactly the same footage the angle shows at that moment. Sound stays with the first angle; the others are muted.
 */
export function multicamCut(project: Project, angleIds: string[], segment: number): MulticamResult {
  const angles = angleIds.map((id) => findClip(project, id)?.clip).filter((c): c is Clip => Boolean(c) && !c!.text && !c!.freeze)
  if (angles.length < 2 || segment < 0.25) return { project, pieces: 0, length: 0 }
  const from = Math.max(...angles.map((c) => c.start))
  const to = Math.min(...angles.map(clipEnd))
  if (to - from < 0.25) return { project, pieces: 0, length: 0 }
  const pieces: Clip[] = []
  let angle = 0
  for (let t = from; t < to - 1e-6; t += segment) {
    const d = Math.min(segment, to - t)
    // A last sliver shorter than a quarter second joins the previous piece instead.
    if (d < 0.25 && pieces.length) {
      pieces[pieces.length - 1] = { ...pieces[pieces.length - 1], duration: pieces[pieces.length - 1].duration + d }
      break
    }
    const src = angles[angle++ % angles.length]
    pieces.push({ ...src, id: newId(), start: t, duration: d, sourceIn: sourceTime(src, t) - (src.reversed ? d * src.speed : 0), muted: true, fadeIn: 0, fadeOut: 0, transitionIn: undefined, keyframes: {}, effects: src.effects.map((e) => ({ ...e, id: newId() })), origin: undefined })
  }
  const track = { ...makeTrack('video', 'Multicam'), clips: pieces }
  const angleSet = new Set(angleIds)
  const tracks = project.tracks.map((t, i) => {
    const hasAngle = t.clips.some((c) => angleSet.has(c.id))
    if (!hasAngle) return t
    const first = angles[0]
    const keepsSound = t.clips.some((c) => c.id === first.id)
    return { ...t, hidden: true, muted: keepsSound ? t.muted : true }
    void i
  })
  const topVideo = tracks.findIndex((t) => t.kind === 'video')
  tracks.splice(Math.max(0, topVideo), 0, track)
  return { project: { ...project, tracks }, pieces: pieces.length, length: to - from }
}
