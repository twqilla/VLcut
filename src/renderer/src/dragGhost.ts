import { create } from 'zustand'

/** A faint copy of what is being dragged, shown on the timeline where it would land (instead of a dark overlay). */
export const useGhost = create<{ trackId: string | null; time: number; duration: number; label: string }>(() => ({ trackId: null, time: 0, duration: 0, label: '' }))
export const clearGhost = (): void => useGhost.setState({ trackId: null })

/** What is being dragged from inside the app (the browser hides drag data until the drop, so it is kept here). */
export const dragPayload: { duration: number; label: string } = { duration: 3, label: '' }

export const TEXT_MIME = 'application/x-vlcut-text'
