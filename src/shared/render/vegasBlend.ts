/**
 * Vegas-style resampling: each output frame covers one frame interval; the source frames that fall inside it are blended.
 * For an even ratio (240 fps footage into 60 fps is 4:1) the two frames on the edges of the interval count half, so the
 * weights are 1, 2, 2, 2, 1; for an odd ratio every frame counts the same. Intensity scales the length of the window.
 */
import { blendWeights } from './interpolini'

export interface BlendWindow {
  /** Seconds from the middle of the output frame to each source moment, oldest first. */
  offsets: number[]
  /** Weights of those moments; they add up to 1. */
  weights: number[]
}

export function vegasWindow(sourceFps: number, outFps: number, intensity: number): BlendWindow {
  const weights = blendWeights(Math.max(1, sourceFps), Math.max(1, outFps), intensity, 'vegas')
  const n = weights.length
  // Source frames sit one source interval apart, centred on the output frame.
  return { offsets: weights.map((_, k) => (k - (n - 1) / 2) / sourceFps), weights }
}
