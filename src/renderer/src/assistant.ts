/** Runs assistant plans against the open project, one undoable history entry per step. */
import { create } from 'zustand'
import type { MediaAsset, Project } from '@shared/types'
import { type AgentContext, type Plan, type PlanStep, extractJson, llmPrompt, planRequest, runStep, validatePlan } from '@shared/agent/planner'
import type { StyleDef } from '@shared/styles/styles'
import { useEditor } from './store'
import { mainTrack } from '@shared/agent/tools'
import type { ExportSettings } from '@shared/types'
import { DEFAULT_INTERPOLINI } from '@shared/render/interpolini'
import { clipStem, singleClipProject, specToSettings, type RenderSpec } from '@shared/agent/batch'
import { projectDuration } from '@shared/timeline/ops'
import { hyperlapseSelection, reframeSelection, stabilizeSelection, useMotion } from './motion'

export interface RanStep {
  step: PlanStep
  summary: string
  changed: boolean
  undone: boolean
}

export interface Exchange {
  id: number
  request: string
  notes: string[]
  steps: RanStep[]
  variants?: Plan['variants']
  /** History length before the first step ran; lets individual steps be undone by replay. */
  baseIndex: number
  plannedBy: 'rules' | 'local model'
}

interface AssistantState {
  exchanges: Exchange[]
  busy: boolean
  customStyles: StyleDef[]
  llm: { available: boolean; model: string | null }
  useLlm: boolean
  /** What a long step (rendering files) is doing right now. */
  progress: string
}

export const useAssistant = create<AssistantState>(() => ({ exchanges: [], busy: false, customStyles: [], llm: { available: false, model: null }, useLlm: false, progress: '' }))

export async function refreshAssistantEnvironment(): Promise<void> {
  const [styles, llm] = await Promise.all([window.api.styles.list(), window.api.llm.status()])
  useAssistant.setState({ customStyles: styles as StyleDef[], llm })
}

/** Makes the named built-in sounds (the core set when none are named) available in the project and returns every built-in sound in it, by id. */
export async function sfxContext(needed: boolean | string[]): Promise<Record<string, MediaAsset>> {
  if (!needed) return {}
  const assets = await window.api.sfx.ensure(Array.isArray(needed) ? needed : undefined)
  const { project, patchMedia } = useEditor.getState()
  const missing = assets.filter((s) => !project!.media.some((m) => m.builtinSfx === s.builtinSfx))
  if (missing.length) patchMedia((media) => [...media, ...missing])
  return Object.fromEntries(useEditor.getState().project!.media.filter((m) => m.builtinSfx).map((m) => [m.builtinSfx!, m]))
}

/** Makes the named built-in overlay clips available in the project and returns every one in it, by id. */
export async function overlayContext(ids: string[]): Promise<Record<string, MediaAsset>> {
  if (!ids.length) return {}
  const assets = await window.api.overlays.ensure(ids)
  const { project, patchMedia } = useEditor.getState()
  const missing = assets.filter((o) => !project!.media.some((m) => m.builtinOverlay === o.builtinOverlay))
  if (missing.length) patchMedia((media) => [...media, ...missing])
  return Object.fromEntries(useEditor.getState().project!.media.filter((m) => m.builtinOverlay).map((m) => [m.builtinOverlay!, m]))
}

async function contextFor(steps: PlanStep[]): Promise<AgentContext> {
  return { selection: useEditor.getState().selection, customStyles: useAssistant.getState().customStyles, sfx: await sfxContext(steps.some((s) => s.tool === 'applyStyle')), overlays: await overlayContext(steps.filter((s) => s.tool === 'addOverlay').map((s) => String(s.args.overlay))) }
}


const baseSettings = (p: Project): ExportSettings => ({ outputPath: '', width: p.settings.width, height: p.settings.height, fps: p.settings.fps, codec: 'h264', crf: 18, audioBitrateKbps: 192, normalizeAudio: false, motionBlur: { mode: 'off', amount: 0.75, samples: 16, weighting: 'gaussian', interpolini: DEFAULT_INTERPOLINI }, pixelScaling: Boolean(p.settings.pixelScaling) })
const specOf = (step: PlanStep): RenderSpec => { try { return JSON.parse(String(step.args.spec || '{}')) as RenderSpec } catch { return {} } }
const folderOf = (path: string): string => path.replace(/[^\\/]*$/, '')
const cleanError = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')

