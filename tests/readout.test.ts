import { expect, test } from 'vitest'
import { formatOffset } from '../src/renderer/src/readout'

test('the offset from the centre is shown in pixels and percent, with signs, and "centred" at zero', () => {
  expect(formatOffset(0.0625, -0.0417, 1920, 1080)).toEqual({ lines: ['X +120 px (+6.3 %)', 'Y −45 px (−4.2 %)'], onCentreX: false, onCentreY: false })
  const c = formatOffset(0, 0, 1920, 1080)
  expect(c.lines).toEqual(['X 0 px · centred', 'Y 0 px · centred'])
  expect([c.onCentreX, c.onCentreY]).toEqual([true, true])
  // A tiny drift that rounds to zero pixels counts as centred.
  expect(formatOffset(0.0001, 0, 1920, 1080).onCentreX).toBe(true)
  // Works for vertical frames too.
  expect(formatOffset(0.5, 0.25, 1080, 1920).lines).toEqual(['X +540 px (+50.0 %)', 'Y +480 px (+25.0 %)'])
})
