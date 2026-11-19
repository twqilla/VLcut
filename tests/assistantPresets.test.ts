import { expect, test } from 'vitest'
import type { MediaAsset, Project } from '../src/shared/types'
import { clipFromAsset, makeTrack } from '../src/shared/timeline/model'
import * as ops from '../src/shared/timeline/ops'
import { planRequest, runStep } from '../src/shared/agent/planner'
import { ASSISTANT_PRESETS } from '../src/shared/agent/planner2'

const video: MediaAsset = { id: 'v', path: '/v.mp4', name: 'v.mp4', kind: 'video', duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true, sizeBytes: 1 }
const video2: MediaAsset = { ...video, id: 'v2', name: 'v2.mp4' }
const photo: MediaAsset = { id: 'p', path: '/p.jpg', name: 'p.jpg', kind: 'image', duration: 0, width: 1600, height: 900, hasAudio: false, sizeBytes: 1 }
const music: MediaAsset = { id: 'm', path: '/m.mp3', name: 'm.mp3', kind: 'audio', duration: 120, hasAudio: true, sizeBytes: 1 }

function project(): Project {
  const [v, a] = [makeTrack('video', 'Video 1'), makeTrack('audio', 'Audio 1')]
  let p: Project = { formatVersion: 1, id: 'p', name: 'p', createdAt: '', updatedAt: '', settings: { width: 1920, height: 1080, fps: 30 }, media: [video, video2, photo, music], tracks: [v, a] }
  p = ops.addClip(p, v.id, clipFromAsset(video, 0))
  p = ops.addClip(p, v.id, clipFromAsset(video2, 60))
  p = ops.addClip(p, v.id, clipFromAsset(photo, 120))
  p = ops.addClip(p, a.id, clipFromAsset(music, 0))
  return p
}

/** Plans and runs a request; asynchronous (analysis) steps are only reported. */
function run(request: string, start = project()) {
  const plan = planRequest(request, start)
  let p = start
  const summaries: string[] = []
  for (const step of plan.steps) {
    const r = runStep(p, step, {})
    p = r.project
    summaries.push(r.summary)
  }
  return { plan, project: p, summaries, tools: plan.steps.map((s) => s.tool) }
}
const clips = (p: Project) => p.tracks.flatMap((t) => t.clips)
const effects = (p: Project) => clips(p).flatMap((c) => c.effects.map((e) => e.type))

test('every preset is understood and does something', () => {
  let prompts = 0
  for (const g of ASSISTANT_PRESETS) {
    for (const prompt of g.prompts) {
      prompts++
      const { plan, tools } = run(prompt)
      expect(plan.notes.join(' '), prompt).not.toMatch(/did not recognise/)
      expect(tools.length + plan.notes.length + (plan.variants?.length ?? 0), prompt).toBeGreaterThan(0)
    }
  }
  expect(prompts).toBeGreaterThanOrEqual(80)
})

test('effects are found by their everyday names', () => {
  expect(effects(run('add a vignette and film grain').project)).toEqual(expect.arrayContaining(['vignette', 'grain']))
  expect(effects(run('make the green screen transparent').project)).toContain('chromaKey')
  expect(effects(run('add a lens flare and some bloom').project)).toEqual(expect.arrayContaining(['lensFlare', 'bloom']))
  const bg = effects(run('blur the background').project)
  expect(bg).toContain('backgroundBlur')
  expect(bg).not.toContain('blur')
  expect(effects(run('add letterbox bars').project)).toContain('letterbox')
  expect(effects(run('Make it film noir').project)).toEqual(expect.arrayContaining(['blackWhite', 'grain']))
  expect(effects(run('add a teal and orange grade').project)).toContain('colorWheels')
  expect(effects(run('add a drop shadow and rounded corners').project)).toEqual(expect.arrayContaining(['dropShadow', 'roundedCorners']))
})

test('colour requests nudge one colour effect', () => {
  const p = run('make it warmer and brighter').project
  const color = clips(p)[0].effects.find((e) => e.type === 'color')!
  expect(color.params.temperature).toBeCloseTo(0.25, 2)
  expect(color.params.exposure).toBeCloseTo(0.15, 2)
  expect(clips(p)[0].effects.filter((e) => e.type === 'color')).toHaveLength(1)
  // "slightly" halves it.
  expect(clips(run('make it slightly warmer').project)[0].effects[0].params.temperature).toBeCloseTo(0.125, 2)
})

