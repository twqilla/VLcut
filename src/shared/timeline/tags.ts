/**
 * "Tags" under a clip: everything done to a clip that can be taken off again (effects, a colour look, sound effects, a transition,
 * speed, a freeze, stabilising, a mask, a blend mode, fades, removed sound...). Each tag knows how to remove itself, so the timeline
 * can show them as little bars under the clip with an × like a phone editor does. Pure project-to-project functions.
 */
import type { Clip, Project } from '../types'
import { effectSpec, TRANSITIONS } from '../effects/registry'
import { audioEffectSpec } from '../effects/audio'
import { findClip, setClipSpeed, updateClip } from './ops'

export type TagKind = 'effect' | 'look' | 'audio' | 'transition' | 'speed' | 'freeze' | 'stab' | 'motion' | 'mask' | 'blend' | 'sound' | 'fade' | 'noise' | 'blending' | 'matte'

export interface ClipTag {
  id: string
  kind: TagKind
  label: string
  /** Longer description for the tooltip. */
  title: string
  /** False when the effect is switched off (it stays on the clip but does nothing). */
  enabled: boolean
  /** Takes it off the clip. */
  remove(project: Project): Project
  /** Switches it on or off, for tags that can be (effects). */
  toggle?(project: Project): Project
}

const mapEffects = (project: Project, clipId: string, f: (list: Clip['effects']) => Clip['effects']): Project => {
  const c = findClip(project, clipId)?.clip
  return c ? updateClip(project, clipId, { effects: f(c.effects) }) : project
}

/** Undoes stabilising: puts the zoom and position back (the same steps the Remove button in Properties takes). */
export function unstabilize(c: Clip): Partial<Clip> {
  if (!c.stab) return {}
  const keyframes = { ...c.keyframes }
  delete keyframes.x
  delete keyframes.y
  return { transform: { ...c.transform, scale: c.transform.scale / c.stab.zoom, x: c.stab.x, y: c.stab.y }, keyframes, stab: undefined }
}

/** Takes off what auto-reframe or "follow a tracked point" added: the position keyframes (and the zoom, for reframe). */
export function removeAutoMotion(c: Clip): Partial<Clip> {
  if (!c.autoMotion) return {}
  const keyframes = { ...c.keyframes }
  delete keyframes.x
  delete keyframes.y
  return { keyframes, autoMotion: undefined, transform: { ...c.transform, x: 0, y: 0, ...(c.autoMotion === 'reframe' ? { scale: 1 } : {}) } }
}

export function clipTags(project: Project, clip: Clip): ClipTag[] {
  const id = clip.id
  const tags: ClipTag[] = []
  const set = (patch: Partial<Clip>) => (p: Project): Project => updateClip(p, id, patch)

  for (const e of clip.effects) {
    const isLook = e.type === 'lut' && Boolean(e.ref?.startsWith('look-'))
    const name = isLook ? `Look: ${project.luts?.find((l) => l.id === e.ref)?.name ?? 'colour'}` : effectSpec(e.type)?.name ?? e.type
    tags.push({
      id: `fx:${e.id}`, kind: isLook ? 'look' : 'effect', label: name, title: `${name}${e.enabled ? '' : ' (off)'}`, enabled: e.enabled,
      remove: (p) => mapEffects(p, id, (list) => list.filter((x) => x.id !== e.id)),
      toggle: (p) => mapEffects(p, id, (list) => list.map((x) => (x.id === e.id ? { ...x, enabled: !x.enabled } : x)))
    })
  }
  for (const a of clip.audioFx ?? []) {
    const name = audioEffectSpec(a.type)?.name ?? a.type
    tags.push({
      id: `afx:${a.id}`, kind: 'audio', label: name, title: `Sound effect: ${name}${a.enabled ? '' : ' (off)'}`, enabled: a.enabled,
      remove: (p) => { const c = findClip(p, id)?.clip; return c ? updateClip(p, id, { audioFx: (c.audioFx ?? []).filter((x) => x.id !== a.id) }) : p },
      toggle: (p) => { const c = findClip(p, id)?.clip; return c ? updateClip(p, id, { audioFx: (c.audioFx ?? []).map((x) => (x.id === a.id ? { ...x, enabled: !x.enabled } : x)) }) : p }
    })
  }
  if (clip.transitionIn) {
    const name = TRANSITIONS.find((t) => t.type === clip.transitionIn!.type)?.name ?? clip.transitionIn.type
    tags.push({ id: 'transition', kind: 'transition', label: `In: ${name}`, title: `Transition into this clip: ${name}`, enabled: true, remove: set({ transitionIn: undefined }) })
  }
  if (clip.freeze) tags.push({ id: 'freeze', kind: 'freeze', label: 'Freeze frame', title: 'Freeze frame: remove to play the clip normally from this point', enabled: true, remove: set({ freeze: undefined, muted: false }) })
  else if (clip.speed !== 1) tags.push({ id: 'speed', kind: 'speed', label: `Speed ${clip.speed}×`, title: 'Remove to play at normal speed', enabled: true, remove: (p) => setClipSpeed(p, id, 1) })
  if (clip.frameBlend) tags.push({ id: 'blending', kind: 'blending', label: 'Frame blending', title: 'Smooths slow motion and low frame rates', enabled: true, remove: set({ frameBlend: undefined }) })
  if (clip.stab) tags.push({ id: 'stab', kind: 'stab', label: 'Stabilised', title: 'Remove stabilising', enabled: true, remove: (p) => { const c = findClip(p, id)?.clip; return c ? updateClip(p, id, unstabilize(c)) : p } })
  if (clip.autoMotion) tags.push({ id: 'motion', kind: 'motion', label: clip.autoMotion === 'reframe' ? 'Auto reframe' : 'Follows a point', title: 'Remove the camera movement that was added', enabled: true, remove: (p) => { const c = findClip(p, id)?.clip; return c ? updateClip(p, id, removeAutoMotion(c)) : p } })
  if (clip.mask) tags.push({ id: 'mask', kind: 'mask', label: 'Mask', title: 'Remove the mask', enabled: true, remove: set({ mask: undefined }) })
  if (clip.matte) tags.push({ id: 'matte', kind: 'matte', label: 'Track matte', title: 'Remove the matte', enabled: true, remove: set({ matte: undefined }) })
  if (clip.blend && !(clip.origin === 'style')) tags.push({ id: 'blend', kind: 'blend', label: `Blend: ${clip.blend}`, title: 'Back to normal blending', enabled: true, remove: set({ blend: undefined }) })
  if (clip.muted && !clip.freeze) tags.push({ id: 'sound', kind: 'sound', label: 'No sound', title: 'Bring the clip’s own sound back', enabled: true, remove: set({ muted: false }) })
  if (clip.denoise) tags.push({ id: 'noise', kind: 'noise', label: 'Noise reduction', title: 'Turn noise reduction off', enabled: true, remove: set({ denoise: undefined }) })
  if (clip.fadeIn > 0) tags.push({ id: 'fadeIn', kind: 'fade', label: `Fade in ${Math.round(clip.fadeIn * 10) / 10} s`, title: 'Remove the fade in', enabled: true, remove: set({ fadeIn: 0 }) })
  if (clip.fadeOut > 0) tags.push({ id: 'fadeOut', kind: 'fade', label: `Fade out ${Math.round(clip.fadeOut * 10) / 10} s`, title: 'Remove the fade out', enabled: true, remove: set({ fadeOut: 0 }) })
  return tags
}
