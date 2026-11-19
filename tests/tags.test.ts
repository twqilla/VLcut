import { expect, test } from 'vitest'
import { clipTags, removeAutoMotion } from '../src/shared/timeline/tags'
import { clipFromAsset, makeTrack } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import { makeEffect } from '../src/shared/effects/registry'
import { makeAudioEffect } from '../src/shared/effects/audio'
import { applyLook } from '../src/shared/agent/tools2'
import type { MediaAsset, Project } from '../src/shared/types'

const asset: MediaAsset = { id: 'v', path: '/v.mp4', name: 'v.mp4', kind: 'video', duration: 20, width: 1920, height: 1080, fps: 30, hasAudio: true, sizeBytes: 1 }
function rig() {
  const t = makeTrack('video', 'V1')
  let p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [asset], tracks: [t] }
  const c = clipFromAsset(asset, 0)
  p = ops.addClip(p, t.id, c)
  return { p, id: c.id }
}
const get = (p: Project, id: string) => ops.findClip(p, id)!.clip

test('every effect, sound effect and look appears as a tag, and removing it takes exactly that one off', () => {
  let { p, id } = rig()
  const [blur, glow] = [makeEffect('blur'), makeEffect('bloom')]
  p = ops.updateClip(p, id, { effects: [blur, glow], audioFx: [makeAudioEffect('reverb')] })
  p = applyLook(p, 'kodak', 1).project
  const tags = clipTags(p, get(p, id))
  expect(tags.map((t) => t.kind)).toEqual(['effect', 'effect', 'look', 'audio'])
  expect(tags[2].label).toBe('Look: Warm film')
  const after = tags[0].remove(p)
  expect(get(after, id).effects.map((e) => e.id)).toEqual([glow.id, get(p, id).effects[2].id])
  expect(clipTags(after, get(after, id))).toHaveLength(3)
  const noSound = clipTags(p, get(p, id)).find((t) => t.kind === 'audio')!.remove(p)
  expect(get(noSound, id).audioFx).toEqual([])
  // Switching an effect off keeps it but marks it off, and back on again.
  const off = tags[1].toggle!(p)
  expect(clipTags(off, get(off, id))[1].enabled).toBe(false)
  expect(clipTags(off, get(off, id))[1].toggle!(off)).toEqual(p)
})

test('speed, freeze, transition, mask, blend, fades and removed sound each show and each go away', () => {
  let { p, id } = rig()
  p = ops.updateClip(p, id, { transitionIn: { type: 'fade', duration: 0.5 }, mask: { shape: 'ellipse', x: 0, y: 0, width: 0.5, height: 0.5, feather: 0, invert: false }, blend: 'screen', fadeIn: 0.5, fadeOut: 1, muted: true, denoise: true, frameBlend: true })
  p = ops.setClipSpeed(p, id, 2)
  const kinds = clipTags(p, get(p, id)).map((t) => t.kind).sort()
  expect(kinds).toEqual(['blend', 'blending', 'fade', 'fade', 'mask', 'noise', 'sound', 'speed', 'transition'].sort())
  let q = p
  for (const tag of clipTags(p, get(p, id))) q = tag.remove(q)
  const c = get(q, id)
  expect([c.speed, c.transitionIn, c.mask, c.blend, c.fadeIn, c.fadeOut, c.muted, c.denoise, c.frameBlend]).toEqual([1, undefined, undefined, undefined, 0, 0, false, undefined, undefined])
  expect(clipTags(q, c)).toEqual([])
})

test('a freeze frame can be released, stabilising and camera moves can be taken off', () => {
  let { p, id } = rig()
  p = ops.updateClip(p, id, { freeze: true, muted: true })
  const frozen = clipTags(p, get(p, id))
  expect(frozen.map((t) => t.kind)).toEqual(['freeze'])
  const released = get(frozen[0].remove(p), id)
  expect([released.freeze, released.muted]).toEqual([undefined, false])
  const stabbed = ops.updateClip(rig().p, id, {})
  void stabbed
  const base = rig()
  const withStab = ops.updateClip(base.p, base.id, { stab: { zoom: 1.2, x: 0.1, y: 0.2 }, transform: { x: 0, y: 0, scale: 1.2, rotation: 0 }, keyframes: { x: [{ t: 0, value: 0.01, easing: 'linear' }], y: [{ t: 0, value: 0.02, easing: 'linear' }] } })
  const t = clipTags(withStab, get(withStab, base.id))
  expect(t.map((x) => x.kind)).toEqual(['stab'])
  const back = get(t[0].remove(withStab), base.id)
  expect(back.stab).toBeUndefined()
  expect(back.transform.scale).toBeCloseTo(1, 6)
  expect(back.keyframes.x).toBeUndefined()
  const moved = ops.updateClip(base.p, base.id, { autoMotion: 'reframe', transform: { x: 0, y: 0, scale: 1.8, rotation: 0 }, keyframes: { x: [{ t: 0, value: 0.1, easing: 'linear' }], y: [{ t: 0, value: 0.1, easing: 'linear' }] } })
  expect(clipTags(moved, get(moved, base.id))[0].label).toBe('Auto reframe')
  const cleaned = removeAutoMotion(get(moved, base.id))
  expect(cleaned.transform).toMatchObject({ x: 0, y: 0, scale: 1 })
  expect(cleaned.keyframes!.x).toBeUndefined()
  expect(removeAutoMotion(get(base.p, base.id))).toEqual({})
})
