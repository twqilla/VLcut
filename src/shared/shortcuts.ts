/** Keyboard shortcuts: the actions, their default keys, and the rules for reading and changing them. Pure, so it can be tested. */

export interface ShortcutDef {
  id: string
  label: string
  group: 'Playback' | 'Editing' | 'Selection' | 'View' | 'Project'
  /** Key combinations, e.g. "Ctrl+Shift+Z", "Space", "ArrowLeft". */
  keys: string[]
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'playPause', label: 'Play / pause', group: 'Playback', keys: ['Space'] },
  { id: 'stepBack', label: 'Back one frame', group: 'Playback', keys: ['ArrowLeft'] },
  { id: 'stepForward', label: 'Forward one frame', group: 'Playback', keys: ['ArrowRight'] },
  { id: 'back10', label: 'Back ten frames', group: 'Playback', keys: ['Shift+ArrowLeft'] },
  { id: 'forward10', label: 'Forward ten frames', group: 'Playback', keys: ['Shift+ArrowRight'] },
  { id: 'toStart', label: 'Go to the start', group: 'Playback', keys: ['Home'] },
  { id: 'toEnd', label: 'Go to the end', group: 'Playback', keys: ['End'] },
  { id: 'split', label: 'Split at the playhead', group: 'Editing', keys: ['S'] },
  { id: 'delete', label: 'Delete the selected clips', group: 'Editing', keys: ['Delete', 'Backspace'] },
  { id: 'undo', label: 'Undo', group: 'Editing', keys: ['Ctrl+Z'] },
  { id: 'redo', label: 'Redo', group: 'Editing', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'copy', label: 'Copy', group: 'Editing', keys: ['Ctrl+C'] },
  { id: 'paste', label: 'Paste', group: 'Editing', keys: ['Ctrl+V'] },
  { id: 'duplicate', label: 'Duplicate', group: 'Editing', keys: ['Ctrl+D'] },
  { id: 'nest', label: 'Nest the selected clips into one', group: 'Editing', keys: ['Ctrl+G'] },
  { id: 'unnest', label: 'Unnest (put the original clips back)', group: 'Editing', keys: ['Ctrl+Shift+G'] },
  { id: 'selectAll', label: 'Select all clips', group: 'Selection', keys: ['Ctrl+A'] },
  { id: 'deselect', label: 'Clear the selection', group: 'Selection', keys: ['Escape'] },
  { id: 'previewFocus', label: 'Focus the preview', group: 'View', keys: ['F'] },
  { id: 'zoomIn', label: 'Zoom the timeline in', group: 'View', keys: ['=', '+'] },
  { id: 'zoomOut', label: 'Zoom the timeline out', group: 'View', keys: ['-'] },
  { id: 'showShortcuts', label: 'Show the shortcut list', group: 'View', keys: ['?'] },
  { id: 'save', label: 'Save now', group: 'Project', keys: ['Ctrl+S'] }
]

export type Overrides = Record<string, string[]>

/** Key names, by the lower-case way people type them. */
const NAMED: Record<string, string> = {
  ' ': 'Space', space: 'Space', esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete', backspace: 'Backspace', enter: 'Enter', tab: 'Tab', home: 'Home', end: 'End', insert: 'Insert', pageup: 'PageUp', pagedown: 'PageDown',
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `F${i + 1}`]))
}

interface KeyEventLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }

/** "Ctrl+Shift+Z" for a keyboard event. Command on a Mac counts as Ctrl. Shift is left out for symbols, because the symbol already says it ("?" not "Shift+?"). */
export function comboFromEvent(e: KeyEventLike): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified'].includes(e.key)) return null
  const key = NAMED[e.key.toLowerCase()] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  const symbol = key.length === 1 && !/[A-Z0-9]/.test(key)
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey && !symbol ? 'Shift' : '', key].filter(Boolean).join('+')
}

/** Brings a combination typed or stored by hand into the same form `comboFromEvent` gives. Returns null if it is not a usable combination. */
export function normalizeCombo(text: string): string | null {
  const parts = text.split('+').map((p) => p.trim()).filter((p, i, a) => p || (i === a.length - 1 && text.endsWith('+')))
  const plus = text.endsWith('++') || text === '+'
  const words = plus ? [...text.slice(0, -1).split('+').map((p) => p.trim()).filter(Boolean), '+'] : parts
  if (!words.length || words.length > 4) return null
  const key = words[words.length - 1]
  const mods = words.slice(0, -1).map((m) => (/^(ctrl|control|cmd|command|meta)$/i.test(m) ? 'Ctrl' : /^alt|option$/i.test(m) ? 'Alt' : /^shift$/i.test(m) ? 'Shift' : ''))
  if (mods.some((m) => !m) || new Set(mods).size !== mods.length) return null
  if (/^(ctrl|control|cmd|command|meta|alt|option|shift)$/i.test(key)) return null
  const k = NAMED[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : '')
  if (!k || /[^\w=+\-?/.,;'\[\]\\`]/.test(k)) return null
  return [...(['Ctrl', 'Alt', 'Shift'] as const).filter((m) => mods.includes(m)), k].join('+')
}

/** Reads overrides from storage, dropping anything that is not a known action with usable combinations. */
export function sanitizeOverrides(raw: unknown): Overrides {
  const out: Overrides = {}
  if (!raw || typeof raw !== 'object') return out
  for (const def of SHORTCUTS) {
    const v = (raw as Record<string, unknown>)[def.id]
    if (!Array.isArray(v)) continue
    const keys = [...new Set(v.map((k) => (typeof k === 'string' ? normalizeCombo(k) : null)).filter((k): k is string => k !== null))].slice(0, 3)
    out[def.id] = keys
  }
  return out
}

export const keysFor = (id: string, overrides: Overrides): string[] => overrides[id] ?? SHORTCUTS.find((s) => s.id === id)?.keys ?? []

/** Combination → action, for the keys currently in effect. When two actions share a key the first in the list wins. */
export function bindingMap(overrides: Overrides): Map<string, string> {
  const map = new Map<string, string>()
  for (const def of SHORTCUTS) for (const k of keysFor(def.id, overrides)) if (!map.has(k)) map.set(k, def.id)
  return map
}

/** The action that already uses `combo`, if it is not `exceptId`. */
export function conflictFor(combo: string, overrides: Overrides, exceptId: string): ShortcutDef | undefined {
  const id = bindingMap(overrides).get(combo)
  return id && id !== exceptId ? SHORTCUTS.find((s) => s.id === id) : undefined
}

/** Sets an action's keys. With `steal`, a key another action used is taken from it. */
export function setKeys(overrides: Overrides, id: string, keys: string[], steal = false): Overrides {
  const next: Overrides = { ...overrides, [id]: keys }
  if (steal) for (const def of SHORTCUTS) if (def.id !== id) {
    const had = keysFor(def.id, next)
    if (had.some((k) => keys.includes(k))) next[def.id] = had.filter((k) => !keys.includes(k))
  }
  return next
}

/** "Split at playhead" + the first key of its action, e.g. "Split at playhead (S)". Reads the same way the tooltips parse. */
export const withKey = (text: string, id: string, overrides: Overrides): string => {
  const k = keysFor(id, overrides)[0]
  return k ? `${text} (${k})` : text
}

/** Whether a key press should be left to a text field. */
export const isTypingKey = (combo: string): boolean => !combo.includes('Ctrl') && (combo.length === 1 || combo.startsWith('Shift+') && combo.length === 7 || combo === 'Backspace' || combo === 'Delete' || combo === 'Space' || combo.startsWith('Arrow') || combo === 'Home' || combo === 'End')
