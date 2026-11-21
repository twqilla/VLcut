/** The part of the timeline between the in and out marks (I and O), as its own project, so exactly that part can be exported. */
import type { Project } from '../types'
import { clipEnd, projectDuration, trimClipEnd, trimClipStart } from './ops'

const EPS = 1e-6

/**
 * A copy of the project holding only what is between `a` and `b` seconds, moved to start at zero. Clips that cross a mark are
 * trimmed (with their speed, keyframes and fades handled the way trimming by hand handles them); clips outside are left out.
 */
export function sliceProject(project: Project, a: number, b: number): Project {
  const end = projectDuration(project)
  const from = Math.max(0, Math.min(a, b))
  const to = Math.min(end, Math.max(a, b))
  if (!(to - from > EPS)) return project
  let next: Project = { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.start < to - EPS && clipEnd(c) > from + EPS) })) }
  for (const track of next.tracks) {
    for (const c of track.clips) {
      if (c.start < from - EPS) next = trimClipStart(next, c.id, from)
      const current = next.tracks.flatMap((t) => t.clips).find((x) => x.id === c.id)
      if (current && clipEnd(current) > to + EPS) next = trimClipEnd(next, c.id, to)
    }
  }
  return { ...next, tracks: next.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, start: Math.max(0, c.start - from) })) })) }
}