test('text requests become styled text clips', () => {
  const p = run('Add a neon title saying "Summer 2026"').project
  const t = clips(p).find((c) => c.text)!
  expect(t.text!.content).toBe('Summer 2026')
  expect(t.text!.fontFamily).toBe('Orbitron')
  expect(t.text!.glowAmount).toBeGreaterThan(0)
  const gold = clips(run('Add a gold 3D title "The Grand Opening" at the start').project).find((c) => c.text)!
  expect(gold.text!.fillKind).toBe('gold')
  expect(gold.start).toBeLessThan(1)
  const lower = clips(run('Add a lower third "Alex Rivera, Director"').project).find((c) => c.text)!
  expect(lower.transform.y).toBeGreaterThan(0.2) // sits low in the frame
  const end = clips(run('Add a retro pixel text "Game Over" at the end').project).find((c) => c.text)!
  expect(end.text!.fontFamily).toBe('Press Start 2P')
  expect(end.start).toBeGreaterThan(100)
  const noQuote = run('add a title')
  expect(noQuote.plan.notes.join(' ')).toMatch(/in quotes/)
})

test('transitions are chosen by name', () => {
  for (const [ask, type] of [['add whip pan transitions', 'whip'], ['add glitch transitions', 'glitch'], ['add shatter transitions', 'shatter'], ['add dip to white transitions', 'dipWhite'], ['add liquid transitions', 'liquidTransition']]) {
    const { plan, project: p } = run(ask)
    expect(plan.steps.find((s) => s.tool === 'addTransitions')?.args.type, ask).toBe(type)
    expect(clips(p).some((c) => c.transitionIn?.type === type), ask).toBe(true)
  }
})

test('speed, reverse, freeze, ramp, fps and trimming', () => {
  expect(clips(run('make it slow motion').project)[0].speed).toBe(0.5)
  expect(clips(run('speed it up 2x').project)[0].speed).toBe(2)
  expect(clips(run('reverse the clip').project)[0].reversed).toBe(true)
  const ramp = run('add a speed ramp with a slow-motion hit in the middle').project
  expect(clips(ramp).filter((c) => c.assetId === 'v' || c.assetId === 'v2').length).toBeGreaterThan(10)
  const frozen = run('freeze the frame for 3 seconds at 10 seconds').project
  expect(clips(frozen).filter((c) => c.freeze)).toHaveLength(1)
  expect(clips(frozen).find((c) => c.freeze)!.duration).toBe(3)
  expect(run('make it 60 fps').project.settings.fps).toBe(60)
  expect(ops.projectDuration(run('trim it to 30 seconds').project)).toBeCloseTo(30, 3)
  expect(ops.projectDuration(run('trim it to half a minute').project)).toBeGreaterThan(0) // not understood as seconds: left alone, never broken
})

test('fades, volume, picture-in-picture, blend modes, camera and gaps', () => {
  const faded = clips(run('fade in from black and fade out at the end').project)
  expect(faded.some((c) => c.fadeIn > 0)).toBe(true)
  expect(faded.some((c) => c.fadeOut > 0)).toBe(true)
  const quiet = run('make the music quieter').project
  expect(clips(quiet).find((c) => c.assetId === 'm')!.volume).toBe(0.5)
  expect(clips(run('mute the music').project).find((c) => c.assetId === 'm')!.volume).toBe(0)
  const pip = clips(run('put the clip in a picture in picture at the top left').project)[0]
  expect(pip.transform.scale).toBeCloseTo(0.34, 2)
  expect(pip.transform.x).toBeLessThan(0)
  expect(pip.transform.y).toBeLessThan(0)
  expect(clips(run('make a double exposure').project)[0].blend).toBe('screen')
  expect(clips(run('set the blend mode to multiply').project)[0].blend).toBe('multiply')
  expect(run('stabilize the shaky footage').tools).toContain('stabilize')
  expect(run('auto reframe to follow the action').tools).toContain('reframe')
  const slide = run('add a ken burns effect to the photos').project
  expect(clips(slide).find((c) => c.assetId === 'p')!.effects.some((e) => e.type === 'kenBurns')).toBe(true)
  const gappy = ops.moveClip(project(), clips(project())[1].id, clips(project())[1].start > 0 ? project().tracks[0].id : '', 70)
  expect(run('close the gaps', gappy).summaries.join(' ')).toMatch(/Closed|no gaps/i)
  const cleared = run('remove all effects', run('add a vignette').project)
  expect(effects(cleared.project)).toHaveLength(0)
})

test('whole-edit recipes combine several tools', () => {
  const tiktok = run('Make a TikTok edit')
  expect(tiktok.project.settings).toMatchObject({ width: 1080, height: 1920 })
  expect(tiktok.tools).toEqual(expect.arrayContaining(['setFormat', 'reframe', 'applyStyle', 'changePacing']))
  const trailer = run('Make a cinematic movie trailer')
  expect(effects(trailer.project)).toContain('letterbox')
  expect(clips(trailer.project).some((c) => c.text?.content === 'COMING SOON')).toBe(true)
  expect(run('Make a photo slideshow').tools).toEqual(expect.arrayContaining(['kenBurns', 'addTransitions']))
})

