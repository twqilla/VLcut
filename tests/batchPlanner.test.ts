import { expect, test } from 'vitest'
import { planRequest } from '../src/shared/agent/planner'
import { planBatch } from '../src/shared/agent/planner3'
import type { Project } from '../src/shared/types'

const empty: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [], tracks: [] }
const tools = (r: string): string[] => planRequest(r, empty).steps.map((s) => s.tool)
const one = (r: string, tool: string) => planRequest(r, empty).steps.find((s) => s.tool === tool)

test('cut all clips to N seconds, in many wordings', () => {
  for (const r of ['Cut all clips to 7 seconds', 'trim every clip to 7s', 'Shorten each clip to 7 seconds', 'limit all my videos to 7 seconds', 'make every clip max 7 seconds', 'cap all clips at 7 seconds', 'Trim all the clips down to 7 sec']) {
    const s = one(r, 'trimClips')
    expect(s?.args.seconds, r).toBe(7)
    expect(tools(r), r).not.toContain('trimTo')
  }
  expect(one('cut all clips to 7 seconds and keep the last part', 'trimClips')?.args.keep).toBe('end')
  expect(one('keep the first 5 seconds of every clip', 'trimClips')?.args).toMatchObject({ seconds: 5, keep: 'start' })
  expect(one('trim all clips to 2 minutes', 'trimClips')?.args.seconds).toBe(120)
  expect(one('make every photo 3 seconds', 'trimClips')?.args).toMatchObject({ seconds: 3, photos: 1 })
  expect(one('trim the selected clips to 4 seconds', 'trimClips')?.args.scope).toBe('selected')
})

test('the whole-timeline trim still works and is not confused with the batch one', () => {
  expect(tools('Trim it to 30 seconds')).toEqual(['trimTo'])
  expect(tools('make it 15 seconds')).not.toContain('trimClips')
})

test('split, remove short clips, sort, shuffle, fade, fill', () => {
  expect(one('Split every clip every 5 seconds', 'splitEvery')?.args.seconds).toBe(5)
  expect(one('cut the clips into 10 second pieces', 'splitEvery')?.args.seconds).toBe(10)
  expect(one('remove clips shorter than 2 seconds', 'removeShort')?.args.seconds).toBe(2)
  expect(one('delete all clips under 1.5 seconds', 'removeShort')?.args.seconds).toBe(1.5)
  expect(one('sort the clips by length', 'sortClips')?.args.by).toBe('length')
  expect(one('arrange clips longest first', 'sortClips')?.args.by).toBe('longest')
  expect(one('sort clips by name', 'sortClips')?.args.by).toBe('name')
  expect(one('shuffle the clips', 'sortClips')?.args.by).toBe('shuffle')
  expect(one('fade every clip in and out', 'fadeEach')?.args.seconds).toBe(0.5)
  expect(one('add a 1 second fade to each clip', 'fadeEach')?.args.seconds).toBe(1)
  expect(tools('fade every clip in and out')).not.toContain('fade')
  expect(tools('fill the frame')).toContain('fillFrame')
  expect(tools('remove the black bars')).toContain('fillFrame')
})

test('remove every item of a kind without adding any', () => {
  expect(one('remove all text', 'removeKind')?.args.kind).toBe('text')
  expect(one('delete all the captions', 'removeKind')?.args.kind).toBe('captions')
  expect(tools('delete all the captions')).not.toContain('addCaptions')
  expect(one('remove every transition', 'removeKind')?.args.kind).toBe('transitions')
  expect(tools('remove every transition')).not.toContain('addTransitions')
  expect(one('clear all the shapes', 'removeKind')?.args.kind).toBe('shapes')
})

test('render each clip with a configuration', () => {
  const s = one('Render all clips at 1080p 60fps h265', 'renderClips')!
  expect(JSON.parse(String(s.args.spec))).toEqual({ short: 1080, fps: 60, codec: 'h265' })
  expect(JSON.parse(String(one('export each clip for tiktok', 'renderClips')!.args.spec))).toEqual({ presetId: 'tiktok' })
  expect(JSON.parse(String(one('render every clip separately in 4k', 'renderClips')!.args.spec))).toEqual({ short: 2160 })
  // The words of the render clause are not also edits.
  expect(tools('render each clip for tiktok')).toEqual(['renderClips'])
  expect(tools('render all clips as small files for discord')).toEqual(['renderClips'])
})

test('export the whole project with a configuration', () => {
  expect(JSON.parse(String(one('Export the project as 4k', 'exportProject')!.args.spec))).toEqual({ short: 2160 })
  expect(JSON.parse(String(one('render the video in 720p', 'exportProject')!.args.spec))).toEqual({ short: 720 })
  expect(tools('export for youtube')).toEqual(['exportProject'])
})

test('batch edits combine with ordinary ones in a sensible order', () => {
  const t = tools('cut all clips to 5 seconds, make it cinematic and render each clip in 1080p')
  expect(t[0]).toBe('trimClips')
  expect(t).toContain('applyStyle')
  expect(t[t.length - 1]).toBe('renderClips')
})

test('ordinary requests are untouched', () => {
  for (const r of ['Make it cinematic', 'Add a neon title saying "Summer"', 'Make it vertical for TikTok', 'Cut to the beat', 'Remove the silences', 'Add captions']) expect(planBatch(r.toLowerCase()).steps, r).toEqual([])
})
