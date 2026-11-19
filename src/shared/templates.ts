/** Look templates: effects, sound effects, blend and transition of a clip, saved as a small file that others can load. */
import { effectSpec, makeEffect } from './effects/registry'
import { audioEffectSpec, makeAudioEffect, type AudioEffect } from './effects/audio'
import type { BlendMode, Clip, EffectInstance, Project } from './types'

export interface LookTemplate {
  format: 'vlcut-look'
  version: 1
  name: string
  effects: { type: string; enabled: boolean; params: Record<string, number>; ref?: undefined }[]
  audioFx: { type: string; enabled: boolean; params: Record<string, number> }[]
  blend?: BlendMode
  transition?: { type: string; duration: number }
}

const BLENDS = new Set(['normal', 'multiply', 'screen', 'overlay', 'softLight', 'hardLight', 'colorDodge', 'colorBurn', 'darken', 'lighten', 'difference', 'exclusion', 'add', 'hue', 'saturation', 'color', 'luminosity'])

export function captureLook(clip: Clip, name: string): LookTemplate {
  return {
    format: 'vlcut-look',
    version: 1,
    name: name.trim().slice(0, 60) || 'My look',
    // A LUT effect points at a table inside this project, so it is left out of a shareable file.
    effects: clip.effects.filter((e) => e.type !== 'lut').map((e) => ({ type: e.type, enabled: e.enabled, params: { ...e.params } })),
    audioFx: (clip.audioFx ?? []).map((e) => ({ type: e.type, enabled: e.enabled, params: { ...e.params } })),
    ...(clip.blend ? { blend: clip.blend } : {}),
    ...(clip.transitionIn ? { transition: { type: clip.transitionIn.type, duration: clip.transitionIn.duration } } : {})
  }
}

const clampTo = (v: unknown, min: number, max: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)

/** Checks a look from a file: unknown effects are dropped, parameters are forced into their allowed ranges. */
export function sanitizeLook(raw: unknown): { look: LookTemplate; dropped: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  if (t.format !== 'vlcut-look') return null
  let dropped = 0
  const effects: LookTemplate['effects'] = []
  for (const e of Array.isArray(t.effects) ? t.effects.slice(0, 60) : []) {
    const spec = e && typeof (e as { type?: unknown }).type === 'string' ? effectSpec((e as { type: string }).type) : undefined
    if (!spec || spec.type === 'lut') { dropped++; continue }
    const given = ((e as { params?: Record<string, unknown> }).params ?? {}) as Record<string, unknown>
    effects.push({ type: spec.type, enabled: (e as { enabled?: unknown }).enabled !== false, params: Object.fromEntries(spec.params.map((p) => [p.key, clampTo(given[p.key], p.min, p.max, p.default)])) })
  }
  const audioFx: LookTemplate['audioFx'] = []
  for (const e of Array.isArray(t.audioFx) ? t.audioFx.slice(0, 30) : []) {
    const spec = e && typeof (e as { type?: unknown }).type === 'string' ? audioEffectSpec((e as { type: string }).type) : undefined
    if (!spec) { dropped++; continue }
    const given = ((e as { params?: Record<string, unknown> }).params ?? {}) as Record<string, unknown>
    audioFx.push({ type: spec.type, enabled: (e as { enabled?: unknown }).enabled !== false, params: Object.fromEntries(spec.params.map((p) => [p.key, clampTo(given[p.key], p.min, p.max, p.default)])) })
  }
  const tr = t.transition as { type?: unknown; duration?: unknown } | undefined
  const look: LookTemplate = {
    format: 'vlcut-look',
    version: 1,
    name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 60).replace(/[<>]/g, '') : 'Imported look',
    effects,
    audioFx,
    ...(typeof t.blend === 'string' && BLENDS.has(t.blend) && t.blend !== 'normal' ? { blend: t.blend as BlendMode } : {}),
    ...(tr && typeof tr.type === 'string' && /^[A-Za-z0-9]{1,30}$/.test(tr.type) ? { transition: { type: tr.type, duration: clampTo(tr.duration, 0.05, 5, 0.5) } } : {})
  }
  if (!effects.length && !audioFx.length && !look.blend && !look.transition) return null
  return { look, dropped }
}

/** Adds a look's effects to the clips (on top of what they already have). */
export function applyLook(project: Project, ids: readonly string[], look: LookTemplate): { project: Project; count: number } {
  const target = new Set(ids)
  let count = 0
  const tracks = project.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) => {
      if (!target.has(c.id)) return c
      count++
      const effects: EffectInstance[] = look.effects.map((e) => ({ ...makeEffect(e.type, e.params), enabled: e.enabled }))
      const audioFx: AudioEffect[] = look.audioFx.map((e) => ({ ...makeAudioEffect(e.type, e.params), enabled: e.enabled }))
      return { ...c, effects: [...c.effects, ...effects], audioFx: audioFx.length ? [...(c.audioFx ?? []), ...audioFx] : c.audioFx, blend: look.blend ?? c.blend, transitionIn: look.transition ? { ...look.transition } : c.transitionIn }
    })
  }))
  return { project: { ...project, tracks }, count }
}
