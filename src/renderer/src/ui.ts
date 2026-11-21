/** Small interface state that is not part of the theme: collapsed panels, preview focus. Remembered between sessions. */
import { create } from 'zustand'

const KEY = 'vlcut:ui'

interface UiState {
  /** The library shows only its tab row, giving the height to the timeline. */
  libraryCollapsed: boolean
  /** The preview takes most of the width and the properties panel steps aside. */
  previewFocus: boolean
  /** Properties sections the person has collapsed, by title. */
  collapsedSections: string[]
  /** Track rows grow to fill spare height in the timeline. */
  fitRows: boolean
  /** Little bars under each clip show what was added to it (effects, looks, speed...), each with an × to take it off. */
  showTags: boolean
  /** The text editor window over the preview is open (it shows when one text clip is selected). */
  textEditorOpen: boolean
  /** The in and out marks (I and O): the part of the timeline that is exported when "export only the selected region" is on. */
  rangeIn: number | null
  rangeOut: number | null
  /** Counts requests to open Settings at the shortcut list (the ? key). */
  shortcutRequests: number
  /** Position editing in the preview is off until this is switched on, so a stray drag never moves a clip. */
  previewEdit: boolean
  /** The view of the preview (1 = the whole picture fits). Kept while clips change; separate from any clip's own scale. */
  viewZoom: number
  viewX: number
  viewY: number
}
const VIEW = { previewEdit: false, viewZoom: 1, viewX: 0, viewY: 0 }

function load(): UiState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { libraryCollapsed: raw.libraryCollapsed === true, previewFocus: false, collapsedSections: Array.isArray(raw.collapsedSections) ? raw.collapsedSections.filter((s: unknown) => typeof s === 'string').slice(0, 60) : [], fitRows: raw.fitRows !== false, showTags: raw.showTags !== false, textEditorOpen: false, rangeIn: null, rangeOut: null, shortcutRequests: 0, ...VIEW }
  } catch {
    return { libraryCollapsed: false, previewFocus: false, collapsedSections: [], fitRows: true, showTags: true, textEditorOpen: false, rangeIn: null, rangeOut: null, shortcutRequests: 0, ...VIEW }
  }
}

export const useUi = create<UiState>(() => load())

function persist(): void {
  const { libraryCollapsed, collapsedSections, fitRows, showTags } = useUi.getState()
  try {
    localStorage.setItem(KEY, JSON.stringify({ libraryCollapsed, collapsedSections, fitRows, showTags }))
  } catch {
    // The choice still applies for this session.
  }
}

export const setLibraryCollapsed = (v: boolean): void => { useUi.setState({ libraryCollapsed: v }); persist() }
export const setShowTags = (v: boolean): void => { useUi.setState({ showTags: v }); persist() }
/** Sets the in mark (and moves the out mark after it if it would end up before it). */
export const markIn = (t: number): void => useUi.setState((s) => ({ rangeIn: t, rangeOut: s.rangeOut !== null && s.rangeOut <= t + 0.03 ? null : s.rangeOut }))
export const markOut = (t: number): void => useUi.setState((s) => ({ rangeOut: t, rangeIn: s.rangeIn !== null && s.rangeIn >= t - 0.03 ? null : s.rangeIn }))
export const clearRange = (): void => useUi.setState({ rangeIn: null, rangeOut: null })
export const setTextEditor = (v: boolean): void => useUi.setState({ textEditorOpen: v })
export const requestShortcutList = (): void => useUi.setState((s) => ({ shortcutRequests: s.shortcutRequests + 1 }))
export const togglePreviewFocus = (): void => useUi.setState((s) => ({ previewFocus: !s.previewFocus }))
export function toggleSection(title: string): void {
  useUi.setState((s) => ({ collapsedSections: s.collapsedSections.includes(title) ? s.collapsedSections.filter((t) => t !== title) : [...s.collapsedSections, title] }))
  persist()
}
export const setFitRows = (v: boolean): void => { useUi.setState({ fitRows: v }); persist() }
export const setPreviewEdit = (v: boolean): void => useUi.setState({ previewEdit: v })
export const resetView = (): void => useUi.setState({ viewZoom: 1, viewX: 0, viewY: 0 })
/** Zooms the view towards a point (offsets from the stage centre, in screen pixels) so the spot under the pointer stays put. */
export function zoomView(factor: number, px = 0, py = 0): void {
  useUi.setState((s) => {
    const z = Math.max(0.25, Math.min(16, s.viewZoom * factor))
    if (z === 1) return { viewZoom: 1, viewX: 0, viewY: 0 }
    const f = z / s.viewZoom
    return { viewZoom: z, viewX: px - (px - s.viewX) * f, viewY: py - (py - s.viewY) * f }
  })
}
export const panView = (dx: number, dy: number): void => useUi.setState((s) => ({ viewX: s.viewX + dx, viewY: s.viewY + dy }))
