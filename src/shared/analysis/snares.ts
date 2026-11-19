/**
 * Snare detection. The audio is split into three bands (kick, snare, hi-hat); a snare is a sharp
 * rise in the snare band where neither the kick nor the hi-hat band is stronger. Pure maths.
 */
import { onsetEnvelope } from './beats'

/** Rate and band edges used when the three band signals are produced (see the analysis pass). */
export const SNARE_RATE = 22050
export const BAND_FILTER = 'lowpass=f=140,aformat=sample_fmts=flt:channel_layouts=mono[k];[b]highpass=f=1200,lowpass=f=5000,aformat=sample_fmts=flt:channel_layouts=mono[s];[c]highpass=f=7500,aformat=sample_fmts=flt:channel_layouts=mono[h]'

const HOP = 0.01

function percentile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0
}

function localMax(env: Float32Array, i: number, reach: number): number {
  let m = 0
  for (let j = Math.max(0, i - reach); j <= Math.min(env.length - 1, i + reach); j++) if (env[j] > m) m = env[j]
  return m
}

/** Times (seconds) of detected snare hits. `kick`, `snare` and `hat` are the same recording filtered into three bands. */
export function detectSnares(kick: Float32Array, snare: Float32Array, hat: Float32Array, rate = SNARE_RATE): number[] {
  const eK = onsetEnvelope(kick, rate)
  const eS = onsetEnvelope(snare, rate)
  const eH = onsetEnvelope(hat, rate)
  const n = eS.length
  if (n < 100) return []

  // Compare bands on their own scales: each divided by its typical strong onset.
  const scale = (e: Float32Array): number => percentile(e, 0.97) || 1
  const [sK, sS, sH] = [scale(eK), scale(eS), scale(eH)]
  // A snare is among the strongest hits in its band; hi-hats and the kick's click leak in at a lower level.
  const floorLevel = percentile(eS, 0.995) * 0.6
  if (floorLevel < 0.5) return [] // no real percussion in this band

  const reach = 3
  const found: number[] = []
  let lastHit = -1
  for (let i = 2; i < n - 2; i++) {
    const v = eS[i]
    if (v < floorLevel || v < eS[i - 1] || v < eS[i + 1] || v < eS[i - 2] || v < eS[i + 2]) continue
    if ((i - lastHit) * HOP < 0.12) continue // two hits cannot be closer than this
    const s = v / sS
    const k = localMax(eK, i, reach) / sK
    const h = localMax(eH, i, reach) / sH
    // Kick-dominated or hi-hat-dominated onsets are not snares.
    if (s >= 0.45 && s >= k * 0.85 && s >= h * 0.7) {
      found.push(Math.round(i * HOP * 1000) / 1000)
      lastHit = i
    }
  }
  return found
}

/** Splits an interleaved 3-channel f32 buffer into its three band signals. */
export function splitBands(interleaved: Float32Array): [Float32Array, Float32Array, Float32Array] {
  const frames = Math.floor(interleaved.length / 3)
  const out: [Float32Array, Float32Array, Float32Array] = [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)]
  for (let i = 0; i < frames; i++) for (let c = 0; c < 3; c++) out[c][i] = interleaved[i * 3 + c]
  return out
}
