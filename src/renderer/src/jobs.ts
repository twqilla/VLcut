/** Background work the interface reports on: analysis, speech recognition. */
import { create } from 'zustand'
import { markDuplicates } from '@shared/analysis/shots'
import { useEditor } from './store'

interface JobState {
  /** Progress of describing shots with a local vision model, e.g. "3 of 12". */
  describing: string | null
  /** Files being converted to a playable stand-in. */
  proxying: string[]
  analyzing: string[]
  failed: Record<string, string>
}

export const useJobs = create<JobState>(() => ({ describing: null, proxying: [], analyzing: [], failed: {} }))

/** Analyses every file that has not been measured yet. Safe to call repeatedly. */
export function analyzePending(): void {
  const project = useEditor.getState().project
  if (!project) return
  const { analyzing, failed } = useJobs.getState()
  for (const asset of project.media) {
    // Files analysed before snare detection existed are measured again (their transcript is kept).
    const current = asset.analysis && (asset.analysis.snares !== undefined || !(asset.hasAudio || asset.kind === 'audio'))
    if (current || asset.missing || asset.kind === 'image' || asset.builtinSfx || asset.builtinOverlay || analyzing.includes(asset.id) || failed[asset.id]) continue
    useJobs.setState((s) => ({ analyzing: [...s.analyzing, asset.id] }))
    window.api.analysis
      .analyze(asset)
      .then((analysis) => useEditor.getState().patchMedia((media) => markDuplicates(media.map((m) => (m.id === asset.id ? { ...m, analysis } : m)))))
      .catch((err: Error) => useJobs.setState((s) => ({ failed: { ...s.failed, [asset.id]: err.message } })))
      .finally(() => useJobs.setState((s) => ({ analyzing: s.analyzing.filter((id) => id !== asset.id) })))
  }
}

/** Asks the local vision model to describe the middle frame of every shot not yet described. */
export async function describeShots(): Promise<void> {
  if (useJobs.getState().describing) return
  const project = useEditor.getState().project
  if (!project) return
  const todo = project.media.flatMap((asset) => (asset.kind === 'video' && !asset.missing ? (asset.analysis?.shots ?? []).map((shot, index) => ({ asset, shot, index })) : [])).filter((t) => !t.shot.description)
  try {
    for (const [n, { asset, shot, index }] of todo.entries()) {
      useJobs.setState({ describing: `${n + 1} of ${todo.length}` })
      const description = await window.api.vision.describe(asset.path, (shot.start + shot.end) / 2)
      useEditor.getState().patchMedia((media) => media.map((m) => (m.id === asset.id && m.analysis ? { ...m, analysis: { ...m.analysis, shots: m.analysis.shots.map((s, i) => (i === index ? { ...s, description } : s)) } } : m)))
    }
  } finally {
    useJobs.setState({ describing: null })
  }
}

const NATIVE_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1'])

/** Converts files the built-in decoder cannot play (ProRes, HEVC, MPEG-2…) so they preview and export. */
export function proxyPending(): void {
  const project = useEditor.getState().project
  if (!project) return
  for (const asset of project.media) {
    if (asset.kind !== 'video' || asset.missing || asset.proxyPath || NATIVE_CODECS.has(asset.videoCodec ?? '') || useJobs.getState().proxying.includes(asset.id) || useJobs.getState().failed[`proxy-${asset.id}`]) continue
    useJobs.setState((s) => ({ proxying: [...s.proxying, asset.id] }))
    window.api.media
      .proxy(asset)
      .then((proxyPath) => useEditor.getState().patchMedia((media) => media.map((m) => (m.id === asset.id ? { ...m, proxyPath } : m))))
      .catch((err: Error) => useJobs.setState((s) => ({ failed: { ...s.failed, [`proxy-${asset.id}`]: err.message } })))
      .finally(() => useJobs.setState((s) => ({ proxying: s.proxying.filter((id) => id !== asset.id) })))
  }
}

// Start analysing whenever the library changes.
let lastMedia: unknown
useEditor.subscribe((state) => {
  if (state.project?.media !== lastMedia) {
    lastMedia = state.project?.media
    analyzePending()
    proxyPending()
  }
})
