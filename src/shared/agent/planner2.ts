/** The assistant's wider vocabulary: effects, text, colour, speed, camera, compositing, fades, volume, trimming and whole-edit recipes. */
import type { Project } from '../types'
import { findEffects, findFont, findStackMatch, findTextAnimation, findTextLook, findTransition, TEXT_LOOKS } from './lexicon'
import { EFFECTS } from '../effects/registry'
import { projectDuration } from '../timeline/ops'
import type { PlanStep, ToolName } from './planner'

type Args = PlanStep['args']

const COLOURS: Record<string, string> = { red: '#ff3b3b', blue: '#3b82ff', yellow: '#ffe14a', pink: '#ff4fa3', white: '#ffffff', black: '#000000', green: '#39ff7a', orange: '#ff9a2e', purple: '#a45bff', cyan: '#22d3ee', gold: '#e9b872', teal: '#14b8a6' }
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, sixty: 60 }
const num = (s: string): number => (/^\d/.test(s) ? Number(s) : NUMBER_WORDS[s] ?? NaN)
const NUM = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)'

/** Words that only mean an effect when the request also says "effect", "filter", "add"... */
const AMBIGUOUS = new Set(['flashHit', 'zoomPulse', 'tile', 'spin', 'mirror', 'dropShadow', 'stroke', 'filmBurn', 'digitalNoise', 'slowZoom', 'cornerPin', 'blur', 'colorWash', 'lut', 'parallax', 'liquid', 'wave', 'pixelate', 'invert'])

export interface Recipe {
  id: string
  name: string
  /** What the user can say. */
  prompt: string
  re: RegExp
  steps: (project: Project) => [ToolName, Args, string][]
}

const hasSpeech = (p: Project): boolean => p.media.some((m) => m.analysis?.transcript?.length)
const hasMusic = (p: Project): boolean => p.tracks.some((t) => t.kind === 'audio' && t.clips.length > 0)