/** Resolves when the export job reaches a final state, reporting progress on the way. */
function waitForJob(id: string, label: string): Promise<{ state: string; message?: string }> {
  return new Promise((resolve) => {
    const off = window.api.exporter.onProgress((p) => {
      if (p.jobId !== id) return
      if (p.state === 'rendering' && p.totalFrames) useAssistant.setState({ progress: `${label} ${Math.round((p.frame / p.totalFrames) * 100)}%` })
      if (p.state === 'done' || p.state === 'error' || p.state === 'cancelled') {
        off()
        resolve(p)
      }
    })
  })
}

/** Renders each clip to its own file next to a file the person chooses, or the whole project to one file. */
async function renderFiles(step: PlanStep, selection: string[]): Promise<string> {
  const project = useEditor.getState().project!
  const spec = specOf(step)
  const base = baseSettings(project)
  if (step.tool === 'exportProject') {
    if (projectDuration(project) <= 0) return 'The timeline is empty, so there is nothing to export.'
    const out = await window.api.exporter.pickPath(`${project.name}.mp4`)
    if (!out) return 'Cancelled: no file was chosen.'
    useAssistant.setState({ progress: 'Exporting…' })
    const id = await window.api.exporter.start(project, { ...specToSettings(spec, project.settings as { width: number; height: number; fps: number }, base), outputPath: out })
    const final = await waitForJob(id, 'Exporting')
    return final.state === 'done' ? `Saved ${out}` : final.state === 'cancelled' ? 'Export cancelled.' : `Export failed: ${final.message ?? 'unknown error'}`
  }
  const picked = step.args.scope === 'selected' && selection.length ? new Set(selection) : null
  const clips = project.tracks.filter((t) => t.kind === 'video' || t.kind === 'audio').flatMap((t) => t.clips).filter((c) => c.assetId && (!picked || picked.has(c.id))).sort((a, b) => a.start - b.start)
  if (!clips.length) return 'There are no clips to render.'
  const first = await window.api.exporter.pickPath('Clips.mp4')
  if (!first) return 'Cancelled: no folder was chosen.'
  const dir = folderOf(first)
  const settings = specToSettings(spec, project.settings as { width: number; height: number; fps: number }, base)
  const done: string[] = []
  const failed: string[] = []
  for (const [i, clip] of clips.entries()) {
    const label = `Clip ${i + 1} of ${clips.length}`
    useAssistant.setState({ progress: `${label}…` })
    const solo = singleClipProject(project, clip.id)
    if (!solo) continue
    const out = `${dir}${clipStem(project, clip, i, clips.length)}.mp4`
    try {
      const id = await window.api.exporter.start(solo, { ...settings, outputPath: out })
      const final = await waitForJob(id, label)
      if (final.state === 'done') done.push(out)
      else if (final.state === 'cancelled') { failed.push('cancelled'); break }
      else failed.push(final.message ?? 'error')
    } catch (err) {
      failed.push(cleanError(err))
    }
  }
  return `Rendered ${done.length} of ${clips.length} clip${clips.length === 1 ? '' : 's'} into ${dir || 'the chosen folder'}.${failed.length ? ` ${failed.length} failed: ${failed[0]}.` : ''}`
}

