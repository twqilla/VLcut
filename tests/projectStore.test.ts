import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { ProjectStore } from '../src/main/projects/projectStore'
import { parseRate, probeMedia } from '../src/main/media/probe'
import { execFileSync } from 'node:child_process'

let root: string
let store: ProjectStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vlcut-'))
  store = new ProjectStore(root)
})
afterEach(() => rm(root, { recursive: true, force: true }))

test('create, save, load and list round-trip', async () => {
  const project = await store.create('  My film ')
  expect(project.name).toBe('My film')
  const saved = await store.save({ ...project, name: 'Renamed' })
  expect((await store.load(project.id)).name).toBe('Renamed')
  expect(saved.updatedAt >= project.updatedAt).toBe(true)
  expect(await store.list()).toMatchObject([{ id: project.id, name: 'Renamed', mediaCount: 0 }])
})

test('duplicate creates an independent copy; remove deletes', async () => {
  const a = await store.create('A')
  const b = await store.duplicate(a.id)
  expect(b.id).not.toBe(a.id)
  expect(b.name).toBe('A copy')
  await store.remove(a.id)
  expect((await store.list()).map((p) => p.id)).toEqual([b.id])
})

test('load recovers from a corrupt project file using the backup', async () => {
  const project = await store.create('Recover me')
  await store.save(project) // first save writes a backup of the created state
  await writeFile(join(root, project.id, 'project.json'), '{ truncated', 'utf8')
  expect((await store.load(project.id)).name).toBe('Recover me')
})

test('rejects ids that could escape the projects folder', async () => {
  await expect(store.load('../evil')).rejects.toThrow('Invalid project id')
})

test('project file is readable JSON', async () => {
  const project = await store.create('Plain')
  const raw = JSON.parse(await readFile(join(root, project.id, 'project.json'), 'utf8'))
  expect(raw.formatVersion).toBe(1)
})

test('parseRate handles fractional rates', () => {
  expect(parseRate('30000/1001')).toBe(29.97)
  expect(parseRate('0/0')).toBeUndefined()
})

test('probeMedia reads real video metadata', async () => {
  const file = join(root, 'clip.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=2:s=640x360:r=25', '-f', 'lavfi', '-i', 'sine=d=2', '-shortest', '-pix_fmt', 'yuv420p', file])
  const asset = await probeMedia(file)
  expect(asset).toMatchObject({ kind: 'video', width: 640, height: 360, fps: 25, hasAudio: true })
  expect(asset.duration).toBeCloseTo(2, 0)
  await expect(probeMedia(join(root, 'nope.mp4'))).rejects.toThrow()
})