export const RECIPES: Recipe[] = [
  { id: 'tiktok', name: 'TikTok / Reels edit', prompt: 'Make a TikTok edit', re: /(make|turn|create).{0,20}(tiktok|reel|short)s?\s+(edit|video|clip)|viral (edit|video)|tiktok (edit|style)/, steps: (p) => [
    ['setFormat', { width: 1080, height: 1920 }, 'Change the frame to vertical 1080 × 1920.'], ['reframe', {}, 'Fill the tall frame and follow the action.'], ['changePacing', { factor: 0.75 }, 'Tighten the pacing by 25%.'],
    ['applyStyle', { styleId: 'hype' }, 'Apply the Hype style.'], ...(hasSpeech(p) ? [['addCaptions', {}, 'Add animated captions.'] as [ToolName, Args, string]] : []), ...(hasMusic(p) ? [['autoCutToBeat', { on: 'beats', every: 2 }, 'Cut on every second beat.'] as [ToolName, Args, string]] : [])] },
  { id: 'trailer', name: 'Cinematic trailer', prompt: 'Make a cinematic movie trailer', re: /(movie|film|cinematic) trailer|trailer (look|style|edit)|make.{0,12}\btrailer/, steps: () => [
    ['setFormat', { width: 1920, height: 1080 }, 'Change the frame to horizontal 1920 × 1080.'], ['applyStyle', { styleId: 'cinematic' }, 'Apply the Cinematic style.'], ['addEffect', { effect: 'letterbox' }, 'Add widescreen bars.'],
    ['addEffect', { effect: 'filmEmulation', stock: 2 }, 'Add a tungsten film look.'], ['fade', { where: 'both', seconds: 1 }, 'Fade in at the start and out at the end.'],
    ['addText', { content: 'COMING SOON', look: 'cinematic', place: 'center', at: 'end', duration: 3 }, 'Add a “COMING SOON” title at the end.']] },
  { id: 'podcast', name: 'Podcast / talking clip', prompt: 'Make a podcast clip', re: /podcast (clip|edit|short)|talking[- ]head (clip|edit)|interview clip|make.{0,12}podcast/, steps: () => [
    ['removeSilences', {}, 'Cut the pauses.'], ['denoise', {}, 'Reduce background noise.'], ['applyStyle', { styleId: 'studio-warm' }, 'Apply the Studio Warm style.'], ['addCaptions', {}, 'Add captions.'], ['duckMusic', {}, 'Lower music under speech.']] },
  { id: 'product', name: 'Product ad', prompt: 'Make a product ad', re: /product (ad|advert|video|promo|demo|showcase)|make.{0,12}(an? )?(ad|advert|promo)\b/, steps: () => [
    ['applyStyle', { styleId: 'neon-product' }, 'Apply the Neon Product style.'], ['addEffect', { effect: 'lightSweep' }, 'Add a light sweep.'], ['addEffect', { effect: 'bloom' }, 'Add bloom.'], ['addTransitions', { type: 'zoomIn' }, 'Add zoom transitions.']] },
  { id: 'slideshow', name: 'Photo slideshow', prompt: 'Make a photo slideshow', re: /slide ?show|photo (video|montage|reel)|turn (my )?photos? into/, steps: () => [
    ['kenBurns', {}, 'Give every photo a slow pan and zoom.'], ['addTransitions', { type: 'fade' }, 'Add cross dissolves between photos.'], ['fade', { where: 'both', seconds: 1 }, 'Fade in and out.']] },
  { id: 'gaming', name: 'Gaming montage', prompt: 'Make a gaming montage', re: /gaming (montage|highlights?|edit)|game ?play (montage|highlights?)|frag ?movie|montage of (my )?(kills|plays)/, steps: (p) => [
    ['buildMontage', { duration: 45 }, 'Build a montage from the best shots.'], ['applyStyle', { styleId: 'hype' }, 'Apply the Hype style.'], ['addEffect', { effect: 'rgbSplit' }, 'Add colour separation.'], ['addEffect', { effect: 'zoomPulse' }, 'Add beat zoom.'],
    ...(hasMusic(p) ? [['autoCutToBeat', { on: 'snares', every: 1 }, 'Cut on the snares.'] as [ToolName, Args, string]] : [])] },
  { id: 'wedding', name: 'Wedding / romantic highlight', prompt: 'Make a wedding highlight', re: /wedding|romantic (edit|video|highlight)|anniversary|love story/, steps: () => [
    ['applyStyle', { styleId: 'luxury' }, 'Apply the Luxury style.'], ['addStack', { stack: 'Dream' }, 'Add a soft dreamy glow.'], ['setSpeed', { speed: 0.8 }, 'Slow the footage slightly.'], ['addTransitions', { type: 'fade' }, 'Add soft dissolves.'], ['fade', { where: 'both', seconds: 1.5 }, 'Fade in and out.']] },
  { id: 'travel', name: 'Travel reel', prompt: 'Make a travel reel', re: /travel (reel|video|edit|montage)|vacation (video|reel)|holiday (video|reel)/, steps: () => [
    ['applyStyle', { styleId: 'cinematic' }, 'Apply the Cinematic style.'], ['addStack', { stack: 'Golden Hour' }, 'Add a golden-hour look.'], ['addTransitions', { type: 'whip' }, 'Add whip-pan transitions.'], ['changePacing', { factor: 0.8 }, 'Tighten the pacing.']] },
  { id: 'retro', name: 'Retro home video', prompt: 'Make a retro home video', re: /retro (home )?(video|movie|edit)|home video|super ?8|90s (video|camcorder)/, steps: () => [
    ['addStack', { stack: 'VHS Tape' }, 'Give it a VHS tape look.'], ['addEffect', { effect: 'dust' }, 'Add dust.'], ['addEffect', { effect: 'scanlines' }, 'Add scan lines.']] },
  { id: 'musicvideo', name: 'Music video', prompt: 'Make a music video', re: /music video|lyric video|beat edit|edit to (the )?music/, steps: (p) => [
    ['applyStyle', { styleId: 'hype' }, 'Apply the Hype style.'], ['addEffect', { effect: 'zoomPulse' }, 'Pulse the zoom on the beat.'], ['addEffect', { effect: 'chromaticAberration' }, 'Add lens fringing.'],
    ...(hasMusic(p) ? [['autoCutToBeat', { on: 'beats', every: 2 }, 'Cut on every second beat.'] as [ToolName, Args, string]] : [])] },
  { id: 'tutorial', name: 'Tutorial / explainer', prompt: 'Make a tutorial video', re: /tutorial (video|edit)|how[- ]to video|explainer (video|edit)|make.{0,12}tutorial/, steps: (p) => [
    ['removeSilences', {}, 'Cut the pauses.'], ['denoise', {}, 'Reduce noise.'], ['applyStyle', { styleId: 'explainer' }, 'Apply the Explainer style.'], ...(hasSpeech(p) ? [['addCaptions', {}, 'Add captions.'] as [ToolName, Args, string]] : [])] },
  { id: 'vlog', name: 'Vlog', prompt: 'Make a vlog edit', re: /vlog( edit| style)?|daily vlog|day in the life/, steps: () => [
    ['removeSilences', {}, 'Cut the pauses.'], ['changePacing', { factor: 0.8 }, 'Tighten the pacing.'], ['applyStyle', { styleId: 'editorial' }, 'Apply the Editorial style.'], ['addTransitions', { type: 'whip' }, 'Add whip-pan transitions.']] },
  { id: 'noir', name: 'Film noir', prompt: 'Make it film noir', re: /film noir|noir (look|style|edit)/, steps: () => [['addStack', { stack: 'Noir' }, 'Black and white with deep contrast and grain.'], ['addEffect', { effect: 'dust' }, 'Add dust.'], ['addEffect', { effect: 'letterbox' }, 'Add widescreen bars.']] }
]

