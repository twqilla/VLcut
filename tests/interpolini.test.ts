import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { DEFAULT_INTERPOLINI, blendWeights, describeBlend, interpoliniArgs, parseInterpoliniLine, resolveRate, type Weighting } from '../src/shared/render/interpolini'

interface Case { source: number; blend: number; intensity: number; weighting: Weighting; custom: number[]; weights: number[] }
// Reference numbers produced by compiling interpolini's own weights.rs (crates/core/src/weights.rs).
const cases: Case[] = JSON.parse(readFileSync(new URL('./fixtures/interpolini-weights.json', import.meta.url), 'utf8'))

test('blend weights match interpolini\'s own Rust code in all reference cases', () => {
  expect(cases.length).toBe(1728)
  let worst = 0
  for (const c of cases) {
    const got = blendWeights(c.source, c.blend, c.intensity, c.weighting, c.custom)
    const label = `${c.weighting} ${c.source}->${c.blend} x${c.intensity} custom=[${c.custom}]`
    expect(got.length, label).toBe(c.weights.length)
    got.forEach((w, i) => { worst = Math.max(worst, Math.abs(w - c.weights[i])) })
    expect(got.every((w, i) => Math.abs(w - c.weights[i]) < 1e-12), label).toBe(true)
    expect(Math.abs(got.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12)
  }
  expect(worst).toBeLessThan(1e-12)
})

test('rates, command line and replies follow interpolini\'s contract', () => {
  expect(resolveRate('960', 30)).toBe(960)
  expect(resolveRate('x16', 30)).toBe(480)
  expect(resolveRate('16x', 29.97)).toBe(Math.round(29.97 * 16))
  expect(resolveRate('nonsense', 30)).toBe(30)

  const args = interpoliniArgs({ ...DEFAULT_INTERPOLINI, engine: 'rife', weighting: 'custom', custom: [1, 2, 5], half: false }, 60, 'C:\\clips\\a b.mp4')
  expect(args.slice(0, 2)).toEqual(['-g', '-j']) // ignore folder configs, JSON lines
  expect(args.at(-1)).toBe('C:\\clips\\a b.mp4')
  const settings = args.filter((_, i) => args[i - 1] === '-s')
  expect(settings).toContain('interpolation.engine=rife')
  expect(settings).toContain('interpolation.fps=960')
  expect(settings).toContain('interpolation.half size=no')
  expect(settings).toContain('blending.fps=60')
  expect(settings).toContain('blending.weighting=[1, 2, 5]')
  expect(settings).toContain('dedup.enabled=yes')
  // every -s is section.key=value, which is what the tool splits on
  expect(settings.every((s) => /^[a-z-]+\.[a-z ]+=.+$/.test(s))).toBe(true)

  expect(parseInterpoliniLine('{"event":"progress","frame":10,"frames":200,"fps":31.5}')).toEqual({ event: 'progress', frame: 10, frames: 200, fps: 31.5 })
  expect(parseInterpoliniLine('{"event":"done","clip":"a.mp4","output":"C:\\\\x\\\\a (interpolini).mp4","seconds":12.3}')).toMatchObject({ event: 'done', output: 'C:\\x\\a (interpolini).mp4' })
  expect(parseInterpoliniLine('[*] not json')).toBeNull()
  expect(parseInterpoliniLine('{broken')).toBeNull()

  expect(describeBlend(DEFAULT_INTERPOLINI, 30, 60)).toBe('Each 60 fps frame blends 17 of the 960 fps interpolated frames.')
  expect(describeBlend({ ...DEFAULT_INTERPOLINI, fps: '60' }, 30, 60)).toContain('no visible blur')
})
