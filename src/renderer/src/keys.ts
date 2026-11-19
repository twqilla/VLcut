/** The person's keyboard shortcut changes, remembered between sessions. See shared/shortcuts for the rules. */
import { create } from 'zustand'
import { type Overrides, SHORTCUTS, sanitizeOverrides } from '@shared/shortcuts'

const KEY = 'vlcut:shortcuts'

function load(): Overrides {
  try {
    return sanitizeOverrides(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return {}
  }
}

export const useKeys = create<{ overrides: Overrides }>(() => ({ overrides: load() }))

function persist(o: Overrides): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o))
  } catch {
    // The change still applies for this session.
  }
}

export function setOverrides(overrides: Overrides): void {
  const clean = sanitizeOverrides(overrides)
  // Only keep what differs from the defaults.
  for (const def of SHORTCUTS) if (clean[def.id] && JSON.stringify(clean[def.id]) === JSON.stringify(def.keys)) delete clean[def.id]
  useKeys.setState({ overrides: clean })
  persist(clean)
}

export const resetShortcuts = (): void => setOverrides({})
