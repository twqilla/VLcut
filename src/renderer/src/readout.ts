/** A small floating readout that follows the pointer while something is dragged, e.g. how far a clip is from the centre. */
import { create } from 'zustand'

interface ReadoutState {
  visible: boolean
  x: number
  y: number
  lines: string[]
  /** Whether the dragged thing sits exactly on the vertical / horizontal centre line. */
  onCentreX: boolean
  onCentreY: boolean
  /** The picture's centre guides are drawn only while dragging. */
  guides: boolean
}

export const useReadout = create<ReadoutState>(() => ({ visible: false, x: 0, y: 0, lines: [], onCentreX: false, onCentreY: false, guides: false }))

const sign = (n: number): string => (n > 0 ? '+' : n < 0 ? '−' : '')

/** "X +120 px", "Y −45 px" for an offset given as fractions of the frame (positive = right / down). */
export function formatOffset(fx: number, fy: number, width: number, height: number): { lines: string[]; onCentreX: boolean; onCentreY: boolean } {
  const [px, py] = [Math.round(fx * width), Math.round(fy * height)]
  const line = (axis: string, v: number, frac: number): string => (v === 0 ? `${axis} 0 px · centred` : `${axis} ${sign(v)}${Math.abs(v)} px (${sign(v)}${Math.abs(frac * 100).toFixed(1)} %)`)
  return { lines: [line('X', px, fx), line('Y', py, fy)], onCentreX: px === 0, onCentreY: py === 0 }
}

export function showReadout(clientX: number, clientY: number, lines: string[], extra: Partial<Pick<ReadoutState, 'onCentreX' | 'onCentreY' | 'guides'>> = {}): void {
  useReadout.setState({ visible: true, x: clientX, y: clientY, lines, guides: extra.guides ?? false, onCentreX: extra.onCentreX ?? false, onCentreY: extra.onCentreY ?? false })
}

export function hideReadout(): void {
  useReadout.setState({ visible: false, guides: false })
}
