/** Prints the exact argument list the editor would send to interpolini-cli (used by the Windows build to test the real program). */
import { DEFAULT_INTERPOLINI, interpoliniArgs } from '../src/shared/render/interpolini'

const clip = process.argv[2] ?? 'trial.mp4'
// A varied set: a custom weighting, a rate given as a multiple, gamma, half-size search off, dedup on.
console.log(JSON.stringify(interpoliniArgs({ ...DEFAULT_INTERPOLINI, fps: 'x4', weighting: 'custom', custom: [1, 2, 5], gamma: 1.2, half: false, intensity: 1.5 }, 30, clip)))
