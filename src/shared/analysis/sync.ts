/** Finds how far apart in time two recordings of the same event are, from their sound (GCC-PHAT cross-correlation). */
import { fft } from './spectrum'

const nextPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)))

export interface SyncResult {
  /** Seconds. An event at time x in `a` appears at x − lag in `b`: positive when `b` started recording before `a`. */
  lag: number
  /** Peak height in standard deviations: about 5 or less means no real match, above 10 is a clear one. */
  confidence: number
}

/**
 * Both signals are mono at `rate`. The search covers ±`maxLag` seconds.
 * PHAT weighting keeps only phase, so different microphones, levels and room sound still line up.
 */
export function syncOffset(a: Float32Array, b: Float32Array, rate: number, maxLag = 60): SyncResult {
  const size = nextPow2(a.length + b.length)
  const [ar, ai, br, bi] = [new Float64Array(size), new Float64Array(size), new Float64Array(size), new Float64Array(size)]
  a.forEach((v, i) => (ar[i] = v))
  b.forEach((v, i) => (br[i] = v))
  fft(ar, ai)
  fft(br, bi)
  // Cross-spectrum A·conj(B), normalised to unit magnitude.
  const [cr, ci] = [new Float64Array(size), new Float64Array(size)]
  for (let i = 0; i < size; i++) {
    const re = ar[i] * br[i] + ai[i] * bi[i]
    const im = ai[i] * br[i] - ar[i] * bi[i]
    const mag = Math.hypot(re, im) || 1
    // Conjugate on the way in so the forward FFT below acts as the inverse.
    cr[i] = re / mag
    ci[i] = -im / mag
  }
  fft(cr, ci)
  // The inverse transform is the forward one of the conjugate, conjugated and scaled; only magnitudes matter for the peak, but the sign of lag does.
  const at = (k: number): number => cr[((k % size) + size) % size] / size
  const limit = Math.min(Math.floor(maxLag * rate), size / 2 - 1)
  let best = -Infinity
  let bestLag = 0
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let k = -limit; k <= limit; k++) {
    const v = at(k)
    sum += v
    sumSq += v * v
    n++
    if (v > best) [best, bestLag] = [v, k]
  }
  // How many standard deviations the peak stands above the rest: pure chance reaches about 5, a real match is far higher.
  const mean = sum / Math.max(1, n)
  const std = Math.sqrt(Math.max(1e-30, sumSq / Math.max(1, n) - mean * mean))
  return { lag: bestLag / rate, confidence: (best - mean) / std }
}
