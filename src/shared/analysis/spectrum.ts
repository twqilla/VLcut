/** Turns audio into a few dozen frequency bands per video frame, for the audio visualiser. Pure maths. */

export interface Spectrum {
  bands: number
  /** Frames per second of audio. */
  fps: number
  /** frames × bands values, 0..255 (loudness of that band in that frame). */
  data: Uint8Array
}

const FFT_SIZE = 1024

/** In-place radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const [wr, wi] = [Math.cos(ang), Math.sin(ang)]
    for (let i = 0; i < n; i += len) {
      let [cr, ci] = [1, 0]
      for (let k = 0; k < len / 2; k++) {
        const [a, b] = [i + k, i + k + len / 2]
        const [tr, ti] = [re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr]
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        ;[cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr]
      }
    }
  }
}

/** Band edges (bin indices) spaced evenly on a log scale between `low` and `high` Hz. */
export function bandEdges(bands: number, rate: number, low = 50, high = 12000): number[] {
  const top = Math.min(high, rate / 2 - 1)
  const binHz = rate / FFT_SIZE
  const edges: number[] = []
  for (let b = 0; b <= bands; b++) edges.push(Math.max(1, Math.round((low * (top / low) ** (b / bands)) / binHz)))
  // Every band owns at least one bin.
  for (let b = 1; b <= bands; b++) edges[b] = Math.max(edges[b], edges[b - 1] + 1)
  return edges
}

export function spectrumOf(samples: Float32Array, rate: number, fps = 30, bands = 48): Spectrum {
  const frames = Math.max(1, Math.floor(samples.length / rate * fps))
  const data = new Uint8Array(frames * bands)
  const edges = bandEdges(bands, rate)
  const window = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
  const [re, im] = [new Float64Array(FFT_SIZE), new Float64Array(FFT_SIZE)]
  for (let f = 0; f < frames; f++) {
    // Analyse the window centred on this frame's time.
    const start = Math.round((f / fps) * rate) - FFT_SIZE / 2
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = samples[start + i] ?? 0
      re[i] = s * window[i]
      im[i] = 0
    }
    fft(re, im)
    for (let b = 0; b < bands; b++) {
      let peak = 0
      for (let k = edges[b]; k < edges[b + 1]; k++) peak = Math.max(peak, Math.hypot(re[k], im[k]))
      // Magnitude (2/N scaled, Hann-corrected) to decibels, then -70..0 dB mapped to 0..255.
      const mag = (peak * 4) / FFT_SIZE
      const dB = 20 * Math.log10(mag + 1e-9)
      data[f * bands + b] = Math.max(0, Math.min(255, Math.round(((dB + 70) / 70) * 255)))
    }
  }
  return { bands, fps, data }
}
