/** Split-screen layouts: crops and places clips so each exactly fills its cell of the frame. */
import type { Clip, MediaAsset, Project } from '../types'

export type SplitLayout = 'left-right' | 'top-bottom' | 'grid'

interface Cell {
  /** Centre and size as fractions of the frame. */
  cx: number
  cy: number
  w: number
  h: number
}

export function cellsFor(layout: SplitLayout, count: number): Cell[] {
  if (layout === 'left-right') return Array.from({ length: count }, (_, i) => ({ cx: (i + 0.5) / count, cy: 0.5, w: 1 / count, h: 1 }))
  if (layout === 'top-bottom') return Array.from({ length: count }, (_, i) => ({ cx: 0.5, cy: (i + 0.5) / count, w: 1, h: 1 / count }))
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  return Array.from({ length: count }, (_, i) => ({ cx: ((i % cols) + 0.5) / cols, cy: (Math.floor(i / cols) + 0.5) / rows, w: 1 / cols, h: 1 / rows }))
}

/** Crop and transform that make a source of the given aspect ratio cover one cell. */
export function fitToCell(sourceAspect: number, frameAspect: number, cell: Cell): Pick<Clip, 'crop' | 'transform'> {
  const cellAspect = (cell.w / cell.h) * frameAspect
  const crop = { left: 0, top: 0, right: 0, bottom: 0 }
  if (sourceAspect > cellAspect) crop.left = crop.right = (1 - cellAspect / sourceAspect) / 2
  else crop.top = crop.bottom = (1 - sourceAspect / cellAspect) / 2
  // The cropped picture now has the cell's shape; at scale 1 it is fitted inside the whole frame.
  const fittedWidth = Math.min(1, cellAspect / frameAspect)
  return { crop, transform: { x: cell.cx - 0.5, y: cell.cy - 0.5, scale: cell.w / fittedWidth, rotation: 0 } }
}

/** Arranges the given clips (in track order, top first) into a split screen. */
export function splitScreen(project: Project, clipIds: string[], layout: SplitLayout): Project {
  const assets = new Map<string, MediaAsset>(project.media.map((m) => [m.id, m]))
  const picked = project.tracks.flatMap((t) => t.clips.filter((c) => clipIds.includes(c.id) && c.assetId && assets.get(c.assetId)?.kind !== 'audio'))
  if (picked.length < 2) return project
  const cells = cellsFor(layout, picked.length)
  const frameAspect = project.settings.width / project.settings.height
  const placement = new Map(picked.map((clip, i) => {
    const asset = assets.get(clip.assetId!)
    return [clip.id, fitToCell(asset?.width && asset.height ? asset.width / asset.height : frameAspect, frameAspect, cells[i])]
  }))
  return { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (placement.has(c.id) ? { ...c, ...placement.get(c.id)!, keyframes: { ...c.keyframes, x: undefined, y: undefined, scale: undefined, rotation: undefined } } : c)) })) }
}
