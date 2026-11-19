import { expect, test } from 'vitest'
import { bindingMap, comboFromEvent, conflictFor, keysFor, normalizeCombo, sanitizeOverrides, setKeys, SHORTCUTS, withKey } from '../src/shared/shortcuts'

test('key events become readable combinations', () => {
  expect(comboFromEvent({ key: 'z', ctrlKey: true })).toBe('Ctrl+Z')
  expect(comboFromEvent({ key: 'Z', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+Z')
  expect(comboFromEvent({ key: 'z', metaKey: true })).toBe('Ctrl+Z') // Command on a Mac
  expect(comboFromEvent({ key: ' ' })).toBe('Space')
  expect(comboFromEvent({ key: 'ArrowLeft', shiftKey: true })).toBe('Shift+ArrowLeft')
  expect(comboFromEvent({ key: '?', shiftKey: true })).toBe('?') // the symbol already says Shift
  expect(comboFromEvent({ key: '+', shiftKey: true })).toBe('+')
  expect(comboFromEvent({ key: 's' })).toBe('S')
  expect(comboFromEvent({ key: 'Shift', shiftKey: true })).toBeNull() // a modifier alone is not a shortcut
  expect(comboFromEvent({ key: 'Control', ctrlKey: true })).toBeNull()
})

test('typed or stored combinations are normalised, and nonsense is refused', () => {
  expect(normalizeCombo('ctrl+shift+z')).toBe('Ctrl+Shift+Z')
  expect(normalizeCombo('Shift+Ctrl+Z')).toBe('Ctrl+Shift+Z')
  expect(normalizeCombo('cmd+s')).toBe('Ctrl+S')
  expect(normalizeCombo('space')).toBe('Space')
  expect(normalizeCombo('Ctrl++')).toBe('Ctrl++')
  expect(normalizeCombo('+')).toBe('+')
  for (const bad of ['', 'Ctrl+', 'Ctrl+Ctrl+Z', 'Foo+Z', 'Ctrl+Shift', '<script>', 'Ctrl+Alt+Shift+Meta+X']) expect(normalizeCombo(bad), bad).toBeNull()
})

test('every default is a valid combination and no two actions share a default', () => {
  const seen = new Map<string, string>()
  for (const s of SHORTCUTS) for (const k of s.keys) {
    expect(normalizeCombo(k), `${s.id} ${k}`).toBe(k)
    expect(seen.get(k), `${k} used by ${seen.get(k)} and ${s.id}`).toBeUndefined()
    seen.set(k, s.id)
  }
})

test('changing a key moves the action, keeps the others, and warns about a clash', () => {
  const none = {}
  expect(bindingMap(none).get('S')).toBe('split')
  expect(conflictFor('S', none, 'delete')?.id).toBe('split')
  expect(conflictFor('S', none, 'split')).toBeUndefined()
  expect(conflictFor('Q', none, 'split')).toBeUndefined()
  const moved = setKeys(none, 'split', ['X'])
  expect(bindingMap(moved).get('X')).toBe('split')
  expect(bindingMap(moved).has('S')).toBe(false) // the old key is free now
  expect(keysFor('undo', moved)).toEqual(['Ctrl+Z'])
  // Taking a key another action uses leaves that action without it.
  const stolen = setKeys(none, 'delete', ['S'], true)
  expect(bindingMap(stolen).get('S')).toBe('delete')
  expect(keysFor('split', stolen)).toEqual([])
  // An action may have no key at all.
  expect(keysFor('split', setKeys(none, 'split', []))).toEqual([])
})

test('stored overrides are cleaned and tooltips show the current key', () => {
  const o = sanitizeOverrides({ split: ['ctrl+k', 'x', 'bad key!!', 7], nonsense: ['A'], undo: 'Ctrl+Z', delete: [] })
  expect(o).toEqual({ split: ['Ctrl+K', 'X'], delete: [] })
  expect(sanitizeOverrides(null)).toEqual({})
  expect(withKey('Split at playhead', 'split', {})).toBe('Split at playhead (S)')
  expect(withKey('Split at playhead', 'split', { split: ['Q'] })).toBe('Split at playhead (Q)')
  expect(withKey('Split at playhead', 'split', { split: [] })).toBe('Split at playhead')
})
