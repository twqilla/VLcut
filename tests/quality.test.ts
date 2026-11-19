import { expect, test } from 'vitest'
import { QualityGovernor, useQuality } from '../src/renderer/src/engine/quality'

test('quality is lowered only when most frames overrun, and then gets time to settle', () => {
  const g = new QualityGovernor()
  const budget = 33
  // Smooth playback: never asks to lower.
  for (let i = 0; i < 200; i++) expect(g.sample(12, budget)).toBeNull()
  // A few slow frames among fast ones (a seek, a hiccup) are tolerated.
  for (let i = 0; i < 200; i++) expect(g.sample(i % 5 === 0 ? 80 : 14, budget)).toBeNull()
  // Sustained overrun: asks soon, then stays quiet while the change takes effect.
  const answers = Array.from({ length: 150 }, () => g.sample(70, budget))
  const at = answers.map((a, i) => (a === 'lower' ? i : -1)).filter((i) => i >= 0)
  expect(at[0]).toBeLessThan(25)
  expect(at.length).toBeGreaterThanOrEqual(2)
  at.slice(1).forEach((i, k) => expect(i - at[k]).toBeGreaterThan(60)) // never twice within the settling pause
  // Still struggling after the pause: asks again.
  const more = Array.from({ length: 150 }, () => g.sample(70, budget))
  expect(more.filter((a) => a === 'lower').length).toBeGreaterThanOrEqual(1)
})

test('the preview steps down from half to quarter in auto mode and respects a manual choice', () => {
  const q = useQuality
  q.getState().choose('auto')
  expect(q.getState().scale).toBe(0.5)
  q.getState().lower()
  expect(q.getState().scale).toBe(0.25)
  expect(q.getState().note).toMatch(/dropped to quarter/)
  q.getState().lower() // already at the lowest step
  expect(q.getState().scale).toBe(0.25)
  q.getState().choose(1)
  q.getState().lower() // a manual choice is never overridden
  expect(q.getState().scale).toBe(1)
  expect(q.getState().note).toBe('')
})