export const ASSISTANT_PRESETS: { group: string; prompts: string[] }[] = [
  { group: 'Whole edits', prompts: RECIPES.map((r) => r.prompt) },
  { group: 'Looks', prompts: ['Make it cinematic', 'Give it a VHS tape look', 'Make it film noir', 'Add a teal and orange grade', 'Make it look like old film with dust and scratches', 'Add a cyberpunk neon look', 'Make it dreamy with a soft glow', 'Add film grain and a vignette', 'Add light leaks and a lens flare', 'Add letterbox bars', 'Make the colors pop', 'Make it warmer and brighter', 'Make it cooler and darker', 'Turn it black and white', 'Add a halftone comic look'] },
  { group: 'Camera and motion', prompts: ['Stabilize the shaky footage', 'Add a slow push-in', 'Add a handheld camera feel', 'Add a dolly zoom', 'Auto reframe to follow the action', 'Add a Ken Burns effect to the photos', 'Make it a hyperlapse', 'Add a 3D camera turn', 'Add camera shake'] },
  { group: 'Speed', prompts: ['Make it slow motion', 'Speed it up 2x', 'Add a speed ramp with a slow-motion hit in the middle', 'Freeze the frame for 2 seconds', 'Reverse the clip', 'Make it 60 fps'] },
  { group: 'Text', prompts: ['Add a neon title saying "Summer 2026"', 'Add a gold 3D title "The Grand Opening" at the start', 'Add a lower third "Alex Rivera, Director"', 'Add a retro pixel text "Game Over" at the end', 'Add a handwritten note "thank you" at the bottom', 'Add a glitch title "SYSTEM FAILURE"', 'Add a chrome title "TURBO" with a bounce', 'Add a meme caption "me when it works" at the top'] },
  { group: 'Transitions', prompts: ['Add motion blur whip transitions', 'Add beat shake transitions', 'Add beat punch transitions', 'Add zoom blur transitions', 'Add flash shake transitions', 'Add slam zoom transitions', 'Add whip pan transitions', 'Add glitch transitions', 'Add shatter transitions', 'Add dip to white transitions', 'Add liquid transitions', 'Add spin zoom transitions', 'Add cross dissolves'] },
  { group: 'Compositing', prompts: ['Make the green screen transparent', 'Put the clip in a picture in picture at the bottom right', 'Add a drop shadow and rounded corners', 'Make a double exposure', 'Blur the background', 'Add a reflection', 'Add a white border'] },
  { group: 'Sound and timing', prompts: ['Remove the silences', 'Lower the music while people talk', 'Make the music quieter', 'Fade in from black and fade out at the end', 'Cut to the beat every 2 beats', 'Cut on the snares', 'Clean up the background noise', 'Add captions', 'Remove the audio from the clips'] },
  { group: 'Sound effects', prompts: ['Add reverb to the voice', 'Make it sound like it is in a big cathedral', 'Add an echo', 'Boost the bass in the music', 'Make the voice sound like a robot', 'Make it sound like a phone call', 'Give me a megaphone voice', 'Make the voice a chipmunk', 'Pitch the voice down 3 semitones', 'Even out the volume with a compressor', 'Enhance the voice', 'Remove the vocals from the song', 'Isolate the vocals', 'Make the audio wider', 'Add a bouncing audio visualizer', 'Add a circular audio visualizer in pink'] },
  { group: 'Templates', prompts: ['Add the neon sign template saying "Night Owls"', 'Add the simple lower third template with "Alex Rivera" and "Director"', 'Add the cinematic title template saying "The Long Road"', 'Add the subscribe button template', 'Add the thanks for watching template at the end', 'Add the countdown template', 'Add the hook text template saying "Wait for the end"', 'Add the quote card template with "Less, but better." and "Dieter Rams"'] },
  { group: 'Looks and overlays', prompts: ['Apply the teal and orange colour look', 'Give it the dark trap look lut', 'Apply the kodak lut at 60%', 'Apply the noir lut', 'Add a warm light leak overlay', 'Add a film grain overlay over the whole video', 'Add a dust and scratches overlay', 'Add a white flash overlay', 'Add a glitch bars overlay', 'Add an anamorphic streak overlay', 'Remove the lut'] },
  { group: 'Batch edits', prompts: ['Cut all clips to 7 seconds', 'Trim every clip to 5 seconds and keep the last part', 'Make every photo 3 seconds', 'Split every clip every 10 seconds', 'Remove clips shorter than 2 seconds', 'Sort the clips by length', 'Shuffle the clips', 'Fade every clip in and out', 'Fill the frame with every clip', 'Remove all text', 'Remove all captions', 'Remove every transition', 'Render each clip at 1080p', 'Render all clips for TikTok', 'Render every clip in 4k 60fps h265', 'Export each clip as a small file for Discord', 'Export the project in 4k', 'Export the project for YouTube'] },
  { group: 'Format', prompts: ['Make it vertical for TikTok', 'Make it square', 'Make it widescreen for YouTube', 'Trim it to 30 seconds', 'Close the gaps', 'Remove all effects'] }
]

