import { create } from 'zustand'
import type { Clip, MediaAsset, Project, SentClip } from '@shared/types'
import { newId } from '@shared/timeline/model'
import * as ops from '@shared/timeline/ops'
import { clipFromAsset, trackKindFor } from '@shared/timeline/model'
import { makeEffect } from '@shared/effects/registry'
import * as tools from '@shared/agent/tools'
import { player } from './engine/player'

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error'

export interface HistoryEntry {
  /** What the edit did, shown in the History panel. */
  label: string
  /** The project as it was *before* this edit. */
  before: Project
  source: 'user' | 'assistant'
  at: number
  /** Edits sharing a key (one drag, one slider move) collapse into a single entry. */
  coalesce?: string
}

interface EditOptions {
  coalesce?: string
  source?: 'user' | 'assistant'
}

interface EditorState {
  project: Project | null
  selectedAssetId: string | null
  selection: string[]
  past: HistoryEntry[]
  future: HistoryEntry[]
  clipboard: ops.ClipboardEntry[]
  saveState: SaveState
  /** Timeline zoom, pixels per second. */
  zoom: number
  snapping: boolean
  /** Also snap clips and the playhead to the music's beats and snare hits. */
  snapMarks: { beats: boolean; snares: boolean }
  /** New clips from video files are added without their own sound. */
  autoMute: boolean

  openProject(id: string): Promise<void>
  closeProject(): Promise<void>
  /** Opens a file straight on a timeline (a new project, or an existing one), optionally only the part between `from` and `to`. */
  editFile(path: string, projectId: string | null, from?: number, to?: number): Promise<void>
  save(): Promise<void>
  /** Applies an edit and records it for undo. Every change to the project goes through here. */
  apply(label: string, change: (p: Project) => Project, options?: EditOptions): void
  undo(): void
  redo(): void
  /** Rewinds to just before history entry `index`. */
  revertTo(index: number): void
  /** Undoes a single past entry's worth of work by restoring its "before" state only if it is the latest. */
  select(ids: string[], additive?: boolean): void
  selectAsset(id: string | null): void
  setZoom(zoom: number): void
  toggleSnapping(): void
  toggleSnapMark(kind: 'beats' | 'snares'): void
  setAutoMute(on: boolean): void
  /** Removes the sound from the selected clips (or every video clip when none is selected). */
  removeAudio(): void
  /** Brings back the sound of the selected clips (every clip when none is selected). */
  restoreAudio(): void

  addMedia(assets: MediaAsset[]): void
  /** Updates media records without creating an undo step (analysis results, transcripts). */
  patchMedia(change: (media: MediaAsset[]) => MediaAsset[]): void
  /** Places part of a file (e.g. one shot) at the end of the main track. */
  insertRange(assetId: string, start: number, end: number): void
  removeMedia(id: string): void
  /** Points a missing file at its new location, keeping every clip that uses it. */
  relinkMedia(id: string): Promise<boolean>
  /** Puts an asset on the timeline at `time` (default: end of the first suitable track). */
  insertAsset(assetId: string, trackId?: string, time?: number): void
  splitAtPlayhead(): void
  deleteSelection(): void
  duplicateSelection(): void
  copySelection(): void
  paste(): void
  /** Split view: opens this project's clip-prep workspace beside it. */
  openSplit(): Promise<void>
  /** In the clip-prep window: sends the selected clips to the main project. */
  /** `at` (a point in this window, possibly outside it) drops the clips there in the other window instead. */
  sendSelection(at?: { x: number; y: number }): Promise<number>
  /** In the main window: places clips arriving from the clip-prep window at the playhead. */
  /** `target` places them on a given track and time (a drop); otherwise they go to the playhead. */
  receiveClips(items: SentClip[], target?: { trackId: string; time: number }): void
  addEffect(type: string): void
  /** Adds a combination of effects on top of whatever the selected clips already have. */
  addEffectStack(name: string, effects: { type: string; params: Record<string, number> }[]): void
  setTransition(type: string): void
  updateSelected(label: string, patch: (clip: Clip) => Partial<Clip>, coalesce?: string): void
}

const AUTOSAVE_DELAY_MS = 1500
const COALESCE_WINDOW_MS = 1200
const MAX_HISTORY = 300
let autosaveTimer: ReturnType<typeof setTimeout> | undefined

