/** Nesting from the app: render the selected clips into one video, replace them with it, and put them back on request. */
import { create } from 'zustand'
import type { ExportSettings } from '@shared/types'
import { DEFAULT_INTERPOLINI } from '@shared/render/interpolini'
import { applyNest, planNest, unnest } from '@shared/timeline/nest'
import { useEditor } from './store'

export const useNest = create<{ busy: boolean; note: string }>(() => ({ busy: false, note: '' }))

const clean = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function waitForJob(id: string): Promise<{ state: string; message?: string }> {
  return new Promise((resolve) => {
    const off = window.api.exporter.onProgress((p) => {
      if (p.jobId !== id) return
      if (p.state === 'rendering' && p.totalFrames) useNest.setState({ note: `Nesting… ${Math.round((p.frame / p.totalFrames) * 100)}%` })
      if (p.state === 'done' || p.state === 'error' || p.state === 'cancelled') { off(); resolve(p) }
    })
  })
}

export async function nestSelection(): Promise<void> {
  if (useNest.getState().busy) return
  const editor = useEditor.getState()
  const planned = planNest(editor.project!, editor.selection)
  if (!planned.ok) return void useNest.setState({ note: planned.reason })
  const { plan } = planned
  useNest.setState({ busy: true, note: 'Nesting…' })
  try {
    const project = editor.project!
    const out = await window.api.nest.path()
    const settings: ExportSettings = { outputPath: out, width: project.settings.width, height: project.settings.height, fps: project.settings.fps, codec: 'h264', crf: 16, audioBitrateKbps: 192, normalizeAudio: false, motionBlur: { mode: 'off', amount: 0.75, samples: 16, weighting: 'gaussian', interpolini: DEFAULT_INTERPOLINI }, pixelScaling: Boolean(project.settings.pixelScaling) }
    const id = await window.api.exporter.start(plan.sub, settings)
    const final = await waitForJob(id)
    if (final.state !== 'done') return void useNest.setState({ note: final.state === 'cancelled' ? 'Nesting cancelled.' : `Nesting failed: ${final.message ?? 'unknown error'}` })
    const [asset] = await window.api.media.probe([out])
    let clipId = ''
    useEditor.getState().apply('Nest clips', (p) => { const r = applyNest(p, plan, asset); clipId = r.clipId; return r.project })
    useEditor.getState().select([clipId])
    useNest.setState({ note: `Nested ${plan.ids.length} clip${plan.ids.length === 1 ? '' : 's'} into one. Effects, transitions and speed now apply to the whole group. Use Unnest to get the original clips back.` })
  } catch (e) {
    useNest.setState({ note: clean(e) })
  } finally {
    useNest.setState({ busy: false })
  }
}

export function unnestSelection(): void {
  const { project, selection, apply, select } = useEditor.getState()
  const id = selection.length === 1 ? selection[0] : ''
  let ids: string[] = []
  const ok = id && project && unnest(project, id)
  if (!ok) return void useNest.setState({ note: 'Select one nested clip to unnest.' })
  apply('Unnest clips', (p) => { const r = unnest(p, id); ids = r?.ids ?? []; return r?.project ?? p })
  select(ids)
  useNest.setState({ note: 'The original clips are back. Changes made to the nested clip (effects, speed) are not carried over.' })
}

/** True when exactly one clip is selected and it is a nested clip. */
export const canUnnest = (): boolean => {
  const { project, selection } = useEditor.getState()
  const found = selection.length === 1 && project ? project.tracks.flatMap((t) => t.clips).find((c) => c.id === selection[0]) : undefined
  return Boolean(found && project!.media.find((m) => m.id === found.assetId)?.nested)
}
