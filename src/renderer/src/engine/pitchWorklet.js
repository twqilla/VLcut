/*
 * Live-preview pitch shifter (an AudioWorklet): two read points sweep through a short delay line at a different speed
 * than the write point, each faded in and out with a Hann window so the pair always sums to full level. Pitch changes
 * and the speed does not. The export uses FFmpeg's resample-and-stretch for the same setting, so the two sound alike
 * but are not identical.
 */
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'semitones', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' }]
  }

  constructor() {
    super()
    this.window = 2048
    this.size = 8192
    this.buffers = [new Float32Array(this.size), new Float32Array(this.size)]
    this.write = 0
    this.phase = 0
  }

  read(buffer, position) {
    const mask = this.size - 1
    const i = Math.floor(position)
    const f = position - i
    return buffer[i & mask] * (1 - f) + buffer[(i + 1) & mask] * f
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || !output.length) return true
    const ratio = Math.pow(2, parameters.semitones[0] / 12)
    const step = 1 - ratio
    const W = this.window
    const mask = this.size - 1
    const frames = output[0].length
    for (let n = 0; n < frames; n++) {
      for (let c = 0; c < 2; c++) {
        const src = input && input.length ? input[Math.min(c, input.length - 1)] : null
        this.buffers[c][this.write & mask] = src ? src[n] : 0
      }
      const a = this.phase
      const b = (this.phase + W / 2) % W
      const wa = 0.5 - 0.5 * Math.cos((2 * Math.PI * a) / W)
      const wb = 0.5 - 0.5 * Math.cos((2 * Math.PI * b) / W)
      for (let c = 0; c < output.length; c++) {
        const buf = this.buffers[Math.min(c, 1)]
        output[c][n] = this.read(buf, this.write - a - 1) * wa + this.read(buf, this.write - b - 1) * wb
      }
      this.phase += step
      if (this.phase < 0) this.phase += W
      else if (this.phase >= W) this.phase -= W
      this.write++
    }
    return true
  }
}

registerProcessor('vlcut-pitch', PitchShiftProcessor)
