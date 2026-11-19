import { expect, test } from 'vitest'
import { buildLook, LOOKS, LOOK_ALIASES } from '../src/shared/color/looks'
import { sampleLut, parseCube, serializeCube } from '../src/shared/color/cube'
import { applyLook, removeLooks, addOverlay } from '../src/shared/agent/tools2'
import { planRequest } from '../src/shared/agent/planner'
import { OVERLAY_CATALOG } from '../src/shared/overlayCatalog'
import { clipFromAsset, makeTrack } from '../src/shared/timeline/model'
import { addClip } from '../src/shared/timeline/ops'
import type { MediaAsset, Project } from '../src/shared/types'

const pic: MediaAsset = { id: 'v', path: '/v.mp4', name: 'v.mp4', kind: 'video', duration: 12, width: 1920, height: 1080, fps: 30, hasAudio: true, sizeBytes: 1 }
const proj = (): Project => { const t = makeTrack('video', 'V1'); return addClip({ formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [pic], tracks: [t] }, t.id, clipFromAsset(pic, 0)) }
const out = (id: string, c: [number, number, number]): number[] => { const t = buildLook(id)!; const o = [0, 0, 0]; sampleLut(t, c[0], c[1], c[2], o); return o }
const luma = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

test('every look builds a valid table that keeps black and white sensible and round-trips through .cube', () => {
  expect(LOOKS.length).toBeGreaterThanOrEqual(20)
  for (const l of LOOKS) {
    const t = buildLook(l.id)!
    expect(t.size, l.id).toBe(21)
    expect(t.data.length).toBe(21 ** 3 * 3)
    expect(t.data.every((v) => v >= 0 && v <= 1 && Number.isFinite(v)), l.id).toBe(true)
    // Not a no-op and not a ruin: it changes colours, but white stays light and black stays dark.
    expect(luma(out(l.id, [1, 1, 1])), `${l.id} white`).toBeGreaterThan(0.8)
    expect(luma(out(l.id, [0, 0, 0])), `${l.id} black`).toBeLessThan(0.2)
    const mid = out(l.id, [0.6, 0.45, 0.3])
    expect(Math.abs(mid[0] - 0.6) + Math.abs(mid[1] - 0.45) + Math.abs(mid[2] - 0.3), `${l.id} changes colour`).toBeGreaterThan(0.01)
  }
  const again = parseCube(serializeCube('x', buildLook('tealOrange')!))
  expect(again.table.size).toBe(21)
  expect(Math.abs(again.table.data[100] - buildLook('tealOrange')!.data[100])).toBeLessThan(1e-4)
})

test('the looks do what their names say', () => {
  for (const id of ['noirBW', 'silverBW', 'highKeyBW']) { const o = out(id, [0.8, 0.3, 0.2]); expect(Math.abs(o[0] - o[1]) + Math.abs(o[1] - o[2]), id).toBeLessThan(0.02) }
  const shadow = out('tealOrange', [0.2, 0.2, 0.2]); expect(shadow[2], 'teal shadows are bluer than red').toBeGreaterThan(shadow[0])
  const high = out('tealOrange', [0.8, 0.8, 0.8]); expect(high[0], 'orange highlights are redder than blue').toBeGreaterThan(high[2])
  expect(out('goldenHour', [0.5, 0.5, 0.5])[0]).toBeGreaterThan(out('goldenHour', [0.5, 0.5, 0.5])[2])
  expect(out('coldSteel', [0.5, 0.5, 0.5])[2]).toBeGreaterThan(out('coldSteel', [0.5, 0.5, 0.5])[0])
  const sat = (c: number[]): number => Math.max(...c) - Math.min(...c)
  expect(sat(out('vivid', [0.7, 0.4, 0.3]))).toBeGreaterThan(sat([0.7, 0.4, 0.3]))
  expect(sat(out('ashGrey', [0.7, 0.4, 0.3]))).toBeLessThan(sat([0.7, 0.4, 0.3]))
  for (const id of Object.keys(LOOK_ALIASES)) expect(LOOKS.some((l) => l.id === id), id).toBe(true)
})

test('applying a look adds one table to the project and one LUT effect per clip, and replaces an earlier look', () => {
  const p = proj()
  const a = applyLook(p, 'kodak', 0.6)
  expect(a.count).toBe(1)
  expect(a.project.luts).toHaveLength(1)
  const clip = a.project.tracks[0].clips[0]
  expect(clip.effects.filter((e) => e.type === 'lut')).toHaveLength(1)
  expect(clip.effects[0].ref).toBe('look-kodak')
  expect(clip.effects[0].params.amount).toBe(0.6)
  const b = applyLook(a.project, 'noirBW', 1)
  expect(b.project.tracks[0].clips[0].effects.filter((e) => e.type === 'lut')).toHaveLength(1)
  expect(b.project.tracks[0].clips[0].effects[0].ref).toBe('look-noirBW')
  expect(removeLooks(b.project).project.tracks[0].clips[0].effects).toHaveLength(0)
  expect(applyLook(p, 'nope', 1).count).toBe(0)
})

test('overlays go on their own track above the picture, fill the frame and repeat to cover the timeline', () => {
  const p = proj()
  const info = OVERLAY_CATALOG.find((o) => o.id === 'leakWarm')!
  const asset: MediaAsset = { ...pic, id: 'ov', duration: 5, builtinOverlay: 'leakWarm', hasAudio: false }
  const one = addOverlay(p, asset, info, 0, false)
  expect(one.count).toBe(1)
  const track = one.project.tracks.find((t) => t.name === 'Overlays')!
  expect(track.clips[0]).toMatchObject({ blend: 'screen', opacity: 0.85 })
  expect(one.project.tracks.indexOf(track)).toBeLessThan(one.project.tracks.findIndex((t) => t.name === 'V1')) // above the picture
  const cover = addOverlay(p, asset, info, 0, true)
  expect(cover.count).toBe(3) // 12 s timeline / 5 s overlay
  const clips = cover.project.tracks.find((t) => t.name === 'Overlays')!.clips
  expect(clips[clips.length - 1].start + clips[clips.length - 1].duration).toBeCloseTo(12, 1)
})

test('the assistant uses looks and overlays only when asked for them by name', () => {
  const step = (r: string, tool: string) => planRequest(r, proj()).steps.find((s) => s.tool === tool)
  expect(step('apply the kodak lut', 'applyLook')?.args).toMatchObject({ look: 'kodak', intensity: 1 })
  expect(step('give it the teal and orange colour look at 60%', 'applyLook')?.args).toMatchObject({ look: 'tealOrange', intensity: 0.6 })
  expect(step('use the dark trap look lut', 'applyLook')?.args.look).toBe('darkTrap')
  expect(step('remove the lut', 'removeLook')).toBeTruthy()
  expect(step('add a warm light leak overlay', 'addOverlay')?.args).toMatchObject({ overlay: 'leakWarm', cover: 0 })
  expect(step('put a film grain overlay over the whole video', 'addOverlay')?.args).toMatchObject({ overlay: 'grain', cover: 1 })
  expect(step('add a white flash overlay at 4 seconds', 'addOverlay')?.args).toMatchObject({ overlay: 'flash', at: 4 })
  // The older effect wording keeps working and is not turned into a library item.
  const old = planRequest('Add light leaks and a lens flare', proj()).steps.map((s) => s.tool)
  expect(old).toContain('addEffect')
  expect(old).not.toContain('addOverlay')
  expect(planRequest('Make it film noir', proj()).steps.some((s) => s.tool === 'applyLook')).toBe(false)
})
