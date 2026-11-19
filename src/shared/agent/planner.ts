/**
 * The assistant's brain: turns a plain-language request into a plan of tool
 * calls, and runs plans. Works entirely offline with pattern rules; a local
 * language model can optionally propose the plan instead (see `validatePlan`).
 */
import type { BlendMode, MediaAsset, Project } from '../types'
import { EFFECTS, EFFECT_STACKS, effectSpec } from '../effects/registry'
import { type RampShape } from '../timeline/ops'
import * as more from './tools2'
import { planExtras } from './planner2'
import { planBatch } from './planner3'
import { OVERLAY_CATALOG } from '../overlayCatalog'
import { insertTemplate, templateById } from '../motionTemplates'
import { lookById } from '../color/looks'
import * as batch from './batch'
import { AUDIO_EFFECTS, audioEffectSpec } from '../effects/audio'
import { BUILTIN_STYLES, type StyleDef, findStyle, withIntensity } from '../styles/styles'
import { projectDuration } from '../timeline/ops'
import * as tools from './tools'
import { musicMarks } from '../timeline/marks'

export type ToolName =
  | 'autoCutToBeat' | 'syncToSnares' | 'removeAudio' | 'removeSilences' | 'applyStyle' | 'removeStyle' | 'addCaptions' | 'buildMontage' | 'syncToBeats' | 'changePacing'
  | 'energizeIntro' | 'duckMusic' | 'addTransitions' | 'setFormat' | 'denoise'
  | 'addEffect' | 'addStack' | 'clearEffects' | 'adjustColor' | 'setSpeed' | 'speedRamp' | 'freezeFrame' | 'reverse' | 'fade' | 'setVolume' | 'trimTo' | 'addText' | 'pip' | 'setBlend' | 'kenBurns' | 'closeGaps' | 'setFps'
  | 'stabilize' | 'reframe' | 'hyperlapse' | 'addAudioEffect' | 'addVisualizer'
  | 'trimClips' | 'splitEvery' | 'removeShort' | 'sortClips' | 'fadeEach' | 'fillFrame' | 'removeKind' | 'renderClips' | 'exportProject' | 'addOverlay' | 'applyLook' | 'removeLook' | 'addTemplate'

export interface PlanStep {
  tool: ToolName
  args: Record<string, number | string>
  /** Plain-language statement of what the step will do, shown before and after it runs. */
  description: string
}

export interface Plan {
  steps: PlanStep[]
  /** Things the user should know: what could not be done and why. */
  notes: string[]
  /** Alternative versions, when the user asked for several. */
  variants?: { name: string; steps: PlanStep[] }[]
}

export interface AgentContext {
  /** Clips the user has selected; effects and similar tools apply to these, or to every picture clip when none. */
  selection?: string[]
  customStyles?: StyleDef[]
  sfx?: Record<string, MediaAsset>
  /** Built-in overlay clips by id, made available by the app before the plan runs. */
  overlays?: Record<string, MediaAsset>
}

const EFFECTS_IDS = EFFECTS.map((e) => e.type).join('|')
const AUDIO_IDS = AUDIO_EFFECTS.map((e) => e.type).join('|')

