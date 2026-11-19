import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { beginSession, endSession, noteProject } from '../src/main/session'

const dir = (): string => mkdtempSync(join(tmpdir(), 'session-'))

test('a clean quit leaves nothing to recover; a crash remembers the open project', () => {
  const d = dir()
  expect(beginSession(d)).toEqual({ unclean: false })
  noteProject(d, { id: 'p1', name: 'My film' })
  endSession(d) // normal quit
  expect(existsSync(join(d, 'session.json'))).toBe(false)
  expect(beginSession(d).unclean).toBe(false)

  noteProject(d, { id: 'p2', name: 'Holiday' })
  // ...the app crashes here: no endSession...
  expect(beginSession(d)).toEqual({ unclean: true, lastProject: { id: 'p2', name: 'Holiday' } })
  // After a crash and a restart that is then closed normally, the next start is clean again.
  endSession(d)
  expect(beginSession(d).unclean).toBe(false)
})

test('closing a project clears it, and a damaged marker never blocks start-up', () => {
  const d = dir()
  beginSession(d)
  noteProject(d, { id: 'p', name: 'x' })
  noteProject(d, null)
  expect(beginSession(d)).toEqual({ unclean: true, lastProject: undefined })
  writeFileSync(join(d, 'session.json'), '{not json')
  expect(beginSession(d)).toEqual({ unclean: false })
})
