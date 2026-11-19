import { expect, test } from 'vitest'
import { parseTip } from '../src/renderer/src/tooltips'

test('a trailing shortcut becomes key caps; ordinary brackets stay text', () => {
  expect(parseTip('Split at playhead (S)')).toEqual({ text: 'Split at playhead', keys: ['S'] })
  expect(parseTip('Undo (Ctrl+Z)')).toEqual({ text: 'Undo', keys: ['Ctrl', 'Z'] })
  expect(parseTip('Redo (Ctrl+Shift+Z)')).toEqual({ text: 'Redo', keys: ['Ctrl', 'Shift', 'Z'] })
  expect(parseTip('Play / pause (Space)')).toEqual({ text: 'Play / pause', keys: ['Space'] })
  expect(parseTip('Previous frame (←)')).toEqual({ text: 'Previous frame', keys: ['←'] })
  expect(parseTip('Go to end (End)')).toEqual({ text: 'Go to end', keys: ['End'] })
  expect(parseTip('Delete (Del)').keys).toEqual(['Del'])
  expect(parseTip('Zoom (+ or -)')).toEqual({ text: 'Zoom', keys: ['+', '/', '-'] })
  expect(parseTip('Keeps the picture (it stays), removes sound')).toEqual({ text: 'Keeps the picture (it stays), removes sound', keys: [] })
  expect(parseTip('Preview quality (does not change the export)').keys).toEqual([])
  expect(parseTip('Plain tip')).toEqual({ text: 'Plain tip', keys: [] })
})
