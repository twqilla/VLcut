/**
 * Cleans up the word times that speech recognition gives, because caption words then land a word early or late:
 * - Several words can come back with the same start time. The page would then jump to the last of them and skip the others.
 * - Times are not always in order.
 * - Recognition hands a pause to the word that follows it, so after a silence the next word looks like it starts early.
 */
import type { Word } from '../types'

/** The longest a word of this length plausibly takes, in seconds. A longer stretch means part of it was a pause before the word. */
export const plausibleSeconds = (text: string): number => 0.35 + 0.09 * [...text.replace(/[^\p{L}\p{N}]/gu, '')].length

const MIN = 0.05

export function refineWordTimes(input: Word[]): Word[] {
  const words = input.map((w) => ({ ...w }))
  // 1. Keep starts in order.
  for (let i = 1; i < words.length; i++) if (words[i].start < words[i - 1].start) words[i].start = words[i - 1].start
  // 2. Words that share a start time are spread over the time up to the next different start (by their length).
  for (let i = 0; i < words.length; ) {
    let j = i + 1
    while (j < words.length && Math.abs(words[j].start - words[i].start) < 0.001) j++
    if (j - i > 1) {
      const next = words[j]?.start ?? Math.max(...words.slice(i, j).map((w) => w.end))
      const span = Math.max(next - words[i].start, MIN * (j - i))
      const weights = words.slice(i, j).map((w) => Math.max(1, [...w.text].length))
      const total = weights.reduce((a, b) => a + b, 0)
      let at = words[i].start
      for (let k = i; k < j; k++) {
        const len = (span * weights[k - i]) / total
        words[k].start = at
        words[k].end = at + len
        at += len
      }
    }
    i = j
  }
  // 3. A word that is far longer than it can be spoken: the pause came first, so it starts later.
  for (const w of words) {
    const longest = plausibleSeconds(w.text)
    if (w.end - w.start > longest * 1.8) w.start = w.end - longest
  }
  // 4. Ends: at least a short time, and not past the next word's start.
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1]?.start
    let end = Math.max(words[i].end, words[i].start + MIN)
    if (next !== undefined && next >= words[i].start + MIN) end = Math.min(end, next)
    words[i].end = end
  }
  return words
}

/** Moves every caption word by `seconds` (negative = earlier), for captions that sit a little early or late. */
export function shiftWords(words: Word[], seconds: number): Word[] {
  return words.map((w) => ({ ...w, start: Math.max(0, w.start + seconds), end: Math.max(MIN, w.end + seconds) }))
}
