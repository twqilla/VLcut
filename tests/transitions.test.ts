import { expect, test } from 'vitest'
import { CLEAN_TRANSITIONS, transitionEase } from '../src/shared/effects/more'
import { TRANSITIONS } from '../src/shared/effects/registry'
import { shapeTransitionProgress } from '../src/shared/timeline/ops'
import { transitionFrame } from '../src/renderer/src/engine/transitions'
import { planRequest } from '../src/shared/agent/planner'
import type { Project } from '../src/shared/types'

test('start and end ease reshape the timing, and zero for both is a straight line', () => {
  expect(shapeTransitionProgress(0.3, { type: 'fade', easeIn: 0, easeOut: 0 })).toBeCloseTo(0.3, 3)
  expect(shapeTransitionProgress(0.3, { type: 'fade' })).toBe(0.3) // an old transition keeps its own curve
  const soft = shapeTransitionProgress(0.1, { easeIn: 1, easeOut: 0 })
  const hard = shapeTransitionProgress(0.1, { easeIn: 0, easeOut: 0 })
  expect(soft).toBeLessThan(hard) // a soft start moves less at first
  expect(shapeTransitionProgress(0.9, { easeIn: 0, easeOut: 1 })).toBeGreaterThan(0.9) // a soft landing has nearly arrived already
  for (const p of [0, 1]) expect(shapeTransitionProgress(p, { easeIn: 0.7, easeOut: 0.4 })).toBeCloseTo(p, 5)
  let last = -1
  for (let i = 0; i <= 50; i++) { const v = shapeTransitionProgress(i / 50, { easeIn: 0.9, easeOut: 0.9 }); expect(v).toBeGreaterThanOrEqual(last - 1e-9); last = v }
})

test('every clean transition is registered, starts hidden or off-screen and ends settled', () => {
  expect(CLEAN_TRANSITIONS.length).toBeGreaterThanOrEqual(14)
  for (const t of CLEAN_TRANSITIONS) {
    expect(TRANSITIONS.some((x) => x.type === t.type), t.type).toBe(true)
    expect(transitionEase(t.type)).toEqual(t.ease)
    const end = transitionFrame(t.type, 1).incoming
    expect(end.alpha ?? 1, t.type).toBeCloseTo(1, 1)
    expect(Math.abs(end.dx ?? 0) + Math.abs(end.dy ?? 0), t.type).toBeLessThan(0.05)
    expect(end.scale ?? 1, t.type).toBeCloseTo(1, 1)
    expect(end.blur ?? 0, t.type).toBeLessThan(1)
    for (let i = 0; i <= 20; i++) {
      const f = transitionFrame(t.type, i / 20)
      for (const side of [f.incoming, f.outgoing]) for (const v of Object.values(side)) if (typeof v === 'number') expect(Number.isFinite(v), `${t.type} @${i}`).toBe(true)
    }
    const start = transitionFrame(t.type, 0).incoming
    expect((start.alpha ?? 1) === 0 || Math.abs(start.dx ?? 0) + Math.abs(start.dy ?? 0) >= 0.9 || (start.alpha ?? 1) < 0.5, `${t.type} hides the new clip at the start`).toBe(true)
  }
})

test('strength scales the blur and shake', () => {
  const smear = (k: number): number => transitionFrame('whipLeft', 0.5, k).incoming.smear!.amount
  expect(smear(2)).toBeCloseTo(smear(1) * 2, 5)
  expect(smear(0.2)).toBeLessThan(smear(1))
  const shake = (k: number): number => Math.abs(transitionFrame('beatShake', 0.15, k).incoming.dx ?? 0) + Math.abs(transitionFrame('beatShake', 0.15, k).incoming.dy ?? 0)
  expect(shake(2)).toBeGreaterThan(shake(0.5))
  // Deterministic: preview and export draw the same frame.
  expect(transitionFrame('beatShake', 0.4)).toEqual(transitionFrame('beatShake', 0.4))
})

test('the assistant knows the new transitions by name', () => {
  const p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [], tracks: [] }
  const type = (r: string): string => String(planRequest(r, p).steps.find((s) => s.tool === 'addTransitions')?.args.type)
  expect(type('add beat shake transitions')).toBe('beatShake')
  expect(type('Add motion blur whip transitions')).toBe('whipLeft')
  expect(type('add zoom blur transitions')).toBe('zoomBlurIn')
})
