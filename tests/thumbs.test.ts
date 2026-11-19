import { expect, test } from 'vitest'
import { thumbCount, thumbTimes } from '../src/renderer/src/components/ThumbStrip'

test('the number of frames fits the clip: more when wide, one when tiny, never silly', () => {
  expect(thumbCount(20, 50)).toBe(1)
  expect(thumbCount(160, 50)).toBe(2)
  expect(thumbCount(800, 50)).toBe(10)
  expect(thumbCount(100000, 50)).toBe(14)
  expect(thumbCount(300, 8)).toBeLessThanOrEqual(12) // a very short track still gives a sensible count
})

test('frames come evenly from what the clip plays, reversed and sped up included', () => {
  expect(thumbTimes({ sourceIn: 10, duration: 8, speed: 1, reversed: false }, 4)).toEqual([11, 13, 15, 17])
  // Twice the speed plays 16 s of source in 8 s.
  expect(thumbTimes({ sourceIn: 0, duration: 8, speed: 2, reversed: false }, 4)).toEqual([2, 6, 10, 14])
  // Reversed: the first frame shown is the last source frame.
  expect(thumbTimes({ sourceIn: 10, duration: 8, speed: 1, reversed: true }, 4)).toEqual([17, 15, 13, 11])
})