export interface Extras { steps: PlanStep[]; notes: string[]; recipe?: string; handledText: boolean; /** Words that named an effect or stack, so they are not also read as a whole editing style. */ consumed: string[] }

/** Everything the older rules did not cover. `request` keeps the user's capitals and quotes; `text` is lower-case. */
export function planExtras(request: string, text: string, project: Project, styleless: string): Extras {
  const steps: PlanStep[] = []
  const notes: string[] = []
  const add = (tool: ToolName, description: string, args: Args = {}): void => {
    if (!steps.some((s) => s.tool === tool && JSON.stringify(s.args) === JSON.stringify(args))) steps.push({ tool, args, description })
  }
  // "glitch style" means the whole style, so the word is kept out of the single-effect search.
  const consumed: string[] = []
  let rest = ` ${styleless.replace(/\b[a-z0-9-]+ styles?\b/g, ' style ')} `
  const eat = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(rest)
    if (m) rest = rest.replace(m[0], ' ')
    return m
  }
  let recipe: string | undefined
  for (const r of RECIPES) {
    if (r.re.test(text)) {
      recipe = r.id
      for (const [tool, args, description] of r.steps(project)) add(tool, description, args)
      break
    }
  }

  // ---- Text ----
  let handledText = false
  const quoted = /["“‘]([^"”’]{1,200})["”’]/.exec(request) ?? /'([^']{2,200})'/.exec(request)
  const textCue = /\b(add|put|show|insert|write|display|type|create|make|give)\b[^"“.]{0,40}\b(text|title|heading|headline|caption|lower third|subtitle|label|name tag|words?|note|sign)\b/.test(text) || /\b(saying|says|reading|that says|with the text)\b/.test(text)
  if (quoted && textCue) {
    handledText = true
    const outside = text.replace(quoted[0].toLowerCase(), ' ')
    const look = findTextLook(outside) ?? (/lower third/.test(outside) ? 'lowerThird' : /subtitle|small text/.test(outside) ? 'subtitle' : 'title')
    const animation = findTextAnimation(outside.replace(TEXT_LOOKS[look]?.words.join('|') ?? '', ' '))?.type
    const place = /\b(top|upper|above)\b/.test(outside) ? 'top' : /\b(bottom|lower|below)\b/.test(outside) ? 'bottom' : /\b(center|centre|middle)\b/.test(outside) ? 'center' : undefined
    const dur = new RegExp(`for ${NUM} ?(?:s|sec|secs|seconds?)`).exec(outside)
    const at = new RegExp(`at ${NUM} ?(?:s|sec|secs|seconds?)`).exec(outside)
    const where = /\bat the (end|finish|close)\b/.test(outside) ? 'end' : /\bat the (start|beginning|intro|opening)\b/.test(outside) ? 'start' : /\bin the middle\b/.test(outside) ? 'middle' : undefined
    const colourWord = Object.keys(COLOURS).find((c) => new RegExp(`\\b${c}\\b`).test(outside) && !(c === 'gold' && look === 'gold'))
    const args: Args = { content: quoted[1], look }
    if (animation) args.animation = animation
    if (place) args.place = place
    if (dur) args.duration = num(dur[1])
    if (at) args.start = num(at[1])
    if (where) args.at = where
    const font = findFont(outside)
    if (font) args.font = font
    if (colourWord && look !== 'gold' && look !== 'chrome') args.color = COLOURS[colourWord]
    add('addText', `Add the ${TEXT_LOOKS[look]?.name.toLowerCase() ?? 'text'} “${quoted[1].slice(0, 40)}”${animation ? ` with a ${animation} animation` : ''}.`, args)
    // The words that styled the title ("neon", "gold"...) must not also be read as effects on the video.
    rest = rest.replace(quoted[0].toLowerCase(), ' ').replace(/\b(?:[a-z0-9-]+ ){0,4}(?:title|text|heading|headline|lower third|subtitle|note|label|sign|caption|words?)\b(?: (?:saying|says|reading|at the \w+|for \d+ ?\w+|at \d+ ?\w+|in the \w+|with an? \w+ animation))*/g, ' ')
  } else if (textCue && /\b(title|text|lower third|heading)\b/.test(text) && !/captions?|subtitles?/.test(text)) {
    notes.push('Tell me what the text should say, in quotes. For example: Add a neon title saying "Summer 2026".')
  }

  // ---- Transitions with a name ----
  const trPhrase = eat(/\b(?:with|add|use|put|apply|give)?\s*(?:a |an |some |the )?([a-z0-9 -]{2,24}?)\s+transitions?\b/) ?? eat(/\btransitions?\s+(?:like|of|using|with|to)\s+(?:a |an )?([a-z0-9 -]{2,24})/)
  if (trPhrase) {
    const tr = findTransition(trPhrase[1])
    if (tr) add('addTransitions', `Add ${tr.name.toLowerCase()} transitions at every cut.`, { type: tr.type })
  }

  if (!trPhrase && /\b(cross ?dissolves?|cross ?fades?|dissolves)\b/.test(text)) add('addTransitions', 'Add cross dissolves at every cut.', { type: 'fade' })

  // ---- Stacks and effects ----
  const stackMatch = findStackMatch(rest)
  const stack = stackMatch?.stack
  if (stack) {
    consumed.push(stackMatch!.alias)
    add('addStack', `Add the ${stack.name} stack of effects.`, { stack: stack.name })
    // Blank out the words the stack used, so they are not also read as single effects.
    for (const w of [stack.name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' '), 'teal and orange', 'dreamy', 'cyberpunk', 'noir', 'vhs tape', 'vhs', 'old film', 'golden hour', 'vaporwave', 'security cam']) rest = rest.split(w).join(' ')
  }
  const cue = /\b(effect|effects|filter|add|apply|put|give|with|use|want|turn)\b/.test(text)
  for (const e of findEffects(rest)) {
    if (AMBIGUOUS.has(e.type) && !cue) continue
    // "blurred background" is the background-blur effect, not a plain blur as well.
    if (e.type === 'blur' && findEffects(rest).some((x) => x.type === 'backgroundBlur')) continue
    consumed.push(e.alias)
    add('addEffect', `Add the ${e.name} effect.`, { effect: e.type })
  }

  // ---- Colour words ----
  const level = /\b(slightly|a (little|bit)|subtly|bit)\b/.test(text) ? 0.5 : /\b(much|very|way|super|a lot|really|heavily)\b/.test(text) ? 1.7 : 1
  const delta: Record<string, number> = {}
  const nudge = (re: RegExp, key: string, v: number): void => { if (re.test(text)) delta[key] = (delta[key] ?? 0) + v * level }
  nudge(/\b(warmer|warm tone|warm up)\b/, 'temperature', 0.25)
  nudge(/\b(cooler|colder|cool tone|cool down)\b/, 'temperature', -0.25)
  nudge(/\b(brighter|lighter|brighten|more exposure)\b/, 'exposure', 0.15)
  nudge(/\b(darker|dimmer|darken|moodier|less exposure)\b/, 'exposure', -0.15)
  nudge(/\b(more contrast|punchier|contrasty|contrast up|pop)\b/, 'contrast', 0.2)
  nudge(/\b(less contrast|flatter|softer contrast)\b/, 'contrast', -0.2)
  nudge(/\b(more saturat\w*|vibrant|vivid|more colou?r(ful)?|colou?rs? pop|saturate)\b/, 'saturation', 0.3)
  nudge(/\b(desaturat\w*|less saturat\w*|muted|washed out|less colou?r)\b/, 'saturation', -0.3)
  nudge(/\b(faded|matte|lifted blacks)\b/, 'fade', 0.2)
  nudge(/\b(more green|green tint)\b/, 'tint', -0.2)
  nudge(/\b(more magenta|pink tint|magenta tint)\b/, 'tint', 0.2)
  if (Object.keys(delta).length) {
    const parts = Object.entries(delta).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`)
    add('adjustColor', `Adjust the colour: ${parts.join(', ')}.`, delta)
  }

  // ---- Speed ----
  const slowMo = /\b(slow ?-?mo(tion)?|slowmo|in slow motion|half speed|slow motion)\b/.test(text)
  const xs = new RegExp(`${NUM} ?x\\b`).exec(text)
  const asked = /\bspeed ramp|ramp (the )?speed|bullet time|slow.{0,20}(in the middle|hit)\b/.test(text)
  if (asked) add('speedRamp', 'Ramp the speed: normal, then a slow-motion dip in the middle, then back to normal.', { from: 1, to: 0.25, shape: 'bell' })
  else if (slowMo) add('setSpeed', `Play the clips at ${xs ? 1 / (num(xs[1]) || 2) : 0.5}× speed.`, { speed: xs ? 1 / (num(xs[1]) || 2) : 0.5 })
  else if (/\b(timelapse|time ?lapse|hyper ?lapse)\b/.test(text)) add('hyperlapse', 'Speed the clip up 10× with frame blending and stabilisation.', { speed: 10 })
  else if (/\b(double|twice) (the )?speed\b|\bspeed (the )?(clips?|footage|video|this)( up)?\b|\bsped up\b|\bfast ?forward\b|\bspeed up (the )?(clips?|footage|video)/.test(text) || (xs && /speed|faster|fast/.test(text))) {
    const speed = /\b(double|twice)\b/.test(text) ? 2 : xs ? num(xs[1]) || 2 : 2
    add('setSpeed', `Play the clips at ${speed}× speed.`, { speed })
  }
  if (/\b(reverse|backwards?|rewind|play it in reverse)\b/.test(text)) add('reverse', 'Play the clips backwards.')
  const freeze = new RegExp(`\\bfreeze( ?frame)?\\b(?:.{0,30}?(?:for ${NUM} ?(?:s|sec|seconds?)))?`).exec(text)
  if (freeze) {
    const hold = new RegExp(`for ${NUM} ?(?:s|sec|secs|seconds?)`).exec(text)
    const at = new RegExp(`at ${NUM} ?(?:s|sec|secs|seconds?)`).exec(text)
    add('freezeFrame', 'Hold one frame of the clip.', { hold: hold ? num(hold[1]) : 2, ...(at ? { at: num(at[1]) } : {}) })
  }
  const fps = /\b(24|25|30|48|50|60|72|90|100|120|144|165|240|360|480|500|1000) ?fps\b/.exec(text)
  if (fps) add('setFps', `Set the project to ${fps[1]} frames per second.`, { fps: Number(fps[1]) })

  // ---- Camera ----
  if (/\b(stabili[sz]e|stabili[sz]ation|steady(?:cam)?|de-?shake|remove (the )?shake|fix (the )?shak|less shaky|smooth(?:en)?\b.{0,12}(shaky|footage|camera)|shaky footage)\b/.test(text)) add('stabilize', 'Steady the shaky footage by measuring and cancelling the camera shake.')
  if (/\b(auto ?-?reframe|reframe|follow the (action|subject|person|player)|keep .{0,20}in frame)\b/.test(text)) add('reframe', 'Fill the frame and pan to follow the action.')
  if (/\bken burns\b|\bpan and zoom (on|the) (the )?(photos?|images?|pictures?)|photos? .{0,15}(move|pan|zoom)/.test(text)) add('kenBurns', 'Give every photo a slow pan and zoom.')

  // ---- Compositing ----
  if (/\b(picture[- ]in[- ]picture|pip|inset)\b/.test(text)) {
    const corner = /\btop.{0,6}left\b/.test(text) ? 'tl' : /\btop.{0,6}right\b/.test(text) ? 'tr' : /\bbottom.{0,6}left\b/.test(text) ? 'bl' : 'br'
    add('pip', 'Shrink the clip into a corner as a picture-in-picture with rounded corners and a shadow.', { corner })
  }
  if (/\bdouble exposure\b/.test(text)) add('setBlend', 'Blend the clip over the one beneath it as a double exposure.', { mode: 'screen' })
  const blend = /\b(multiply|screen|overlay|soft light|hard light|color dodge|color burn|darken|lighten|difference|exclusion|luminosity)\b.{0,12}\b(blend|mode)\b|\bblend (?:mode )?(?:of |to |as )?(multiply|screen|overlay|soft light|hard light|color dodge|color burn|darken|lighten|difference|exclusion|luminosity)\b/.exec(text)
  if (blend) {
    const raw = (blend[1] ?? blend[3]).replace(/ (\w)/g, (_, c: string) => c.toUpperCase())
    add('setBlend', `Set the blend mode to ${blend[1] ?? blend[3]}.`, { mode: raw })
  }

  if (/\b(visuali[sz]er|audio (bars|spectrum|waves?)|sound ?waves?|spectrum|equali[sz]er bars|music bars|bouncing bars|audio reactive|reacts? to the (music|sound))\b/.test(text)) {
    const style = /\b(ring|circle|circular|radial)\b/.test(text) ? 'circle' : /\b(wave|waveform)\b/.test(text) ? 'wave' : /\bdots?\b/.test(text) ? 'dots' : /\bmirror(ed)?\b/.test(text) ? 'mirror' : 'bars'
    const colour = Object.keys(COLOURS).find((c) => new RegExp(`\\b${c}\\b`).test(text))
    add('addVisualizer', `Add a ${style} audio visualizer that moves with the sound.`, { style, ...(colour ? { color: COLOURS[colour] } : {}) })
  }

  // ---- Sound effects ----
  const audioWho: 'music' | 'video' | 'all' = /\b(music|song|soundtrack|beat)\b/.test(text) ? 'music' : /\b(voice|speech|talking|vocals?|dialogue|narration|interview)\b/.test(text) ? 'video' : 'all'
  const addSound = (effect: string, description: string, params: Args = {}): void => add('addAudioEffect', description, { effect, who: audioWho, ...params })
  if (/\b(reverb|cathedral|in a (big |large )?(hall|room|church)|spacious sound|big room)\b/.test(text)) addSound('reverb', 'Add reverb.', { size: /cathedral|church|hall|big|large/.test(text) ? 0.85 : 0.5 })
  else if (/\becho(es|ey)?\b|\bdelay (effect|the (sound|voice|audio))\b/.test(text) && !/\bremove (the )?echo\b/.test(text)) addSound('echo', 'Add an echo.')
  if (/\b(bass boost|boost (the )?bass|more bass|bass(y| heavy)|heavier bass|add bass)\b/.test(text)) addSound('bass', 'Boost the bass.', { amount: /much|heavy|a lot|super/.test(text) ? 14 : 8 })
  if (/\b(more treble|brighter sound|crisper|add treble|boost (the )?treble)\b/.test(text)) addSound('eq', 'Brighten the sound (more treble).', { high: 6 })
  if (/\b(less treble|muffled|muffle|darker sound|underwater|cut (the )?treble)\b/.test(text)) addSound('eq', 'Muffle the sound (less treble).', { high: -12, mid: -3 })
  const voice = /\b(chipmunk|squeaky|helium)\b/.test(text) ? 0 : /\b(deep(er)? voice|monster voice|lower (the |his |her )?voice|demon)\b/.test(text) ? 1 : /\b(robot(ic)?|dalek|android)( voice| sound)?\b/.test(text) ? 2 : /\b(telephone|phone call|on the phone|phone voice)\b/.test(text) ? 3 : /\b(megaphone|loudspeaker|bullhorn)\b/.test(text) ? 4 : /\b(old radio|radio voice|walkie|vintage radio|am radio)\b/.test(text) ? 5 : -1
  if (voice >= 0) add('addAudioEffect', `Change the voice: ${['chipmunk', 'deep', 'robot', 'telephone', 'megaphone', 'old radio'][voice]}.`, { effect: 'voice', who: audioWho === 'music' ? 'music' : 'video', preset: voice })
  const pitch = new RegExp(`\\bpitch\\b.{0,12}\\b(up|higher|down|lower)\\b(?:.{0,12}?${NUM} ?(?:semitones?|steps?|notes?))?|\\b(higher|lower) pitch\\b`).exec(text)
  if (pitch) {
    const up = /up|higher/.test(pitch[1] ?? pitch[3] ?? '')
    const st = pitch[2] ? num(pitch[2]) : 3
    addSound('pitch', `Shift the pitch ${up ? 'up' : 'down'} ${st} semitones (heard in the export).`, { semitones: up ? st : -st })
  }
  if (/\b(compress(or|ion)?|even out (the )?(volume|levels?|sound)|level(l)?ing the (volume|sound)|more consistent (volume|levels?))\b/.test(text)) addSound('compressor', 'Even out the loudness with a compressor.')
  if (/\b(limiter|stop (the )?clipping|prevent clipping|avoid clipping|no clipping)\b/.test(text)) addSound('limiter', 'Add a limiter so peaks never clip.')
  if (/\b(distort(ed|ion)?|overdrive|crunch(y)?|fuzz)\b/.test(text) && /\b(audio|sound|voice|music|guitar|bass|vocals?)\b/.test(text)) addSound('distortion', 'Add distortion.')
  if (/\b(wider|widen|stereo width|wide stereo)\b/.test(text) && /\b(stereo|sound|audio|music|mix)\b/.test(text)) addSound('width', 'Widen the stereo image.', { amount: 1.8 })
  else if (/\b(make (it|the (sound|audio)) mono|mono mix|to mono)\b/.test(text)) addSound('width', 'Fold the sound to mono.', { amount: 0 })
  if (/\b(isolate|keep only|extract) (the )?(vocals?|voice|singer)\b/.test(text)) addSound('vocals', 'Keep the centre (voice) of the stereo mix.', { mode: 0 })
  else if (/\b(remove|take out|mute|strip) (the )?(vocals?|singer|singing|lyrics)\b|\bkaraoke\b|\binstrumental( version)?\b/.test(text)) addSound('vocals', 'Remove the centre vocals from the stereo mix.', { mode: 1 })
  if (/\b(enhance|improve|clearer|clean up|polish|studio|podcast)\b.{0,14}\b(voice|speech|vocals?|dialogue|narration)\b|\b(voice|speech|dialogue) (clearer|better|enhance\w*)\b/.test(text)) addSound('voiceEnhance', 'Enhance the voice: remove rumble and hiss, add presence and even out the level (not AI).', {})

  // ---- Fades, volume, trimming ----
  const fadeIn = /\bfade (it |the video |the clip )?in\b|\bfade in\b|\bfade from black\b/.test(text)
  const fadeOut = /\bfade (it |the video |the clip )?out\b|\bfade to black\b|\bfade at the end\b/.test(text)
  if (fadeIn || fadeOut) add('fade', `Fade ${fadeIn && fadeOut ? 'in at the start and out at the end' : fadeIn ? 'in at the start' : 'out at the end'}.`, { where: fadeIn && fadeOut ? 'both' : fadeIn ? 'in' : 'out', seconds: 1 })
  const music = /\b(music|song|soundtrack|track|background (music|audio))\b/.test(text)
  const pct = /(\d{1,3}) ?%/.exec(text)
  if (/\b(mute|silence|turn off|remove)\b.{0,10}\b(the )?(music|song|soundtrack)\b/.test(text)) add('setVolume', 'Mute the music.', { who: 'music', level: 0 })
  else if (/\b(louder|turn up|boost|raise|increase)\b/.test(text) && /\b(music|audio|sound|voice|volume|video)\b/.test(text)) add('setVolume', 'Raise the volume.', { who: music ? 'music' : /voice|video|speech/.test(text) ? 'video' : 'all', level: 1.5 })
  else if ((/\b(quieter|lower|turn down|softer|reduce)\b/.test(text) && music && !/while|when|under|during/.test(text)) || (pct && music)) add('setVolume', pct ? `Set the music to ${pct[1]}%.` : 'Make the music quieter.', { who: 'music', level: pct ? Number(pct[1]) / 100 : 0.5 })
  const trim = new RegExp(`\\b(?:trim|cut|shorten|make|limit|keep)\\b.{0,25}\\b(?:to|down to|under|no longer than|at most|just)\\s+${NUM} ?(seconds?|secs?|s|minutes?|mins?)\\b`).exec(text)
  if (trim && !/montage|highlight/.test(text)) {
    const v = num(trim[1]) * (trim[2].startsWith('m') ? 60 : 1)
    if (v > 0) add('trimTo', `Cut the timeline down to ${v} seconds.`, { seconds: v })
  }
  if (/\b(close|remove|get rid of|fill|delete) (all |the )?(gaps?|empty (space|spots?))\b/.test(text)) add('closeGaps', 'Slide clips together to close the gaps.')
  if (/\b(remove|clear|delete|strip|reset)\b.{0,12}\b(all )?(the )?(effects|filters)\b/.test(text)) add('clearEffects', 'Remove the effects from the clips (the applied style stays).')

  return { steps, notes, recipe, handledText, consumed }
}

/** Compact lists of ids for the language-model prompt. */
export const CATALOGUE_IDS = {
  effects: EFFECTS.map((e) => e.type).join('|'),
  projectLength: (p: Project): string => projectDuration(p).toFixed(1)
}
