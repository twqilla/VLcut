/** Tempo and beat detection from raw audio. Pure maths, no dependencies. */

export interface BeatResult {
  bpm: number | null
  /** Beat times in seconds. */
  beats: number[]
}

const HOP_SECONDS = 0.01

/** Onset strength: how much louder each 10 ms hop is than the one before (never negative). */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS))
  const frames = Math.floor(samples.length / hop)
  const env = new Float32Array(frames)
  let prev = 0
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * hop, end = i + hop; i < end; i++) sum += samples[i] * samples[i]
    const energy = Math.log1p(1000 * Math.sqrt(sum / hop))
    env[f] = Math.max(0, energy - prev)
    prev = energy
  }
  return env
}

export function detectBeats(samples: Float32Array, sampleRate: number): BeatResult {
  const env = onsetEnvelope(samples, sampleRate)
  const n = env.length
  if (n < 400) return { bpm: null, beats: [] } // under 4 seconds: not enough to judge a tempo

  let mean = 0
  for (const v of env) mean += v
  mean /= n
  if (mean < 1e-4) return { bpm: null, beats: [] }
  const x = env.map((v) => v - mean)

  // Autocorrelation over lags for 60-200 BPM; prefer tempos near 120 as humans do.
  const minLag = Math.round(60 / 200 / HOP_SECONDS)
  const maxLag = Math.round(60 / 60 / HOP_SECONDS)
  let bestLag = 0
  let bestScore = -Infinity
  let zero = 0
  for (let i = 0; i < n; i++) zero += x[i] * x[i]
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i + lag < n; i++) sum += x[i] * x[i + lag]
    const bpm = 60 / (lag * HOP_SECONDS)
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2)
    const score = (sum / (n - lag)) * prior
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  // A weak periodicity means there is no steady beat (speech, ambience).
  if (bestLag === 0 || bestScore / (zero / n) < 0.08) return { bpm: null, beats: [] }

  // Refine the period beyond the 10 ms grid by also scoring neighbouring half-steps.
  let period = bestLag
  let best = -Infinity
  let bestPhase = 0
  for (let p = bestLag - 0.5; p <= bestLag + 0.5; p += 0.1) {
    for (let phase = 0; phase < p; phase++) {
      let sum = 0
      let count = 0
      for (let t = phase; t < n; t += p) {
        sum += env[Math.round(t)] ?? 0
        count++
      }
      const s = sum / count
      if (s > best) {
        best = s
        period = p
        bestPhase = phase
      }
    }
  }
  const beats: number[] = []
  for (let t = bestPhase; t < n; t += period) beats.push(Math.round(t * HOP_SECONDS * 1000) / 1000)
  return { bpm: Math.round((60 / (period * HOP_SECONDS)) * 10) / 10, beats }
}
