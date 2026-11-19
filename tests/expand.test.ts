import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { expandDroppedPaths } from '../src/main/media/expand'

test('a dropped folder becomes the media files inside it, in natural order, skipping other files and hidden ones', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drop-'))
  try {
    mkdirSync(join(dir, 'trip', 'day 2'), { recursive: true })
    for (const f of ['trip/clip10.mp4', 'trip/clip2.mp4', 'trip/notes.txt', 'trip/.hidden.mp4', 'trip/day 2/b.mov', 'trip/day 2/photo.JPG', 'loose.wav']) writeFileSync(join(dir, f), 'x')
    const out = await expandDroppedPaths([join(dir, 'trip'), join(dir, 'loose.wav'), join(dir, 'missing.mp4'), join(dir, 'trip/notes.txt')])
    const rel = out.map((p) => p.slice(dir.length + 1))
    expect(rel).toEqual(['trip/clip2.mp4', 'trip/clip10.mp4', 'trip/day 2/b.mov', 'trip/day 2/photo.JPG', 'loose.wav', 'trip/notes.txt'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('there is a limit on how many files a folder can add', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drop-'))
  try {
    for (let i = 0; i < 520; i++) writeFileSync(join(dir, `c${String(i).padStart(3, '0')}.mp4`), 'x')
    expect((await expandDroppedPaths([dir])).length).toBe(500)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