export const useEditor = create<EditorState>((set, get) => {
  const touch = (): void => {
    set({ saveState: 'unsaved' })
    clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => void get().save(), AUTOSAVE_DELAY_MS)
    player.invalidate()
  }

  const restore = (project: Project): void => {
    const ids = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id)))
    set({ project, selection: get().selection.filter((id) => ids.has(id)) })
    touch()
  }

  return {
    project: null,
    selectedAssetId: null,
    selection: [],
    past: [],
    future: [],
    clipboard: [],
    saveState: 'saved',
    zoom: 80,
    snapping: true,
    snapMarks: { beats: true, snares: true },
    autoMute: (() => { try { return localStorage.getItem('auto-mute') === '1' } catch { return false } })(),

    async openProject(id) {
      const loaded = await window.api.projects.load(id)
      set({ project: loaded, selectedAssetId: null, selection: [], past: [], future: [], saveState: 'saved' })
      void window.api.session.open({ id: loaded.id, name: loaded.name })
      player.seek(0)
    },

    async editFile(path, projectId, from, to) {
      const [probed] = await window.api.media.probe([path])
      if (!probed) throw new Error('This file could not be read as video.')
      const id = projectId ?? (await window.api.projects.create(probed.name.replace(/\.[^.]+$/, ''))).id
      await get().openProject(id)
      if (!projectId && probed.width && probed.height) {
        // A new project takes the clip's own size and frame rate.
        const settings = { width: Math.round(probed.width / 2) * 2, height: Math.round(probed.height / 2) * 2, fps: Math.round(probed.fps ?? 30) }
        set({ project: { ...get().project!, settings } })
      }
      get().addMedia([probed])
      const asset = get().project!.media.find((m) => m.path === path)!
      if (from !== undefined && to !== undefined && to > from) get().insertRange(asset.id, from, to)
      else get().insertAsset(asset.id)
      set({ past: [], future: [] })
      player.seek(0)
    },

    async closeProject() {
      clearTimeout(autosaveTimer)
      player.pause()
      if (get().saveState !== 'saved') await get().save()
      set({ project: null, selectedAssetId: null, selection: [], past: [], future: [] })
      void window.api.session.open(null)
      player.invalidate()
    },

    async save() {
      const { project } = get()
      if (!project) return
      clearTimeout(autosaveTimer)
      set({ saveState: 'saving' })
      try {
        const saved = await window.api.projects.save(project)
        // Keep any edits made while the save was in flight.
        if (get().project === project) set({ project: { ...project, updatedAt: saved.updatedAt }, saveState: 'saved' })
        else set({ saveState: 'unsaved' })
      } catch {
        set({ saveState: 'error' })
      }
    },

    apply(label, change, options = {}) {
      const { project, past } = get()
      if (!project) return
      const next = change(project)
      if (next === project) return
      const last = past[past.length - 1]
      const now = Date.now()
      const merge = options.coalesce !== undefined && last?.coalesce === options.coalesce && now - last.at < COALESCE_WINDOW_MS
      const entry: HistoryEntry = { label, before: project, source: options.source ?? 'user', at: now, coalesce: options.coalesce }
      set({
        project: next,
        past: merge ? [...past.slice(0, -1), { ...last, at: now }] : [...past, entry].slice(-MAX_HISTORY),
        future: []
      })
      touch()
    },

    undo() {
      const { past, future, project } = get()
      const entry = past[past.length - 1]
      if (!entry || !project) return
      set({ past: past.slice(0, -1), future: [...future, { ...entry, before: project }] })
      restore(entry.before)
    },

    redo() {
      const { past, future, project } = get()
      const entry = future[future.length - 1]
      if (!entry || !project) return
      set({ future: future.slice(0, -1), past: [...past, { ...entry, before: project }] })
      restore(entry.before)
    },

    revertTo(index) {
      while (get().past.length > index) get().undo()
    },

    select(ids, additive = false) {
      const current = get().selection
      if (!additive) return set({ selection: ids, selectedAssetId: null })
      const toggled = ids.every((id) => current.includes(id)) ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]
      set({ selection: toggled, selectedAssetId: null })
    },

    selectAsset(id) {
      set({ selectedAssetId: id, selection: [] })
    },

    setZoom(zoom) {
      set({ zoom: Math.max(4, Math.min(800, zoom)) })
    },

    toggleSnapMark(kind) {
      set({ snapMarks: { ...get().snapMarks, [kind]: !get().snapMarks[kind] } })
    },

    setAutoMute(on) {
      try { localStorage.setItem('auto-mute', on ? '1' : '0') } catch { /* private window */ }
      set({ autoMute: on })
    },

    removeAudio() {
      const selected = new Set(get().selection)
      get().apply('Remove audio from clips', (p) => tools.removeClipAudio(p, selected.size ? selected : undefined).project)
    },

    restoreAudio() {
      const selected = new Set(get().selection)
      get().apply('Restore audio on clips', (p) => ({
        ...p,
        tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ((!selected.size || selected.has(c.id)) && c.muted && !c.freeze && !c.stab && p.media.find((m) => m.id === c.assetId)?.hasAudio ? { ...c, muted: false } : c)) }))
      }))
    },

    toggleSnapping() {
      set({ snapping: !get().snapping })
    },

    addMedia(assets) {
      get().apply(`Import ${assets.length} file${assets.length === 1 ? '' : 's'}`, (p) => {
        const known = new Set(p.media.map((m) => m.path))
        const fresh = assets.filter((a) => !known.has(a.path))
        return fresh.length ? { ...p, media: [...p.media, ...fresh] } : p
      })
    },

    patchMedia(change) {
      const { project } = get()
      if (!project) return
      set({ project: { ...project, media: change(project.media) } })
      touch()
    },

    insertRange(assetId, start, end) {
      const project = get().project
      const asset = project?.media.find((m) => m.id === assetId)
      const track = project && [...project.tracks].reverse().find((t) => t.kind === trackKindFor(asset!) && !t.locked && t.name !== 'Look' && t.name !== 'Style SFX')
      if (!project || !asset || !track) return
      const clip = { ...clipFromAsset(asset, Math.max(0, ...track.clips.map(ops.clipEnd))), sourceIn: start, duration: Math.max(0.1, end - start), muted: get().autoMute && asset.kind === 'video' && asset.hasAudio ? true : undefined }
      get().apply(`Add shot from ${asset.name}`, (p) => ops.addClip(p, track.id, clip))
      set({ selection: [clip.id], selectedAssetId: null })
    },

    removeMedia(id) {
      get().apply('Remove media', (p) => {
        const used = new Set(p.tracks.flatMap((t) => t.clips.filter((c) => c.assetId === id).map((c) => c.id)))
        return { ...ops.removeClips(p, used), media: p.media.filter((m) => m.id !== id) }
      })
      if (get().selectedAssetId === id) set({ selectedAssetId: null })
    },

    async relinkMedia(id) {
      const [found] = await window.api.media.pick()
      if (!found) return false
      get().patchMedia((media) => media.map((m) => (m.id === id ? { ...found, id, analysis: m.analysis, builtinSfx: m.builtinSfx } : m)))
      return true
    },

    insertAsset(assetId, trackId, time) {
      const project = get().project
      const asset = project?.media.find((m) => m.id === assetId)
      if (!project || !asset) return
      const kind = trackKindFor(asset)
      const track = project.tracks.find((t) => t.id === trackId && t.kind === kind && !t.locked) ?? [...project.tracks].reverse().find((t) => t.kind === kind && !t.locked)
      if (!track) return
      const start = time ?? Math.max(0, ...track.clips.map(ops.clipEnd))
      const clip = { ...clipFromAsset(asset, start), muted: get().autoMute && asset.kind === 'video' && asset.hasAudio ? true : undefined }
      get().apply(`Add ${asset.name}`, (p) => ops.addClip(p, track.id, clip))
      set({ selection: [clip.id], selectedAssetId: null })
    },

    splitAtPlayhead() {
      const selected = new Set(get().selection)
      get().apply('Split', (p) => ops.splitAt(p, player.time, selected.size ? selected : undefined))
    },

    deleteSelection() {
      const selected = new Set(get().selection)
      if (!selected.size) return
      get().apply(`Delete ${selected.size} clip${selected.size === 1 ? '' : 's'}`, (p) => ops.removeClips(p, selected))
      set({ selection: [] })
    },

    duplicateSelection() {
      const selected = new Set(get().selection)
      let ids: string[] = []
      get().apply('Duplicate', (p) => {
        const result = ops.duplicateClips(p, selected)
        ids = result.ids
        return result.project
      })
      if (ids.length) set({ selection: ids })
    },

    copySelection() {
      const { project, selection } = get()
      if (project && selection.length) set({ clipboard: ops.copyClips(project, new Set(selection)) })
    },

    paste() {
      const { clipboard } = get()
      let ids: string[] = []
      get().apply('Paste', (p) => {
        const result = ops.pasteClips(p, clipboard, player.time)
        ids = result.ids
        return result.project
      })
      if (ids.length) set({ selection: ids })
    },

    async openSplit() {
      const { project } = get()
      if (!project) return
      await get().save()
      const prep = await window.api.projects.prepFor(project.id)
      if (!get().project!.prepProjectId) set({ project: { ...get().project!, prepProjectId: prep.id } })
      await window.api.split.open(prep.id)
    },

    async sendSelection(at) {
      const { project, selection } = get()
      if (!project || !selection.length) return 0
      const items: SentClip[] = project.tracks
        .flatMap((t) => t.clips.filter((c) => selection.includes(c.id)).map((clip) => ({ clip, asset: project.media.find((m) => m.id === clip.assetId) ?? null, trackKind: t.kind })))
        .sort((a, b) => a.clip.start - b.clip.start)
      const ok = at ? await window.api.split.dropAt(items, at.x, at.y) : await window.api.split.send(items)
      return ok ? items.length : 0
    },

    receiveClips(items, target) {
      const ids: string[] = []
      get().apply(`Add ${items.length} clip${items.length === 1 ? '' : 's'} from the other window`, (p) => {
        let next = p
        // Clips keep their trims, speed and effects; several arrive one after another from the playhead.
        const cursor: Record<string, number> = {}
        for (const item of items) {
          let assetId: string | null = null
          if (item.asset) {
            const existing = next.media.find((m) => m.path === item.asset!.path)
            if (existing) assetId = existing.id
            else {
              next = { ...next, media: [...next.media, item.asset] }
              assetId = item.asset.id
            }
          }
          const kind = item.trackKind
          const start = cursor[kind] ?? (target ? ops.snapToFrame(target.time, next.settings.fps) : player.time)
          const clip: Clip = { ...item.clip, id: newId(), assetId, start, transitionIn: undefined, effects: item.clip.effects.map((e) => ({ ...e, id: newId() })) }
          const candidates = next.tracks.filter((t) => t.kind === kind && !t.locked && t.name !== 'Look' && t.name !== 'Style SFX' && t.name !== 'Captions')
          // A drop goes on the track under the pointer when it has room there.
          const dropped = target && candidates.find((t) => t.id === target.trackId)
          let track = dropped && ops.freeStart(dropped, start, clip.duration) === start ? dropped : candidates.find((t) => ops.freeStart(t, start, clip.duration) === start)
          if (!track) {
            next = ops.addTrack(next, kind)
            track = kind === 'audio' ? next.tracks[next.tracks.length - 1] : next.tracks[0]
          }
          next = ops.addClip(next, track.id, clip)
          cursor[kind] = start + clip.duration
          ids.push(clip.id)
        }
        return next
      })
      set({ selection: ids, selectedAssetId: null })
    },

    addEffect(type) {
      get().updateSelected('Add effect', (c) => (c.assetId && get().project!.media.find((m) => m.id === c.assetId)?.kind === 'audio' ? {} : { effects: [...c.effects, makeEffect(type)] }))
    },

    addEffectStack(name, effects) {
      get().updateSelected(`Add ${name} stack`, (c) => (c.assetId && get().project!.media.find((m) => m.id === c.assetId)?.kind === 'audio' ? {} : { effects: [...c.effects, ...effects.map((e) => makeEffect(e.type, e.params))] }))
    },

    setTransition(type) {
      get().updateSelected('Set transition', (c) => ({ transitionIn: { type, duration: Math.min(c.transitionIn?.duration ?? 0.5, c.duration) } }))
    },

    updateSelected(label, patch, coalesce) {
      const ids = get().selection
      get().apply(label, (p) => ids.reduce((acc, id) => {
        const found = ops.findClip(acc, id)
        return found ? ops.updateClip(acc, id, patch(found.clip)) : acc
      }, p), { coalesce })
    }
  }
})

player.bind(() => useEditor.getState().project)
