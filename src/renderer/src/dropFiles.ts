/** Dropping files from the computer onto the window: they go into the library, and onto the timeline when dropped there. */
import { create } from 'zustand'
import { useEffect } from 'react'
import type { MediaAsset } from '@shared/types'
import { useEditor } from './store'
import { player } from './engine/player'
import { dropTargetAt } from './components/Timeline'
import { clearGhost, useGhost } from './dragGhost'

export const useDrop = create<{ over: boolean; note: string }>(() => ({ over: false, note: '' }))

const hasFiles = (e: DragEvent): boolean => Boolean(e.dataTransfer?.types.includes('Files'))
let noteTimer = 0
const say = (note: string): void => {
  useDrop.setState({ note })
  window.clearTimeout(noteTimer)
  noteTimer = window.setTimeout(() => useDrop.setState({ note: '' }), 7000)
}

/** Where on the timeline a drop landed, as a track and a time (null when it was not over the timeline). */
function timelineSpot(at: { x: number; y: number }): { trackId?: string; time: number } | null {
  const lane = dropTargetAt(at)
  if (lane) return lane
  const over = document.elementsFromPoint(at.x, at.y).some((el) => el instanceof HTMLElement && (el.closest('.timeline') || el.closest('.preview-wrap')))
  return over ? { time: player.time } : null
}

/** Imports the files at `paths` (folders included), reports what could not be read, and places them on the timeline when asked to. */
export async function importDropped(paths: string[], spot: { trackId?: string; time: number } | null): Promise<MediaAsset[]> {
  if (!paths.length) return []
  say(`Importing ${paths.length} item${paths.length === 1 ? '' : 's'}…`)
  const assets = await window.api.media.probe(paths)
  const errors = await window.api.media.takeErrors()
  const editor = useEditor.getState()
  const known = new Set(editor.project?.media.map((m) => m.path))
  const fresh = assets.filter((a) => !known.has(a.path))
  editor.addMedia(assets)
  if (spot) {
    // Several files go one after another from the drop point.
    let at = spot.time
    for (const a of assets.filter((x) => !x.missing)) {
      // A file already in the library keeps its first id, so find the library's copy by path.
      const inLibrary = useEditor.getState().project?.media.find((m) => m.path === a.path)
      if (!inLibrary) continue
      useEditor.getState().insertAsset(inLibrary.id, spot.trackId, at)
      at += a.duration > 0 ? a.duration : 5
    }
  }
  const parts: string[] = []
  if (assets.length) parts.push(`${assets.length} file${assets.length === 1 ? '' : 's'} ${spot ? 'added to the timeline' : 'added to the library'}${fresh.length < assets.length ? ` (${assets.length - fresh.length} already in the library)` : ''}`)
  if (errors.length) parts.push(`${errors.length} could not be read as media (${errors[0].name})`)
  say(parts.join('. ') + '.' || 'Nothing could be imported.')
  return assets
}

/** Installs the window-wide handlers. Without them a dropped file would make the window navigate to it. */
export function useFileDrop(mode: 'project' | 'home'): void {
  useEffect(() => {
    let depth = 0
    const enter = (e: DragEvent): void => { if (hasFiles(e)) { depth++; useDrop.setState({ over: true }) } }
    const over = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      // Show where the first file would land: a faint clip on the lane under the pointer.
      const lane = mode === 'project' ? dropTargetAt({ x: e.clientX, y: e.clientY }) : null
      if (lane) useGhost.setState({ trackId: lane.trackId, time: lane.time, duration: 5, label: 'New clip' })
      else clearGhost()
    }
    const leave = (e: DragEvent): void => { if (hasFiles(e) && --depth <= 0) { depth = 0; useDrop.setState({ over: false }); clearGhost() } }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      useDrop.setState({ over: false })
      clearGhost()
      const paths = Array.from(e.dataTransfer?.files ?? []).map((f) => window.api.media.pathForFile(f)).filter(Boolean)
      if (mode === 'home') {
        // On the start screen the first file becomes a new project, and the others go into its library.
        if (paths.length) void useEditor.getState().editFile(paths[0], null).then(() => importDropped(paths.slice(1), null)).catch((err: Error) => say(`Could not open that file: ${err.message}`))
        return
      }
      void importDropped(paths, timelineSpot({ x: e.clientX, y: e.clientY })).catch((err: Error) => say(`Could not import: ${err.message}`))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => { for (const [n, f] of [['dragenter', enter], ['dragover', over], ['dragleave', leave], ['drop', drop]] as const) window.removeEventListener(n, f as EventListener) }
  }, [mode])
}
