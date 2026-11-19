/** Keeps playback smooth by lowering the preview resolution when drawing a frame takes longer than the frame time allows. */
import { create } from 'zustand'

export const QUALITY_STEPS = [1, 0.5, 0.25]

/**
 * Feed it the time each drawn frame took while playing. It says "lower" when most recent frames overran
 * their time budget, then waits before judging again so one step has time to take effect.
 */
export class QualityGovernor {
  private recent: boolean[] = []
  private cooldown = 0

  constructor(private window = 20, private overrunsNeeded = 12, private pause = 60) {}

  sample(frameMs: number, budgetMs: number): 'lower' | null {
    if (this.cooldown > 0) {
      this.cooldown--
      return null
    }
    this.recent.push(frameMs > budgetMs * 1.15)
    if (this.recent.length > this.window) this.recent.shift()
    if (this.recent.length === this.window && this.recent.filter(Boolean).length >= this.overrunsNeeded) {
      this.recent = []
      this.cooldown = this.pause
      return 'lower'
    }
    return null
  }

  reset(): void {
    this.recent = []
    this.cooldown = 0
  }
}

interface QualityState {
  /** 'auto' lowers the quality when playback struggles; a number is the person's own choice. */
  mode: 'auto' | number
  scale: number
  /** Set when auto mode lowered the quality, so the interface can say so. */
  note: string
  choose(mode: 'auto' | number): void
  lower(): void
}

export const useQuality = create<QualityState>((set, get) => ({
  mode: 'auto',
  scale: 0.5,
  note: '',
  choose: (mode) => set({ mode, scale: mode === 'auto' ? 0.5 : mode, note: '' }),
  lower() {
    const { mode, scale } = get()
    if (mode !== 'auto') return
    const next = QUALITY_STEPS.filter((s) => s < scale - 1e-6)[0]
    if (next) set({ scale: next, note: `Playback was struggling, so the preview dropped to ${next === 0.25 ? 'quarter' : 'half'} resolution. The export is not affected.` })
  }
}))
