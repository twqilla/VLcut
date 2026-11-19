/** Builds the live-preview Web Audio chain for a clip's audio effects (the export uses FFmpeg for the same definitions). */
import type { PreviewNode } from '@shared/effects/audio'

export interface Chain {
  input: AudioNode
  output: AudioNode
  /** Disconnects everything and stops oscillators. */
  dispose(): void
}

import pitchWorkletUrl from './pitchWorklet.js?url'

const ready = new WeakSet<BaseAudioContext>()
/** True once the pitch shifter has been loaded into `ctx` (it loads in the background when the context is made). */
export const workletsReady = (ctx: BaseAudioContext): boolean => ready.has(ctx)
export async function loadWorklets(ctx: AudioContext): Promise<void> {
  try {
    await ctx.audioWorklet.addModule(pitchWorkletUrl)
    ready.add(ctx)
  } catch {
    // Without it the preview plays pitch changes unshifted; the export is unaffected.
  }
}

// ffmpeg's aecho scales the input by 0.9 and the whole result by 0.9; the preview does the same so levels match.
const ECHO_LEVEL = 0.9 * 0.9

export function buildChain(ctx: AudioContext, nodes: PreviewNode[]): Chain {
  const created: AudioNode[] = []
  const stoppers: OscillatorNode[] = []
  const track = <T extends AudioNode>(n: T): T => (created.push(n), n)
  const input = track(ctx.createGain())
  let tail: AudioNode = input
  const append = (first: AudioNode, last: AudioNode = first): void => {
    tail.connect(first)
    tail = last
  }
  for (const spec of nodes) {
    switch (spec.kind) {
      case 'biquad': {
        const f = track(ctx.createBiquadFilter())
        f.type = spec.type
        f.frequency.value = spec.freq
        f.Q.value = spec.q
        f.gain.value = spec.gain
        append(f)
        break
      }
      case 'compressor': {
        const c = track(ctx.createDynamicsCompressor())
        c.threshold.value = spec.threshold
        c.ratio.value = spec.ratio
        c.attack.value = Math.min(1, Math.max(0, spec.attack))
        c.release.value = Math.min(1, Math.max(0, spec.release))
        c.knee.value = 0
        append(c)
        break
      }
      case 'gain': {
        const g = track(ctx.createGain())
        g.gain.value = spec.gain
        append(g)
        break
      }
      case 'shaper': {
        const s = track(ctx.createWaveShaper())
        const curve = new Float32Array(2048)
        for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 4 * spec.drive)
        s.curve = curve
        // The curve spans -4..4, so the signal is scaled to match before and after.
        const pre = track(ctx.createGain())
        pre.gain.value = 1 / 4
        append(pre, pre)
        pre.connect(s)
        tail = s
        break
      }
      case 'taps': {
        const sum = track(ctx.createGain())
        const dry = track(ctx.createGain())
        dry.gain.value = ECHO_LEVEL
        const split = track(ctx.createGain())
        tail.connect(split)
        split.connect(dry).connect(sum)
        for (const [ms, decay] of spec.taps) {
          const d = track(ctx.createDelay(2))
          d.delayTime.value = ms / 1000
          const g = track(ctx.createGain())
          g.gain.value = ECHO_LEVEL * Math.min(1, decay)
          split.connect(d).connect(g).connect(sum)
        }
        tail = sum
        break
      }
      case 'tremolo': {
        const g = track(ctx.createGain())
        g.gain.value = 1 - spec.depth / 2
        const osc = ctx.createOscillator()
        osc.frequency.value = spec.freq
        const amount = track(ctx.createGain())
        amount.gain.value = spec.depth / 2
        osc.connect(amount).connect(g.gain)
        osc.start()
        stoppers.push(osc)
        append(g)
        break
      }
      case 'pitch': {
        if (!workletsReady(ctx)) break
        const node = track(new AudioWorkletNode(ctx, 'vlcut-pitch', { outputChannelCount: [2], parameterData: { semitones: spec.semitones } }))
        append(node)
        break
      }
      case 'matrix': {
        const stereo = track(ctx.createGain())
        stereo.channelCount = 2
        stereo.channelCountMode = 'explicit'
        const split = track(ctx.createChannelSplitter(2))
        const merge = track(ctx.createChannelMerger(2))
        tail.connect(stereo).connect(split)
        const [ll, lr, rl, rr] = spec.m
        // Output left = ll·L + lr·R, output right = rl·L + rr·R.
        ;([[0, 0, ll], [1, 0, lr], [0, 1, rl], [1, 1, rr]] as [number, number, number][]).forEach(([from, to, gain]) => {
          const g = track(ctx.createGain())
          g.gain.value = gain
          split.connect(g, from).connect(merge, 0, to)
        })
        tail = merge
        break
      }
    }
  }
  return {
    input,
    output: tail,
    dispose() {
      for (const o of stoppers) {
        try { o.stop() } catch { /* already stopped */ }
        o.disconnect()
      }
      for (const n of created) n.disconnect()
    }
  }
}