/** What each tool is for, in a form a language model can read. */
export const TOOL_CATALOGUE: { tool: ToolName; args: string; purpose: string }[] = [
  { tool: 'removeSilences', args: '{}', purpose: 'cut pauses and dead air out of spoken footage' },
  { tool: 'applyStyle', args: `{"styleId": one of ${BUILTIN_STYLES.map((s) => s.id).join('|')}}`, purpose: 'apply a complete look: grade, transitions, typography, sound' },
  { tool: 'removeStyle', args: '{}', purpose: 'remove the applied style' },
  { tool: 'addCaptions', args: '{}', purpose: 'add animated word-timed subtitles from recognised speech' },
  { tool: 'buildMontage', args: '{"duration": seconds}', purpose: 'build a sequence from the best shots in the library' },
  { tool: 'syncToBeats', args: '{}', purpose: 'move cuts onto the beats of the music' },
  { tool: 'syncToSnares', args: '{}', purpose: 'move cuts onto the snare hits of the music' },
  { tool: 'autoCutToBeat', args: '{"on": "beats"|"snares", "every": 1|2|4}', purpose: 'cut the footage on the beats or snares of the music' },
  { tool: 'removeAudio', args: '{}', purpose: 'remove the sound from the video clips, keeping music and effects' },
  { tool: 'changePacing', args: '{"factor": 0.5-1.5, below 1 is faster}', purpose: 'make shots shorter or longer' },
  { tool: 'energizeIntro', args: '{"seconds": number}', purpose: 'add punch-in zooms and a flash to the opening' },
  { tool: 'duckMusic', args: '{}', purpose: 'lower music while people speak' },
  { tool: 'addTransitions', args: '{"type": transition id}', purpose: 'add a transition at every cut' },
  { tool: 'setFormat', args: '{"width": px, "height": px}', purpose: 'change the frame size, e.g. 1080x1920 for vertical' },
  { tool: 'denoise', args: '{}', purpose: 'reduce background noise in the export' },
  { tool: 'addEffect', args: `{"effect": ${EFFECTS_IDS}, plus optional numeric parameters}`, purpose: 'add a visual effect (blur, glitch, glow, bloom, lens flare, chroma key, drop shadow, 3D camera, ken burns...) to the clips' },
  { tool: 'addStack', args: `{"stack": ${EFFECT_STACKS.map((s) => s.name).join('|')}}`, purpose: 'add a ready-made combination of effects' },
  { tool: 'clearEffects', args: '{}', purpose: 'remove the effects from the clips' },
  { tool: 'adjustColor', args: '{"exposure","contrast","saturation","temperature","tint","fade","hue": amount to add}', purpose: 'make the picture warmer, cooler, brighter, darker, more or less colourful' },
  { tool: 'setSpeed', args: '{"speed": 0.1-16}', purpose: 'play clips faster or slower (slow motion, fast forward)' },
  { tool: 'speedRamp', args: '{"from": speed, "to": speed, "shape": linear|easeIn|easeOut|smooth|bell}', purpose: 'change speed smoothly over a clip' },
  { tool: 'freezeFrame', args: '{"hold": seconds, "at": timeline seconds}', purpose: 'hold one frame of a clip' },
  { tool: 'reverse', args: '{}', purpose: 'play clips backwards' },
  { tool: 'fade', args: '{"where": in|out|both, "seconds": number}', purpose: 'fade the video in from black and/or out to black' },
  { tool: 'setVolume', args: '{"who": music|video|all, "level": 0-2}', purpose: 'change loudness' },
  { tool: 'trimClips', args: '{"seconds": number, "keep": "start"|"end"|"middle", "scope": "all"|"selected", "photos": 0|1}', purpose: 'cut every clip down to a length' },
  { tool: 'splitEvery', args: '{"seconds": number, "scope": "all"|"selected"}', purpose: 'cut every clip into equal pieces' },
  { tool: 'removeShort', args: '{"seconds": number}', purpose: 'delete clips shorter than a length' },
  { tool: 'sortClips', args: '{"by": "length"|"longest"|"name"|"shuffle"}', purpose: 'reorder the clips on the main track' },
  { tool: 'fadeEach', args: '{"seconds": number}', purpose: 'fade every clip in and out' },
  { tool: 'fillFrame', args: '{}', purpose: 'scale clips up to fill the frame with no black bars' },
  { tool: 'removeKind', args: '{"kind": "text"|"captions"|"shapes"|"layers"|"transitions"|"visualizers"}', purpose: 'delete every item of one kind' },
  { tool: 'renderClips', args: '{"spec": "json with presetId, short, fps, codec, crf", "scope": "all"|"selected"}', purpose: 'render each clip to its own video file' },
  { tool: 'exportProject', args: '{"spec": "json with presetId, short, fps, codec, crf"}', purpose: 'export the whole project with a configuration' },
  { tool: 'addOverlay', args: '{"overlay": "id from the overlay library", "at": "start"|seconds, "cover": 0|1}', purpose: 'add a light leak, film grain, dust or flash overlay' },
  { tool: 'applyLook', args: '{"look": "id from the colour looks", "intensity": 0-1}', purpose: 'give the clips a built-in colour look' },
  { tool: 'removeLook', args: '{}', purpose: 'remove built-in colour looks' },
  { tool: 'addTemplate', args: '{"template": "id", "values": "json of field texts", "at": "start"|"end"|seconds}', purpose: 'add a ready-made intro, lower third, title, end card or social prompt' },
  { tool: 'trimTo', args: '{"seconds": number}', purpose: 'shorten the timeline to a length' },
  { tool: 'addText', args: '{"content": text, "look": title|lowerThird|subtitle|neon|gold|chrome|threeD|outline|retro|handwritten|cinematic|gradient|meme|kinetic|minimal|glitch|comic, "animation": text animation id, "place": top|center|bottom, "at": start|middle|end, "start": seconds, "duration": seconds, "font": font name, "color": hex}', purpose: 'add a title, lower third or other text' },
  { tool: 'pip', args: '{"corner": tl|tr|bl|br}', purpose: 'shrink a clip into a corner as picture-in-picture' },
  { tool: 'setBlend', args: '{"mode": multiply|screen|overlay|softLight|hardLight|colorDodge|colorBurn|darken|lighten|difference|exclusion|add|hue|saturation|color|luminosity}', purpose: 'blend clips together (double exposure)' },
  { tool: 'kenBurns', args: '{}', purpose: 'slow pan and zoom on photos' },
  { tool: 'closeGaps', args: '{}', purpose: 'close empty gaps between clips' },
  { tool: 'setFps', args: '{"fps": 1-1000}', purpose: 'change the project frame rate' },
  { tool: 'stabilize', args: '{}', purpose: 'steady shaky footage' },
  { tool: 'reframe', args: '{}', purpose: 'fill the frame and follow the action (for vertical crops of wide shots)' },
  { tool: 'hyperlapse', args: '{"speed": number}', purpose: 'smooth fast-forward' },
  { tool: 'addVisualizer', args: '{"style": bars|mirror|wave|circle|dots, "color": hex}', purpose: 'add a bouncing audio visualizer that follows the music' },
  { tool: 'addAudioEffect', args: `{"effect": ${AUDIO_IDS}, "who": music|video|all, plus optional numeric parameters}`, purpose: 'change how the sound sounds: reverb, echo, bass boost, equalizer, compressor, pitch, voice changer, vocal isolation' }
]

const STYLE_WORDS: [RegExp, string][] = [
  [/cinematic|film ?look|movie|filmic|atmospher/, 'cinematic'],
  [/editorial|magazine|clean|minimal|modern/, 'editorial'],
  [/hype|energetic|energy|exciting|sports?|intense|aggressive|punchy/, 'hype'],
  [/analog|analogue|vintage|retro|film grain|vhs|nostalg|old[- ]school|super ?8/, 'analog'],
  [/luxur|elegant|premium|classy|high[- ]end|sophisticated|expensive/, 'luxury'],
  [/glitch|cyber|digital distortion|hacker|datamosh/, 'glitch'],
  [/studio warm|warm (look|tone|grade)|cozy|cosy|podcast/, 'studio-warm'],
  [/neon|product demo|tech demo|futuristic/, 'neon-product'],
  [/kinetic|motion graphics|moving text|typograph/, 'kinetic'],
  [/explainer|tutorial|educational|talking head/, 'explainer']
]

