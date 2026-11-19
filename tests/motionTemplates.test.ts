import { expect, test } from 'vitest'
import { insertTemplate, MOTION_TEMPLATES, TEMPLATE_CATEGORIES, templateById, templateValues } from '../src/shared/motionTemplates'
import { ALL_FONTS } from '../src/shared/effects/fonts'
import { TEXT_ANIMATIONS, TEXT_OUT_ANIMATIONS } from '../src/shared/effects/registry'
import { makeTrack } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import type { Project } from '../src/shared/types'

const empty = (): Project => ({ formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [], tracks: [makeTrack('video', 'V1'), makeTrack('text', 'T1')] })

test('there are plenty of templates in every category, each with working fields', () => {
  expect(MOTION_TEMPLATES.length).toBeGreaterThanOrEqual(18)
  for (const c of TEMPLATE_CATEGORIES) expect(MOTION_TEMPLATES.filter((t) => t.category === c).length, c).toBeGreaterThanOrEqual(2)
  expect(new Set(MOTION_TEMPLATES.map((t) => t.id)).size).toBe(MOTION_TEMPLATES.length)
  for (const t of MOTION_TEMPLATES) {
    expect(t.fields.length, t.id).toBeGreaterThan(0)
    expect(new Set(t.fields.map((f) => f.key)).size, `${t.id} field keys`).toBe(t.fields.length)
    const layers = t.build(templateValues(t))
    expect(layers.length, t.id).toBeGreaterThan(0)
    for (const l of layers) {
      expect(l.clip.start, `${t.id} starts inside it`).toBeGreaterThanOrEqual(0)
      expect(l.clip.start + l.clip.duration, `${t.id} ends within its length`).toBeLessThanOrEqual(t.seconds + 0.01)
      if (l.clip.text) {
        expect(ALL_FONTS, `${t.id} font ${l.clip.text.fontFamily}`).toContain(l.clip.text.fontFamily)
        expect(TEXT_ANIMATIONS.map((a) => a.type), `${t.id} animation ${l.clip.text.animation}`).toContain(l.clip.text.animation)
        if (l.clip.text.animationOut) expect(TEXT_OUT_ANIMATIONS.map((a) => a.type), `${t.id} out ${l.clip.text.animationOut}`).toContain(l.clip.text.animationOut)
      }
    }
    // Every field the template declares is actually used by it.
    for (const f of t.fields) {
      const marker = f.kind === 'color' ? '#abcdef' : `«${f.key}»`
      const used = t.build({ ...templateValues(t), [f.key]: marker }).some((l) => JSON.stringify(l.clip).includes(marker))
      expect(used, `${t.id}: ${f.key} is used`).toBe(true)
    }
  }
})

test('field values are filled with defaults, cleaned and limited', () => {
  const t = templateById('cleanTitle')!
  expect(templateValues(t).title).toBe('Your title')
  expect(templateValues(t, { title: 'Hello\u0000 there' }).title).toBe('Hello there')
  expect(templateValues(t, { title: 'x'.repeat(500) }).title).toHaveLength(200)
  expect(templateValues(t, { color: 'red; background:url(x)' }).color).toBe('#ffffff') // not a colour: the default
  expect(templateValues(t, { color: '#12ab34' }).color).toBe('#12ab34')
})

test('inserting puts every part on a track with room, at the playhead, and the text the person typed', () => {
  const t = templateById('cleanTitle')!
  const r = insertTemplate(empty(), t, { title: 'Summer reel', subtitle: 'Ibiza 2026' }, 2)
  expect(r.ids).toHaveLength(3)
  const clips = r.project.tracks.flatMap((tr) => tr.clips)
  expect(clips).toHaveLength(3)
  expect(Math.min(...clips.map((c) => c.start))).toBe(2)
  expect(clips.some((c) => c.text?.content === 'Summer reel')).toBe(true)
  expect(clips.some((c) => c.text?.content === 'Ibiza 2026')).toBe(true)
  expect(clips.filter((c) => c.shape)).toHaveLength(1)
  // The two text parts overlap in time, so they are on different tracks; nothing overlaps within a track.
  for (const tr of r.project.tracks) {
    const sorted = [...tr.clips].sort((a, b) => a.start - b.start)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].start, `${tr.name} overlap`).toBeGreaterThanOrEqual(sorted[i - 1].start + sorted[i - 1].duration - 1e-6)
  }
  expect(r.project.tracks.filter((tr) => tr.kind === 'text').length).toBeGreaterThanOrEqual(2)
  // A second one right after the first reuses the tracks.
  const again = insertTemplate(r.project, t, {}, 2 + t.seconds)
  expect(again.project.tracks.length).toBe(r.project.tracks.length)
  expect(ops.projectDuration(again.project)).toBeCloseTo(2 + t.seconds + 4, 1)
  // Locked tracks are never written to.
  const locked = empty(); locked.tracks[1].locked = true
  const lr = insertTemplate(locked, templateById('subscribe')!, {}, 0)
  expect(lr.project.tracks.find((tr) => tr.id === locked.tracks[1].id)!.clips).toHaveLength(0)
  expect(lr.project.tracks.flatMap((tr) => tr.clips)).toHaveLength(1)
})

test('the assistant adds a template by name with the quoted words in the right fields', async () => {
  const { planRequest, runStep } = await import('../src/shared/agent/planner')
  const p = empty()
  const plan = (r: string) => planRequest(r, p).steps.find((s) => s.tool === 'addTemplate')
  const neon = plan('Add the neon sign template saying "Night Owls"')!
  expect(neon.args).toMatchObject({ template: 'neonSign', at: 'start' })
  expect(JSON.parse(String(neon.args.values))).toEqual({ title: 'Night Owls' })
  const lower = plan('Add the simple lower third template with "Alex Rivera" and "Director"')!
  expect(JSON.parse(String(lower.args.values))).toEqual({ name: 'Alex Rivera', role: 'Director' })
  expect(plan('Add the thanks for watching template at the end')!.args.at).toBe('end')
  expect(plan('add the countdown template at 5 seconds')!.args.at).toBe(5)
  // Without the word "template" a lower third or a neon title keeps meaning the older text rules.
  expect(plan('Add a neon title saying "Hi"')).toBeUndefined()
  expect(planRequest('Add a lower third "Alex Rivera, Director"', p).steps.some((s) => s.tool === 'addText')).toBe(true)
  const ran = runStep(p, lower)
  expect(ran.changed).toBe(true)
  expect(ran.project.tracks.flatMap((t) => t.clips).some((c) => c.text?.content === 'Alex Rivera')).toBe(true)
})