test('selected clips limit where effects go', () => {
  const p = project()
  const first = clips(p)[0]
  const plan = planRequest('add a glitch effect', p)
  const r = runStep(p, plan.steps.find((s) => s.tool === 'addEffect')!, { selection: [first.id] })
  expect(clips(r.project).filter((c) => c.effects.length)).toHaveLength(1)
})

test('words that style a title are not also applied as effects on the video', () => {
  for (const ask of ['Add a neon title saying "Hello"', 'Add a glitch title "SYSTEM FAILURE"', 'Add a chrome title "TURBO" with a bounce']) {
    const { project: p } = run(ask)
    expect(effects(p), ask).toEqual([])
    expect(clips(p).filter((c) => c.text), ask).toHaveLength(1)
  }
})

test('sound-effect requests add audio effects to the right clips', () => {
  const afx = (p: Project, id: string) => (clips(p).find((c) => c.assetId === id)?.audioFx ?? []).map((e) => e.type)
  expect(afx(run('add reverb to the music').project, 'm')).toEqual(['reverb'])
  expect(afx(run('add reverb to the music').project, 'v')).toEqual([])
  expect(afx(run('boost the bass in the music').project, 'm')).toEqual(['bass'])
  const robot = run('make the voice sound like a robot').project
  expect(clips(robot).find((c) => c.assetId === 'v')!.audioFx![0]).toMatchObject({ type: 'voice', params: { preset: 2 } })
  expect(afx(robot, 'm')).toEqual([]) // the music is left alone
  expect(afx(run('remove the vocals from the song').project, 'm')).toEqual(['vocals'])
  expect(clips(run('remove the vocals from the song').project).find((c) => c.assetId === 'm')!.audioFx![0].params.mode).toBe(1)
  expect(clips(run('pitch the voice down 4 semitones').project).find((c) => c.assetId === 'v')!.audioFx![0].params.semitones).toBe(-4)
  expect(afx(run('make it sound like a phone call').project, 'v')).toEqual(['voice'])
  expect(afx(run('enhance the voice').project, 'v')).toEqual(['voiceEnhance'])
  expect(afx(run('even out the volume with a compressor').project, 'm')).toEqual(['compressor'])
})

test('an audio visualizer is added on its own track, spanning the music', () => {
  const p = run('add a circular audio visualizer in pink').project
  const viz = clips(p).find((c) => c.viz)!
  expect(viz.viz).toMatchObject({ style: 'circle', color: '#ff4fa3' })
  expect(viz.duration).toBe(120) // the music is 120 s long
  expect(p.tracks.find((t) => t.name === 'Visualizer')!.clips).toHaveLength(1)
})

test('words inside quotes never change the frame shape', () => {
  for (const ask of ['Add a neon title saying "SUMMER REEL"', 'Add a title "My square shorts video"', 'add a text "vertical limit"']) {
    expect(run(ask).project.settings, ask).toMatchObject({ width: 1920, height: 1080 })
  }
  expect(run('make it vertical for reels').project.settings).toMatchObject({ width: 1080, height: 1920 })
  expect(run('make it square').project.settings).toMatchObject({ width: 1080, height: 1080 })
})

test('naming a single effect does not also apply a whole style, unless the request says "style"', () => {
  const tools = (ask: string) => run(ask).tools
  expect(tools('add a vignette and film grain')).not.toContain('applyStyle')
  expect(effects(run('add a vignette and film grain').project)).toEqual(expect.arrayContaining(['vignette', 'grain']))
  expect(tools('give it a VHS tape look')).not.toContain('applyStyle')
  expect(tools('add a glitch effect')).not.toContain('applyStyle')
  expect(tools('make it analog style')).toContain('applyStyle')
  expect(tools('make it glitch style')).toContain('applyStyle')
  expect(tools('make it glitch style')).not.toContain('addEffect')
  // Both together: a style plus a separate effect.
  const both = tools('make it hype and add a glitch effect')
  expect(both).toContain('applyStyle')
  expect(both).toContain('addEffect')
  expect(tools('make this video more cinematic')).toEqual(['applyStyle'])
})

test('the Minecraft-style font is bundled and the assistant knows it by name', async () => {
  const { ALL_FONTS } = await import('../src/shared/effects/fonts')
  expect(ALL_FONTS).toContain('Monocraft')
  expect(new Set(ALL_FONTS).size).toBe(ALL_FONTS.length) // listed in two categories, but only once for loading
  const t = clips(run('Add a Minecraft title saying "Welcome to the server"').project).find((c) => c.text)!
  expect(t.text!.fontFamily).toBe('Monocraft')
  expect(t.text!.content).toBe('Welcome to the server')
  const t2 = clips(run('Add a title "Hello" in Minecraft font').project).find((c) => c.text)!
  expect(t2.text!.fontFamily).toBe('Monocraft')
})