const describeStyle = (s: StyleDef): string => `Apply the ${s.name} style: ${s.description}`

function hasSpeechAnalysis(project: Project): boolean {
  return project.media.some((m) => m.kind === 'video' && m.hasAudio && m.analysis)
}
function hasTranscript(project: Project): boolean {
  return project.media.some((m) => m.analysis?.transcript?.length)
}
function hasTimeline(project: Project): boolean {
  return projectDuration(project) > 0
}

function secondsIn(text: string, fallback: number): number {
  const m = /(\d+(?:\.\d+)?)\s*-?\s*(seconds?|secs?|s\b|minutes?|mins?|m\b)/.exec(text)
  if (!m) return fallback
  return Number(m[1]) * (m[2].startsWith('m') ? 60 : 1)
}

/** Offline planner: recognises what the request asks for and orders the steps sensibly. */
export function planRequest(request: string, project: Project, context: AgentContext = {}): Plan {
  // Batch commands ("cut all clips to 7 seconds", "render each clip in 1080p") are read first and their words removed.
  const batched = planBatch(request.toLowerCase(), request)
  const text = batched.rest
  const steps: PlanStep[] = [...batched.steps]
  const notes: string[] = [...batched.notes]
  const add = (tool: ToolName, description: string, args: PlanStep['args'] = {}): void => {
    if (!steps.some((s) => s.tool === tool)) steps.push({ tool, args, description })
  }
  const styleFor = (t: string): StyleDef | undefined => {
    const custom = context.customStyles?.find((s) => t.includes(s.name.toLowerCase()))
    if (custom) return custom
    const id = STYLE_WORDS.find(([re]) => re.test(t))?.[1]
    return id ? findStyle(id, context.customStyles) : undefined
  }

  // The wider vocabulary (effects, text, colour, speed, camera, compositing...) is planned first; the rules below fill in the rest.
  // Words that belong to a transition ("glitch transitions"), a title ("neon title") or an effect ("glitch effect") are not a whole style.
  let styleText = text.replace(/\b(?:[a-z0-9-]+ ){1,2}transitions?\b/g, ' transitions ').replace(/\b[a-z0-9-]+ (effects?|filters?)\b/g, ' $1 ')
  if (/["“‘]/.test(request)) styleText = styleText.replace(/["“‘][^"”’]*["”’]/g, ' ').replace(/\b(?:[a-z0-9-]+ ){0,2}(?:title|heading|headline|lower third|subtitle|text|note|label)\b/g, ' ')
  const extra = planExtras(request, text, project, text)
  // Words that named a single effect ("film grain", "vhs") are not also a whole style, unless the request says "... style".
  for (const phrase of extra.consumed) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b(?!\\s+styles?\\b)`, 'g')
    styleText = styleText.replace(re, ' ')
  }
  steps.push(...extra.steps)
  notes.push(...extra.notes)

  // Several versions: one plan per style.
  const versions = /(\d+|two|three|four|a few|several|different|multiple)\s+(different\s+)?(versions?|variations?|options?|looks?|styles?)/.exec(text)
  if (versions) {
    const count = Math.min(4, { two: 2, three: 3, four: 4 }[versions[1]] ?? (Number(versions[1]) || 3))
    const named = STYLE_WORDS.filter(([re]) => re.test(text)).map(([, id]) => id)
    const pool = [...new Set([...named, 'cinematic', 'hype', 'editorial', 'analog'])].slice(0, count)
    return {
      steps: [],
      notes: hasTimeline(project) ? [] : ['Add clips to the timeline first, or ask for a montage.'],
      variants: pool.map((id) => {
        const style = findStyle(id)!
        return { name: style.name, steps: [{ tool: 'applyStyle', args: { styleId: id }, description: describeStyle(style) }] }
      })
    }
  }

  if (/montage|highlight|best (clips|shots|moments|parts|bits)|compilation|recap|sizzle/.test(text)) {
    const duration = secondsIn(text, 30)
    if (!project.media.some((m) => m.analysis?.shots.length)) notes.push('No analysed video in the library yet. Import footage and wait for analysis to finish.')
    else add('buildMontage', `Build a ${duration}-second sequence from the highest-rated shots, skipping duplicate takes. This replaces the clips on the main video track.`, { duration })
  }

  if (/(remove|cut|delete|trim|get rid of|strip|tighten).{0,30}(pause|silence|silent|dead air|gap|umm?|filler)|jump ?cut/.test(text)) {
    if (!hasSpeechAnalysis(project)) notes.push('Silence removal needs analysed footage with sound.')
    else add('removeSilences', 'Cut pauses longer than 0.45 s out of the spoken footage, leaving a short breath around each cut.')
  }

  const pacing = /(pacing|pace|tempo|rhythm|cuts?|edit|it|video).{0,20}(faster|quicker|snappier|tighter|punchier)|speed (it|things|the pacing) up|\bfaster pac/.test(text) ? 'faster' : /(pacing|pace|cuts?|edit|it|video).{0,20}(slower|calmer|more relaxed)|slow (it|things|the pacing) down|let it breathe/.test(text) ? 'slower' : null
  if (pacing === 'faster') {
    if (hasSpeechAnalysis(project)) add('removeSilences', 'Cut pauses out of the spoken footage.')
    add('changePacing', 'Shorten every shot on the main track by 25% and close the gaps.', { factor: 0.75 })
  } else if (pacing === 'slower') add('changePacing', 'Lengthen every shot on the main track by 25% where the footage allows.', { factor: 1.25 })

  if (/(first|opening|start|beginning|intro|hook).{0,40}(interesting|engaging|exciting|grab|punch|attention|better|stronger|dynamic)|(better|stronger|punchier) (hook|intro|opening)/.test(text)) {
    const seconds = /first\s+(\d+)/.exec(text) ? Number(/first\s+(\d+)/.exec(text)![1]) : 5
    add('energizeIntro', `Add punch-in zooms and an opening flash to the first ${seconds} seconds.`, { seconds })
  }

  const style = /(remove|undo|clear|strip|no)\s+(the\s+)?(style|look|grade)/.test(text) ? null : styleFor(styleText)
  if (/(remove|undo|clear|strip)\s+(the\s+)?(style|look|grade)/.test(text)) add('removeStyle', 'Remove the applied style and keep your own edits.')
  else if (style) add('applyStyle', describeStyle(style), { styleId: style.id })

  const onSnares = /snare/.test(text)
  if (/(auto(matic(ally)?)?[ -]?cut|beat ?cut|chop|cut (it |this |the )?(video |clip |clips |footage )?(up )?(to|on|with|at|every)\b.{0,12}(beat|snare|music)|cut.{0,12}every (\d+ |other |second |fourth )?(beat|snare))/.test(text)) {
    const every = /every (other|second)\b|every 2\b/.test(text) ? 2 : /every (fourth|4)\b/.test(text) ? 4 : 1
    const marks = musicMarks(project)
    if (!(onSnares ? marks.snares : marks.beats).length) notes.push(onSnares ? 'Cutting on snares needs music with a snare on an audio track (analysis must have finished).' : 'Cutting to the beat needs music with a steady tempo on an audio track.')
    else add('autoCutToBeat', `Cut the footage ${onSnares ? 'on every snare hit' : every === 1 ? 'on every beat' : `on every ${every === 2 ? 'second' : 'fourth'} beat`}, with a slight punch-in on alternate pieces.`, { on: onSnares ? 'snares' : 'beats', every })
  } else if (/(sync|match|align|time|snap|cut).{0,30}(beat|music|rhythm|snare)|on the beat|to the beat/.test(text)) {
    if (onSnares) {
      if (!musicMarks(project).snares.length) notes.push('Snare sync needs music with a snare on an audio track (analysis must have finished).')
      else add('syncToSnares', 'Move each cut on the main track to the nearest snare hit.')
    } else if (!tools.timelineBeats(project).length) notes.push('Beat sync needs music with a steady tempo on an audio track.')
    else add('syncToBeats', 'Move each cut on the main track to the nearest beat of the music.')
  }

  if (/(remove|strip|delete|cut|mute|kill|drop|turn off|silence|no)\b.{0,25}\b(audio|sound)\b.{0,25}\b(clips?|footage|videos?|shots?)\b|\b(mute|silence)\b.{0,12}\b(clips?|footage|videos?|shots?)\b|(clips?|footage|videos?|shots?).{0,20}\b(without|no|remove) (the )?(audio|sound)/.test(text)) {
    add('removeAudio', 'Remove the sound from the video clips (their picture stays; music and sound effects are kept).')
  }

  if (/transition/.test(text) && !steps.some((s) => s.tool === 'applyStyle' || s.tool === 'addTransitions')) {
    add('addTransitions', 'Add a transition at every cut that does not already have one.', { type: /glitch/.test(text) ? 'glitch' : /whip|fast|energetic/.test(text) ? 'whip' : /zoom/.test(text) ? 'zoomIn' : /slide|push/.test(text) ? 'push' : 'fade' })
  }

  if (/subtitle|caption|\bsubs\b|text on screen|karaoke/.test(text) && (!extra.handledText || /speech|spoken|talking|transcri|auto|what (they|i|he|she) say/.test(text))) {
    if (!hasTranscript(project)) notes.push('Captions need a transcript. Run speech recognition on the footage (Captions tab) or import an .srt file first.')
    else add('addCaptions', 'Add word-timed animated captions from the recognised speech, in the current style\'s caption design.')
  }

  if (/duck|(music|song|track).{0,20}(quieter|lower|down|softer)|lower the music|hear (the |my |their )?(voice|speech|talking)|music.{0,15}too loud/.test(text)) add('duckMusic', 'Lower the music to 22% while people speak, with smooth ramps.')

  // Words inside quotes are text the person wants on screen ("SUMMER REEL"), not instructions about the frame.
  const unquoted = text.replace(/["“‘][^"”’]*["”’]/g, ' ')
  if (/vertical|portrait|9[:x]16|tiktok|\b(instagram )?reels\b|youtube shorts|\bshorts (video|format)/.test(unquoted)) add('setFormat', 'Change the frame to vertical 1080 × 1920.', { width: 1080, height: 1920 })
  else if (/square|1[:x]1/.test(unquoted)) add('setFormat', 'Change the frame to square 1080 × 1080.', { width: 1080, height: 1080 })
  else if (/horizontal|landscape|16[:x]9|widescreen|youtube/.test(unquoted)) add('setFormat', 'Change the frame to horizontal 1920 × 1080.', { width: 1920, height: 1080 })

  if (/noise|hiss|hum|background sound|clean(er)? (up )?(the )?(audio|sound)/.test(text)) add('denoise', 'Turn on noise reduction for every clip with sound (applied in the export).')

  if (!steps.length && !notes.length) {
    notes.push('I did not recognise an edit in that. I can add effects (blur, glitch, bloom, lens flare, green screen, drop shadow…), colour changes, titles and lower thirds, transitions, slow motion, speed ramps and freeze frames, stabilising, Ken Burns, picture-in-picture, fades and volume, trimming, whole edits (a TikTok edit, a trailer, a podcast clip…), and everything in the preset list. Try one of the suggestions.')
  }
  if (steps.length && !hasTimeline(project) && !steps.some((s) => s.tool === 'buildMontage' || s.tool === 'setFormat')) notes.push('The timeline is empty, so some steps will have nothing to change. Add clips or ask for a montage.')

  // Order: structure first, then timing, then look, then text and sound.
  const order: ToolName[] = ['setFormat', 'buildMontage', 'removeKind', 'removeShort', 'splitEvery', 'trimClips', 'sortClips', 'fillFrame', 'trimTo', 'removeSilences', 'removeAudio', 'closeGaps', 'reverse', 'setSpeed', 'speedRamp', 'freezeFrame', 'hyperlapse', 'changePacing', 'autoCutToBeat', 'syncToBeats', 'syncToSnares', 'stabilize', 'reframe', 'kenBurns', 'energizeIntro', 'removeStyle', 'applyStyle', 'clearEffects', 'addStack', 'addEffect', 'adjustColor', 'pip', 'setBlend', 'addTransitions', 'fade', 'addText', 'addVisualizer', 'addCaptions', 'addOverlay', 'applyLook', 'removeLook', 'addTemplate', 'setVolume', 'addAudioEffect', 'duckMusic', 'denoise', 'setFps', 'fadeEach', 'renderClips', 'exportProject']
  steps.sort((a, b) => order.indexOf(a.tool) - order.indexOf(b.tool))
  return { steps, notes }
}

/** Checks a plan proposed by a language model, keeping only valid tool calls. */
export function validatePlan(raw: unknown, context: AgentContext = {}): PlanStep[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { steps?: unknown })?.steps) ? (raw as { steps: unknown[] }).steps : []
  const known = new Set(TOOL_CATALOGUE.map((t) => t.tool))
  const steps: PlanStep[] = []
  for (const item of list) {
    const { tool, args = {} } = (item ?? {}) as { tool?: ToolName; args?: Record<string, unknown> }
    if (!tool || !known.has(tool)) continue
    const clean: PlanStep['args'] = {}
    for (const [k, v] of Object.entries(args)) if (typeof v === 'number' || typeof v === 'string') clean[k] = v
    if (tool === 'applyStyle') {
      const style = findStyle(String(clean.styleId), context.customStyles)
      if (!style) continue
      steps.push({ tool, args: { styleId: style.id }, description: describeStyle(style) })
      continue
    }
    steps.push({ tool, args: clean, description: TOOL_CATALOGUE.find((t) => t.tool === tool)!.purpose.replace(/^./, (c) => c.toUpperCase()) + '.' })
  }
  return steps
}

/** Extracts the first JSON value from a model's reply. */
export function extractJson(reply: string): unknown {
  const start = reply.search(/[[{]/)
  if (start < 0) return null
  for (let end = reply.length; end > start; end--) {
    try {
      return JSON.parse(reply.slice(start, end))
    } catch {
      // keep shrinking
    }
  }
  return null
}

export function llmPrompt(request: string, project: Project): string {
  const facts = [
    `timeline length: ${projectDuration(project).toFixed(1)} s`,
    `library: ${project.media.filter((m) => m.kind === 'video').length} videos, ${project.media.filter((m) => m.kind === 'audio').length} audio files`,
    `speech transcript available: ${hasTranscript(project)}`,
    `music beats detected: ${tools.timelineBeats(project).length > 0}`
  ]
  return `You control a video editor. Choose tool calls that fulfil the request.\nTools:\n${TOOL_CATALOGUE.map((t) => `- ${t.tool} ${t.args}: ${t.purpose}`).join('\n')}\nProject: ${facts.join('; ')}.\nRequest: "${request}"\nReply with only a JSON array like [{"tool":"applyStyle","args":{"styleId":"cinematic"}}]. Use only the tools listed.`
}

export interface StepResult {
  project: Project
  /** What actually happened, with numbers. */
  summary: string
  changed: boolean
}

/** Runs one step. Never throws for "nothing to do"; reports it instead. */
export function runStep(project: Project, step: PlanStep, context: AgentContext = {}): StepResult {
  const done = (next: Project, summary: string): StepResult => ({ project: next, summary, changed: next !== project })
  switch (step.tool) {
    case 'removeSilences': {
      const r = tools.removeSilences(project)
      return done(r.project, r.cuts ? `Removed ${r.cuts} pause${r.cuts === 1 ? '' : 's'}, ${r.removed.toFixed(1)} s in total.` : 'Found no pauses long enough to cut.')
    }
    case 'applyStyle': {
      const style = findStyle(String(step.args.styleId), context.customStyles)
      if (!style) return done(project, 'That style no longer exists.')
      const intensity = typeof step.args.intensity === 'number' ? step.args.intensity : 1
      return done(tools.applyStyle(project, withIntensity(style, intensity), context), `Applied ${style.name}: look layer, camera movement, transitions, typography and sound.`)
    }
    case 'removeStyle':
      return done(tools.stripStyle(project), 'Removed the style.')
    case 'addCaptions': {
      const current = project.tracks.flatMap((t) => t.clips).find((c) => c.origin === 'caption')?.text
      const styled = project.tracks.some((t) => t.name === 'Look')
      void styled
      const r = tools.addCaptions(project, current ? { ...current, words: undefined } : {}, 0.3)
      return done(r.project, r.captions ? `Added ${r.captions} caption${r.captions === 1 ? '' : 's'}.` : 'No recognised speech falls on the timeline, so no captions were added.')
    }
    case 'buildMontage': {
      const r = tools.buildMontage(project, { duration: Number(step.args.duration) || 30, shotLength: Number(step.args.shotLength) || 2.5, beatsPerShot: 4 })
      return done(r.project, r.shots ? `Built a ${projectDuration(r.project).toFixed(1)} s sequence from ${r.shots} shots.` : 'No analysed shots to build from.')
    }
    case 'autoCutToBeat': {
      const r = tools.autoCutToBeat(project, { on: step.args.on === 'snares' ? 'snares' : 'beats', every: Number(step.args.every) || 1 })
      return done(r.project, r.cuts ? `Made ${r.cuts} cut${r.cuts === 1 ? '' : 's'} on the ${step.args.on === 'snares' ? 'snares' : 'beat'}.` : 'No music beats fall on the footage, so nothing was cut.')
    }
    case 'syncToSnares': {
      const r = tools.syncCutsToSnares(project)
      return done(r.project, r.moved ? `Moved ${r.moved} cut${r.moved === 1 ? '' : 's'} onto snare hits.` : 'No cuts needed moving (or no snares were detected).')
    }
    case 'removeAudio': {
      const r = tools.removeClipAudio(project)
      return done(r.project, r.clips ? `Removed the sound from ${r.clips} clip${r.clips === 1 ? '' : 's'}.` : 'No video clips with sound of their own.')
    }
    case 'syncToBeats': {
      const r = tools.syncCutsToBeats(project, Number(step.args.beatsPerShot) || 1)
      return done(r.project, r.moved ? `Moved ${r.moved} cut${r.moved === 1 ? '' : 's'} onto the beat.` : 'No cuts needed moving (or no beat was detected).')
    }
    case 'changePacing': {
      const before = projectDuration(project)
      const next = tools.tightenPacing(project, Math.max(0.3, Math.min(2, Number(step.args.factor) || 0.75)))
      return done(next, `Timeline went from ${before.toFixed(1)} s to ${projectDuration(next).toFixed(1)} s.`)
    }
    case 'energizeIntro':
      return done(tools.energizeIntro(project, Number(step.args.seconds) || 5), 'Added punch-in zoom keyframes and an opening flash.')
    case 'duckMusic': {
      const r = tools.duckMusic(project)
      return done(r.project, r.clips ? `Wrote volume keyframes on ${r.clips} music clip${r.clips === 1 ? '' : 's'}.` : 'Found no music under speech to lower.')
    }
    case 'addTransitions': {
      const type = String(step.args.type || 'fade')
      let count = 0
      const next = { ...project, tracks: project.tracks.map((t) => t.kind !== 'video' ? t : { ...t, clips: t.clips.map((c) => {
        const prev = t.clips.find((p) => p.id !== c.id && Math.abs(p.start + p.duration - c.start) < 1e-3)
        if (!prev || c.transitionIn || (!c.assetId && !c.text)) return c
        count++
        return { ...c, transitionIn: { type, duration: Math.min(0.5, c.duration / 2, prev.duration / 2) } }
      }) }) }
      return done(count ? next : project, count ? `Added ${count} transition${count === 1 ? '' : 's'}.` : 'Every cut already has a transition, or there are no cuts.')
    }
    case 'setFormat': {
      const [width, height] = [Math.round(Number(step.args.width) / 2) * 2, Math.round(Number(step.args.height) / 2) * 2]
      if (!(width >= 16 && height >= 16)) return done(project, 'That size is not valid.')
      if (project.settings.width === width && project.settings.height === height) return done(project, 'The project is already that size.')
      return done({ ...project, settings: { ...project.settings, width, height } }, `Frame is now ${width} × ${height}.`)
    }
    case 'addEffect': {
      const type = String(step.args.effect)
      const spec = effectSpec(type)
      if (!spec) return done(project, 'That effect does not exist.')
      const params = Object.fromEntries(Object.entries(step.args).filter(([k, v]) => k !== 'effect' && typeof v === 'number' && spec.params.some((p) => p.key === k))) as Record<string, number>
      const r = more.addEffectTo(project, type, params, context.selection)
      return done(r.project, r.count ? `Added ${spec.name} to ${r.count} clip${r.count === 1 ? '' : 's'}.` : 'There are no picture clips to add an effect to.')
    }
    case 'addStack': {
      const stack = EFFECT_STACKS.find((x) => x.name === step.args.stack)
      if (!stack) return done(project, 'That stack does not exist.')
      const r = more.addStackTo(project, stack.effects, context.selection)
      return done(r.project, r.count ? `Added ${stack.name} (${stack.effects.length} effects) to ${r.count} clip${r.count === 1 ? '' : 's'}.` : 'There are no picture clips to add effects to.')
    }
    case 'clearEffects': {
      const r = more.clearEffects(project, context.selection)
      return done(r.project, r.count ? `Removed effects from ${r.count} clip${r.count === 1 ? '' : 's'}.` : 'No clip has effects of its own to remove.')
    }
    case 'adjustColor': {
      const delta = Object.fromEntries(Object.entries(step.args).filter(([, v]) => typeof v === 'number')) as Record<string, number>
      const r = more.adjustColor(project, delta, context.selection)
      return done(r.project, r.count ? `Adjusted the colour of ${r.count} clip${r.count === 1 ? '' : 's'}.` : 'There are no picture clips to adjust.')
    }
    case 'setSpeed': {
      const r = more.setSpeed(project, Math.max(0.1, Math.min(16, Number(step.args.speed) || 1)), context.selection)
      return done(r.project, r.count ? `Set the speed of ${r.count} clip${r.count === 1 ? '' : 's'} to ${Number(step.args.speed)}×. Later clips moved to keep the timeline closed up.` : 'No video clips to change the speed of.')
    }
    case 'speedRamp': {
      const r = more.speedRamp(project, Number(step.args.from) || 1, Number(step.args.to) || 0.25, (String(step.args.shape || 'bell') as RampShape), context.selection)
      return done(r.project, r.count ? 'Split the clip into sixteen pieces whose speed follows the ramp.' : 'No suitable clip to ramp.')
    }
    case 'freezeFrame': {
      const r = more.freezeAt(project, typeof step.args.at === 'number' ? step.args.at : undefined, Number(step.args.hold) || 2, context.selection)
      return done(r.project, r.count ? `Held a frame for ${Number(step.args.hold) || 2} s.` : 'No clip at that moment to freeze.')
    }
    case 'reverse': {
      const r = more.reverseClips(project, context.selection)
      return done(r.project, r.count ? `Reversed ${r.count} clip${r.count === 1 ? '' : 's'}.` : 'No video clips to reverse.')
    }
    case 'fade': {
      const where = step.args.where === 'in' || step.args.where === 'out' ? step.args.where : 'both'
      const r = more.fadeEnds(project, where, Number(step.args.seconds) || 1)
      return done(r.project, r.count ? 'Added the fade.' : 'No video clips to fade.')
    }
    case 'setVolume': {
      const who = step.args.who === 'video' || step.args.who === 'all' ? step.args.who : 'music'
      const r = more.setVolume(project, who, Number(step.args.level))
      return done(r.project, r.count ? `Set the volume of ${r.count} clip${r.count === 1 ? '' : 's'}.` : `No ${who === 'music' ? 'music' : 'sound'} found to change.`)
    }
    case 'trimTo': {
      const r = more.trimTo(project, Number(step.args.seconds))
      return done(r.project, r.count ? `Cut the timeline down to ${Number(step.args.seconds)} s.` : 'The timeline is already that short.')
    }
    case 'addText': {
      const end = projectDuration(project)
      const duration = Number(step.args.duration) || 3
      const start = typeof step.args.start === 'number' ? step.args.start : step.args.at === 'end' ? Math.max(0, end - duration - 0.2) : step.args.at === 'middle' ? Math.max(0, end / 2 - duration / 2) : 0.3
      const place = step.args.place === 'top' || step.args.place === 'bottom' || step.args.place === 'center' ? step.args.place : undefined
      const r = more.addTextOverlay(project, { content: String(step.args.content || 'Your text'), look: step.args.look ? String(step.args.look) : undefined, animation: step.args.animation ? String(step.args.animation) : undefined, font: step.args.font ? String(step.args.font) : undefined, place, start, duration, color: step.args.color ? String(step.args.color) : undefined })
      return done(r.project, `Added the text “${String(step.args.content).slice(0, 40)}” at ${start.toFixed(1)} s.`)
    }
    case 'pip': {
      const c = step.args.corner
      const r = more.makePipClips(project, c === 'tl' || c === 'tr' || c === 'bl' ? c : 'br', context.selection)
      return done(r.project, r.count ? `Moved ${r.count} clip${r.count === 1 ? '' : 's'} into the corner as picture-in-picture.` : 'No video clip to shrink.')
    }
    case 'setBlend': {
      const r = more.setBlendMode(project, String(step.args.mode) as BlendMode, context.selection)
      return done(r.project, r.count ? `Set the blend mode to ${String(step.args.mode)} on ${r.count} clip${r.count === 1 ? '' : 's'}.` : 'No clips to blend.')
    }
    case 'kenBurns': {
      const r = more.kenBurnsOnImages(project)
      return done(r.project, r.count ? `Added a slow pan and zoom to ${r.count} photo${r.count === 1 ? '' : 's'}.` : 'There are no photos on the timeline.')
    }
    case 'closeGaps': {
      const r = more.closeGaps(project)
      return done(r.project, r.count ? `Closed ${r.count} gap${r.count === 1 ? '' : 's'}.` : 'There are no gaps.')
    }
    case 'setFps': {
      const r = more.setProjectFps(project, Number(step.args.fps))
      return done(r.project, r.count ? `The project now runs at ${Number(step.args.fps)} fps.` : 'The project already uses that frame rate.')
    }
    case 'addVisualizer': {
      const style = ['bars', 'mirror', 'wave', 'circle', 'dots'].includes(String(step.args.style)) ? (String(step.args.style) as 'bars') : 'bars'
      const r = more.addVisualizer(project, style, step.args.color ? String(step.args.color) : undefined)
      return done(r.project, `Added a ${style} audio visualizer on its own track.`)
    }
    case 'addAudioEffect': {
      const type = String(step.args.effect)
      const spec = audioEffectSpec(type)
      if (!spec) return done(project, 'That sound effect does not exist.')
      const params = Object.fromEntries(Object.entries(step.args).filter(([k, v]) => k !== 'effect' && typeof v === 'number' && spec.params.some((p) => p.key === k))) as Record<string, number>
      const who = step.args.who === 'music' || step.args.who === 'video' ? step.args.who : 'all'
      const r = more.addAudioEffectTo(project, type, params, who, context.selection)
      return done(r.project, r.count ? `Added ${spec.name} to ${r.count} clip${r.count === 1 ? '' : 's'}.${spec.preview ? '' : ' (Heard in the export.)'}` : 'No clips with sound to add it to.')
    }
    case 'trimClips': {
      const scope = step.args.scope === 'selected' ? context.selection ?? [] : []
      const keep = step.args.keep === 'end' || step.args.keep === 'middle' ? step.args.keep : 'start'
      const r = batch.trimClips(project, Number(step.args.seconds), keep, scope, false, Number(step.args.photos) === 1)
      return done(r.project, r.count ? `Cut ${r.count} clip${r.count === 1 ? '' : 's'} down to ${Number(step.args.seconds)} s.` : `Every clip is already ${Number(step.args.seconds)} s or shorter.`)
    }
    case 'splitEvery': {
      const r = batch.splitEvery(project, Number(step.args.seconds), step.args.scope === 'selected' ? context.selection ?? [] : [])
      return done(r.project, r.count ? `Made ${r.count} cut${r.count === 1 ? '' : 's'}, one every ${Number(step.args.seconds)} s.` : `No clip is longer than ${Number(step.args.seconds)} s.`)
    }
    case 'removeShort': {
      const r = batch.removeShortClips(project, Number(step.args.seconds))
      return done(r.project, r.count ? `Deleted ${r.count} clip${r.count === 1 ? '' : 's'} shorter than ${Number(step.args.seconds)} s.` : `No clip is shorter than ${Number(step.args.seconds)} s.`)
    }
    case 'sortClips': {
      const by = step.args.by === 'longest' || step.args.by === 'name' || step.args.by === 'shuffle' ? step.args.by : 'length'
      const r = batch.sortClips(project, by, Math.floor(Math.random() * 1e6))
      return done(r.project, r.count ? `Re-ordered ${r.count} clips.` : 'Need at least two clips on the main track to re-order.')
    }
    case 'fadeEach': {
      const r = batch.fadeEach(project, Number(step.args.seconds) || 0.5, context.selection)
      return done(r.project, r.count ? `Gave ${r.count} clip${r.count === 1 ? '' : 's'} a ${Number(step.args.seconds) || 0.5} s fade in and out.` : 'No clips to fade.')
    }
    case 'fillFrame': {
      const r = batch.fillFrame(project, context.selection)
      return done(r.project, r.count ? `Scaled ${r.count} clip${r.count === 1 ? '' : 's'} up to fill the frame.` : 'Every clip already fills the frame.')
    }
    case 'removeKind': {
      const kind = String(step.args.kind) as batch.RemovableKind
      const r = batch.removeKind(project, kind)
      return done(r.project, r.count ? `Deleted ${r.count} item${r.count === 1 ? '' : 's'} (${kind}).` : `There are no ${kind} on the timeline.`)
    }
    case 'addOverlay': {
      const info = OVERLAY_CATALOG.find((o) => o.id === step.args.overlay)
      const asset = context.overlays?.[String(step.args.overlay)]
      if (!info || !asset) return done(project, 'That overlay is not available.')
      const at = typeof step.args.at === 'number' ? step.args.at : 0
      const r = more.addOverlay(project, asset, info, at, Number(step.args.cover) === 1)
      return done(r.project, r.count ? `Added the ${info.name.toLowerCase()} overlay${r.count > 1 ? ` (${r.count} repeats to cover the timeline)` : ''}.` : 'Nothing to add the overlay to.')
    }
    case 'applyLook': {
      const look = lookById(String(step.args.look))
      if (!look) return done(project, 'That look does not exist.')
      const r = more.applyLook(project, look.id, typeof step.args.intensity === 'number' ? step.args.intensity : 1, context.selection)
      return done(r.project, r.count ? `Gave ${r.count} clip${r.count === 1 ? '' : 's'} the “${look.name}” look.` : 'No picture clips to grade.')
    }
    case 'removeLook': {
      const r = more.removeLooks(project, context.selection)
      return done(r.project, r.count ? `Removed the look from ${r.count} clip${r.count === 1 ? '' : 's'}.` : 'No built-in look to remove.')
    }
    case 'addTemplate': {
      const t = templateById(String(step.args.template))
      if (!t) return done(project, 'That template does not exist.')
      let values: Record<string, string> = {}
      try { values = JSON.parse(String(step.args.values || '{}')) as Record<string, string> } catch { /* use the defaults */ }
      const end = projectDuration(project)
      const at = typeof step.args.at === 'number' ? step.args.at : step.args.at === 'end' ? Math.max(0, end - t.seconds) : 0
      const r = insertTemplate(project, t, values, at)
      return done(r.project, `Added the “${t.name}” template at ${at.toFixed(1)} s (${r.ids.length} parts, all editable).`)
    }
    case 'renderClips':
    case 'exportProject':
      // Writes video files, so it runs in the app after the editing steps, asking where to save.
      return { project, summary: 'Runs after the other steps (it writes video files).', changed: false }
    case 'stabilize':
    case 'reframe':
    case 'hyperlapse':
      // These analyse the footage itself and run in the app after the other steps.
      return { project, summary: 'Runs after the other steps (it analyses the footage).', changed: false }
    case 'denoise': {
      let count = 0
      const next = { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => {
        const asset = project.media.find((m) => m.id === c.assetId)
        if (!asset || !(asset.hasAudio || asset.kind === 'audio') || c.denoise || asset.builtinSfx) return c
        count++
        return { ...c, denoise: true }
      }) })) }
      return done(count ? next : project, count ? `Noise reduction turned on for ${count} clip${count === 1 ? '' : 's'}.` : 'No clips with sound to clean.')
    }
  }
}
