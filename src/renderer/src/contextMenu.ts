import { create } from 'zustand'

export interface MenuItem { label: string; run?: () => void; disabled?: boolean; danger?: boolean; separator?: boolean; hint?: string }

/** The right-click menu that is open, if any. */
export const useMenu = create<{ at: { x: number; y: number } | null; items: MenuItem[] }>(() => ({ at: null, items: [] }))
export const openMenu = (x: number, y: number, items: MenuItem[]): void => useMenu.setState({ at: { x, y }, items })
export const closeMenu = (): void => useMenu.setState({ at: null, items: [] })