async function applySteps(steps: PlanStep[], context: AgentContext): Promise<RanStep[]> {
  const ran: RanStep[] = []
  for (const step of steps) {
    let result = { summary: '', changed: false }
    useEditor.getState().apply(step.description.split(':')[0].split('.')[0], (p: Project) => {
      const r = runStep(p, step, context)
      result = r
      return r.project
    }, { source: 'assistant' })
    ran.push({ step, ...result, undone: false })
  }
  // Steps that write files (render each clip, export) run after the edits, one at a time.
  for (const entry of ran) {
    if (entry.step.tool !== 'renderClips' && entry.step.tool !== 'exportProject') continue
    try {
      entry.summary = await renderFiles(entry.step, context.selection ?? [])
    } catch (err) {
      entry.summary = `Failed: ${cleanError(err)}`
    } finally {
      useAssistant.setState({ progress: '' })
    }
  }
  // Steps that analyse the footage (stabilise, reframe, hyperlapse) run last, on the selected clips or the main footage.
  for (const entry of ran) {
    if (entry.step.tool !== 'stabilize' && entry.step.tool !== 'reframe' && entry.step.tool !== 'hyperlapse') continue
    const editor = useEditor.getState()
    const saved = editor.selection
    const main = mainTrack(editor.project!)
    const pool = (saved.length ? editor.project!.tracks.flatMap((t) => t.clips).filter((c) => saved.includes(c.id)) : main?.clips ?? []).filter((c) => c.assetId && editor.project!.media.find((m) => m.id === c.assetId)?.kind === 'video')
    const clips = pool.slice(0, 8)
    if (!clips.length) {
      entry.summary = 'There is no video clip to analyse.'
      continue
    }
    for (const c of clips) {
      useEditor.getState().select([c.id])
      if (entry.step.tool === 'stabilize') await stabilizeSelection()
      else if (entry.step.tool === 'reframe') await reframeSelection()
      else await hyperlapseSelection(Number(entry.step.args.speed) || 10)
    }
    useEditor.getState().select(saved)
    entry.summary = `${useMotion.getState().note || 'Done.'}${clips.length > 1 ? ` (${clips.length} clips)` : ''}`
  }
  return ran
}

/** Plans and carries out a request. A snapshot is written to disk first, so nothing is ever lost. */
export async function ask(request: string): Promise<void> {
  const editor = useEditor.getState()
  if (!editor.project || useAssistant.getState().busy) return
  useAssistant.setState({ busy: true })
  try {
    const { useLlm, llm, customStyles } = useAssistant.getState()
    let plan = planRequest(request, editor.project, { customStyles })
    let plannedBy: Exchange['plannedBy'] = 'rules'
    if (useLlm && llm.available && !plan.variants) {
      try {
        const proposed = validatePlan(extractJson(await window.api.llm.complete(llmPrompt(request, editor.project))), { customStyles })
        if (proposed.length) {
          plan = { steps: proposed, notes: [] }
          plannedBy = 'local model'
        }
      } catch {
        // Fall back to the built-in planner.
      }
    }
    const baseIndex = useEditor.getState().past.length
    let steps: RanStep[] = []
    if (plan.steps.length) {
      await window.api.projects.snapshot(useEditor.getState().project!, `Before ${request}`)
      steps = await applySteps(plan.steps, await contextFor(plan.steps))
    }
    useAssistant.setState((s) => ({ exchanges: [...s.exchanges, { id: Date.now(), request, notes: plan.notes, steps, variants: plan.variants, baseIndex, plannedBy }] }))
  } finally {
    useAssistant.setState({ busy: false })
  }
}

/** True while nothing has been edited since the exchange ran, so its steps can be replayed safely. */
export function canAdjust(exchange: Exchange): boolean {
  const applied = exchange.steps.filter((s) => !s.undone && s.changed).length
  return useEditor.getState().past.length === exchange.baseIndex + applied && useAssistant.getState().exchanges.at(-1)?.id === exchange.id
}

/** Undoes (or restores) one step of an exchange by rewinding to before it and replaying the others. */
export async function toggleStep(exchangeId: number, index: number): Promise<void> {
  const exchange = useAssistant.getState().exchanges.find((e) => e.id === exchangeId)
  if (!exchange || !canAdjust(exchange)) return
  const wanted = exchange.steps.map((s, i) => (i === index ? !s.undone : s.undone))
  useEditor.getState().revertTo(exchange.baseIndex)
  const keep = exchange.steps.filter((_, i) => !wanted[i]).map((s) => s.step)
  const ran = await applySteps(keep, await contextFor(keep))
  let k = 0
  const steps = exchange.steps.map((s, i) => (wanted[i] ? { ...s, undone: true } : { ...ran[k++], undone: false }))
  useAssistant.setState((s) => ({ exchanges: s.exchanges.map((e) => (e.id === exchangeId ? { ...e, steps } : e)) }))
}

/** Runs steps directly (used by the Styles tab and by "apply this version"). */
export async function runSteps(request: string, steps: PlanStep[]): Promise<void> {
  const baseIndex = useEditor.getState().past.length
  await window.api.projects.snapshot(useEditor.getState().project!, `Before ${request}`)
  const ran = await applySteps(steps, await contextFor(steps))
  useAssistant.setState((s) => ({ exchanges: [...s.exchanges, { id: Date.now(), request, notes: [], steps: ran, baseIndex, plannedBy: 'rules' }] }))
}
