/** Blurring clips from the editor: runs interpolini once, then the clip simply uses the blurred copy. */
import { create } from 'zustand'
import type { MediaAsset } from '@shared/types'
import { DEFAULT_INTERPOLINI, type InterpoliniSettings, normalizeInterpolini } from '@shared/render/interpolini'
import { blurRangeFor, removeBlur, sourceOf, swapInBlurred } from '@shared/timeline/blur'
import { useEditor } from './store'

interface BlurState {
  busy: boolean
  /** What interpolini is doing right now, e.g. "frame 12 of 90". */
  text: string
  error: string
  jobId: string | null
}

export const useBlur = create<BlurState>(() => ({ busy: false, text: '', error: '', jobId: null }))

window.api.blur.onProgress((p) => {
  if (p.jobId === useBlur.getState().jobId) useBlur.setState({ text: p.text })
})

const KEY = 'blur-settings'

/** The blur settings used last, so the next clip starts with them. */
export function loadBlurSettings(): InterpoliniSettings {
  try {
    return normalizeInterpolini(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? DEFAULT_INTERPOLINI)
  } catch {
    return DEFAULT_INTERPOLINI
  }
}

export function saveBlurSettings(settings: InterpoliniSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // private window: the settings just are not remembered
  }
}

let stopped = false

export function cancelBlur(): void {
  stopped = true
  const { jobId } = useBlur.getState()
  if (jobId) void window.api.blur.cancel(jobId)
}

/** Makes a blurred copy of part of `original` and returns it as a media asset (not yet in the project). */
async function blurPart(original: MediaAsset, start: number, end: number, settings: InterpoliniSettings, blendFps: number): Promise<MediaAsset> {
  const jobId = crypto.randomUUID()
  useBlur.setState({ jobId, text: 'starting' })
  const { path } = await window.api.blur.render({ jobId, asset: original, start, end, blendFps, settings })
  const known = useEditor.getState().project!.media.find((m) => m.path === path)
  if (known) return known
  const [probed] = await window.api.media.probe([path])
  if (!probed) throw new Error('The blurred copy could not be read.')
  return { ...probed, name: `${original.name.replace(/ · blurred$/, '')} · blurred`, blurredFrom: { assetId: original.id, start, end, settings, blendFps } }
}

async function run(work: () => Promise<void>): Promise<void> {
  if (useBlur.getState().busy) return
  stopped = false
  useBlur.setState({ busy: true, error: '', text: '' })
  try {
    await work()
  } catch (err) {
    const message = (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    useBlur.setState({ error: stopped || message === 'Cancelled.' ? '' : message })
  } finally {
    useBlur.setState({ busy: false, jobId: null, text: '' })
  }
}

/** Blurs every selected video clip. Each clip then uses its blurred copy; the original stays in the project. */
export function blurSelection(settings: InterpoliniSettings): Promise<void> {
  return run(async () => {
    const { project, selection } = useEditor.getState()
    if (!project) return
    const clips = project.tracks.flatMap((t) => t.clips).filter((c) => selection.includes(c.id))
    const targets = clips.flatMap((clip) => {
      const src = sourceOf(project, clip)
      return src && src.asset.kind === 'video' && !src.asset.missing ? [{ clip, ...src }] : []
    })
    if (!targets.length) throw new Error('Select a video clip to blur.')
    for (const [i, { clip, asset, sourceIn }] of targets.entries()) {
      if (stopped) return
      const range = blurRangeFor(asset, sourceIn, clip)
      useBlur.setState({ text: `clip ${i + 1} of ${targets.length}` })
      const copy = await blurPart(asset, range.start, range.end, settings, project.settings.fps)
      useEditor.getState().apply(`Blur ${asset.name}`, (p) => swapInBlurred(p, clip.id, copy))
    }
  })
}

/** Makes a blurred copy of a whole file and adds it to the library, ready to be dragged onto the timeline. */
export function blurFile(assetId: string, settings: InterpoliniSettings): Promise<void> {
  return run(async () => {
    const project = useEditor.getState().project!
    const picked = project.media.find((m) => m.id === assetId)
    const original = picked?.blurredFrom ? project.media.find((m) => m.id === picked.blurredFrom!.assetId) : picked
    if (!original || original.kind !== 'video' || original.missing) throw new Error('Only a video file can be blurred.')
    const copy = await blurPart(original, 0, original.duration, settings, project.settings.fps)
    useEditor.getState().addMedia([copy])
  })
}

export function unblurSelection(): void {
  const { selection, apply } = useEditor.getState()
  apply('Remove motion blur', (p) => selection.reduce((acc, id) => removeBlur(acc, id), p))
}
