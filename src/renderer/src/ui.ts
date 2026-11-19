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
  /** Counts requests to open Settings at the shortcut list (the ? key). */
  shortcutRequests: number
}

function load(): UiState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { libraryCollapsed: raw.libraryCollapsed === true, previewFocus: false, collapsedSections: Array.isArray(raw.collapsedSections) ? raw.collapsedSections.filter((s: unknown) => typeof s === 'string').slice(0, 60) : [], fitRows: raw.fitRows !== false, showTags: raw.showTags !== false, textEditorOpen: false, shortcutRequests: 0 }
  } catch {
    return { libraryCollapsed: false, previewFocus: false, collapsedSections: [], fitRows: true, showTags: true, textEditorOpen: false, shortcutRequests: 0 }
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
export const setTextEditor = (v: boolean): void => useUi.setState({ textEditorOpen: v })
export const requestShortcutList = (): void => useUi.setState((s) => ({ shortcutRequests: s.shortcutRequests + 1 }))
export const togglePreviewFocus = (): void => useUi.setState((s) => ({ previewFocus: !s.previewFocus }))
export function toggleSection(title: string): void {
  useUi.setState((s) => ({ collapsedSections: s.collapsedSections.includes(title) ? s.collapsedSections.filter((t) => t !== title) : [...s.collapsedSections, title] }))
  persist()
}
export const setFitRows = (v: boolean): void => { useUi.setState({ fitRows: v }); persist() }
