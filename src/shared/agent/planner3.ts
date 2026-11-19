/**
 * Batch commands: "cut all clips to 7 seconds", "split every 5 seconds", "render each clip as 1080p",
 * "remove all text"... These act on every clip (or the selected ones) at once. Each rule blanks the words
 * it used, so the general rules in `planRequest` do not read them a second time.
 */
import type { PlanStep, ToolName } from './planner'
import { parseRenderSpec, type RenderSpec } from './batch'
import { OVERLAY_ALIASES, OVERLAY_CATALOG } from '../overlayCatalog'
import { LOOKS, LOOK_ALIASES } from '../color/looks'
import { MOTION_TEMPLATES } from '../motionTemplates'

type Args = PlanStep['args']
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, sixty: 60 }
const num = (s: string): number => (/^\d/.test(s) ? Number(s) : NUMBER_WORDS[s] ?? NaN)
const N = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)'
/** Other ways to name a template. */
const TEMPLATE_ALIASES: Record<string, string[]> = {
  cleanTitle: ['clean title', 'title card'], slamIntro: ['slam intro', 'slam'], cinematicTitle: ['cinematic title', 'cinematic'], neonSign: ['neon sign', 'neon'], glitchIntro: ['glitch intro', 'glitch'],
  lowerSimple: ['simple lower third', 'lower third'], lowerBox: ['boxed lower third', 'box lower third'], lowerTag: ['minimal tag', 'tag'], lowerHandle: ['social handle', 'handle'],
  chapter: ['chapter title', 'chapter'], quote: ['quote card', 'quote'], kinetic: ['kinetic words', 'kinetic'], countdown: ['countdown'], thanks: ['thanks for watching', 'thank you', 'outro'],
  credits: ['credits card', 'credits'], subscribe: ['subscribe prompt', 'subscribe button', 'subscribe'], hookTop: ['hook text', 'hook'], pov: ['pov label', 'pov'], beforeAfter: ['before and after labels', 'before after', 'before / after labels']
}
const SECS = '(?:seconds?|secs?|s)\\b'
const MINS = '(?:minutes?|mins?)\\b'
/** "every clip", "all my clips", "each of the videos", "all the photos", "the selected clips". */
const WHO = '(?:(?:all|every|each|both)(?: of)?(?: the| my| these| those)?|(?:the |these |those )?selected)'
const THING = '(?:clips?|videos?|shots?|photos?|pictures?|images?|pieces|footage|tracks?)'

export interface BatchPlan { steps: PlanStep[]; notes: string[]; /** The request with the words these rules used taken out. */ rest: string }

/** The first "7 seconds" / "2 minutes" in a phrase, in seconds (NaN when there is none). */
function lengthIn(phrase: string): number {
  const m = new RegExp(`${N} ?(${SECS}|${MINS})`).exec(phrase)
  return m ? num(m[1]) * (/^m/.test(m[2]) ? 60 : 1) : NaN
}

export function planBatch(text: string, original = text): BatchPlan {
  const steps: PlanStep[] = []
  const notes: string[] = []
  let rest = text
  const add = (tool: ToolName, description: string, args: Args = {}): void => {
    if (!steps.some((s) => s.tool === tool && JSON.stringify(s.args) === JSON.stringify(args))) steps.push({ tool, args, description })
  }
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(rest)
    if (m) rest = rest.replace(m[0], ' ')
    return m
  }
  const scopeOf = (phrase: string): 'all' | 'selected' => (/selected/.test(phrase) ? 'selected' : 'all')

  // ---- Overlays and colour looks from the library ----
  const phraseOf = (w: string): RegExp => new RegExp(`\\b${w.replace(/[-.]/g, '[- ]?').replace(/&/g, '(?:&|and)')}s?\\b`)
  if (/\boverlays?\b/.test(rest)) {
    const found = OVERLAY_CATALOG.flatMap((x) => [x.name.toLowerCase(), ...(OVERLAY_ALIASES[x.id] ?? [])].map((w) => ({ x, w }))).sort((a, b) => b.w.length - a.w.length).find(({ w }) => phraseOf(w).test(rest))
    if (found) {
      const cover = /\b(whole|entire|all|throughout|across|over the (?:whole|entire) (?:video|timeline|edit))\b/.test(rest) ? 1 : 0
      const at = /\bat (\d+(?:\.\d+)?) ?(?:s|sec|secs|seconds?)\b/.exec(rest)?.[1]
      add('addOverlay', `Add the ${found.x.name.toLowerCase()} overlay${cover ? ' across the whole timeline' : ''}${at ? ` at ${at} seconds` : ''}.`, { overlay: found.x.id, at: at ? Number(at) : 0, cover })
      rest = rest.replace(phraseOf(found.w), ' ').replace(/\boverlays?\b/, ' ')
    }
  }
  if (/\b(?:luts?|colou?r look|built-in look)\b/.test(rest)) {
    if (/\b(?:remove|clear|undo|take off|no)\b/.test(rest)) {
      add('removeLook', 'Remove the built-in colour look from the clips.')
      rest = rest.replace(/\b(?:luts?|colou?r look|built-in look)\b/, ' ')
    } else {
      const found = LOOKS.flatMap((x) => [x.name.toLowerCase(), ...(LOOK_ALIASES[x.id] ?? [])].map((w) => ({ x, w }))).sort((a, b) => b.w.length - a.w.length).find(({ w }) => phraseOf(w).test(rest))
      if (found) {
        const pct = /(\d{1,3}) ?%/.exec(rest)
        add('applyLook', `Give the clips the “${found.x.name}” colour look${pct ? ` at ${pct[1]}%` : ''}.`, { look: found.x.id, intensity: pct ? Math.min(100, Number(pct[1])) / 100 : 1 })
        rest = rest.replace(phraseOf(found.w), ' ').replace(/\b(?:luts?|colou?r look|built-in look)\b/, ' ').replace(/(\d{1,3}) ?%/, ' ')
      }
    }
  }

  // ---- Templates ("add the neon sign template saying "Night Owls"") ----
  if (/\btemplates?\b/.test(rest)) {
    const found = MOTION_TEMPLATES.flatMap((x) => [x.name.toLowerCase(), ...(TEMPLATE_ALIASES[x.id] ?? [])].map((w) => ({ x, w }))).sort((a, b) => b.w.length - a.w.length).find(({ w }) => phraseOf(w).test(rest))
    if (found) {
      const quotes = [...original.matchAll(/["“‘]([^"”’]{1,120})["”’]/g)].map((m) => m[1])
      const textFields = found.x.fields.filter((f) => f.kind !== 'color')
      const values: Record<string, string> = {}
      quotes.slice(0, textFields.length).forEach((q, i) => { values[textFields[i].key] = q })
      const at = /\bat the (end|finish)\b/.test(rest) ? 'end' : /\bat (\d+(?:\.\d+)?) ?(?:s|sec|secs|seconds?)\b/.exec(rest)?.[1] ?? 'start'
      add('addTemplate', `Add the “${found.x.name}” template${quotes.length ? ` with ${quotes.map((q) => `“${q}”`).join(' and ')}` : ''}${at === 'end' ? ' at the end' : at === 'start' ? ' at the start' : ` at ${at} seconds`}.`, { template: found.x.id, values: JSON.stringify(values), at: /^\d/.test(at) ? Number(at) : at })
      rest = rest.replace(phraseOf(found.w), ' ').replace(/\btemplates?\b/, ' ').replace(/["“‘][^"”’]*["”’]/g, ' ')
    }
  }

  // ---- Render / export ----
  // The whole clause after the verb is spec ("... in 4k for tiktok"), so it is not read as an edit.
  const perClip = new RegExp(`\\b(?:render|export|encode|save)\\b[^.;\\n]{0,30}\\b(?:${WHO}) ${THING}\\b[^.;\\n]*|\\b(?:render|export|encode)\\b[^.;\\n]{0,40}\\b(?:separately|individually|one by one|as separate (?:files|videos)|each on (?:its|their) own)\\b[^.;\\n]*`).exec(rest)
  if (perClip) {
    const spec = parseRenderSpec(perClip[0])
    rest = rest.replace(perClip[0], ' ')
    add('renderClips', `Render ${/selected/.test(perClip[0]) ? 'each selected clip' : 'each clip'} to its own video file${describe(spec)}. You choose the folder.`, { spec: JSON.stringify(spec), scope: scopeOf(perClip[0]) })
  } else {
    const whole = /\b(?:render|export|encode)\b[^.;\n]*/.exec(rest)
    if (whole) {
      const spec = parseRenderSpec(whole[0])
      if (Object.keys(spec).length || /\b(project|video|timeline|edit|movie|everything|it|this|final|file)\b/.test(whole[0])) {
        rest = rest.replace(whole[0], ' ')
        add('exportProject', `Export the whole project to one video file${describe(spec)}. You choose where to save it.`, { spec: JSON.stringify(spec) })
      }
    }
  }

  // ---- Remove short clips ----
  const short = take(new RegExp(`\\b(?:remove|delete|drop|get rid of|discard)\\b[^.;\\n]{0,14}\\b${THING}\\b[^.;\\n]{0,14}\\b(?:shorter than|under|less than|below|smaller than)\\s+${N} ?(?:(${SECS})|(${MINS}))`))
  if (short) {
    const s = lengthIn(short[0])
    add('removeShort', `Delete every clip shorter than ${s} seconds and close the gaps.`, { seconds: s })
  }

  // ---- Trim every clip ----
  const keepOf = (s: string): 'start' | 'end' | 'middle' => (/\b(last|end|ending|final)\b/.test(s) ? 'end' : /\b(middle|centre|center|best part)\b/.test(s) ? 'middle' : 'start')
  const trim =
    take(new RegExp(`\\b(?:cut|trim|shorten|limit|cap|clip|crop|shrink|keep|make|set)\\b[^.;\\n]{0,14}\\b${WHO} ${THING}\\b[^.;\\n]{0,24}?\\b(?:to|at|under|down to|no longer than|max(?:imum)?(?: of)?|at most|only|just|be)\\s+${N} ?(?:(${SECS})|(${MINS}))(?:[^.;\\n]{0,40}\\b(?:first|start|beginning|last|end|middle|centre|center)\\b)?`)) ??
    take(new RegExp(`\\b${WHO} ${THING}\\b[^.;\\n]{0,10}\\b(?:max(?:imum)?|at most|no longer than|under|cap(?:ped)? at)\\s+${N} ?(?:(${SECS})|(${MINS}))`)) ??
    take(new RegExp(`\\b(?:make|set)\\b[^.;\\n]{0,8}\\b${WHO} ${THING}\\b[^.;\\n]{0,10}?\\b(?:be |last |play for |run for |show for )?${N} ?(?:(${SECS})|(${MINS}))`)) ??
    take(new RegExp(`\\b(?:keep|take|use|only)\\b[^.;\\n]{0,10}\\b(?:the )?(first|last)\\s+${N} ?(?:(${SECS})|(${MINS}))\\s+(?:of|from)\\s+${WHO} ${THING}`))
  if (trim) {
    const s = lengthIn(trim[0])
    if (s > 0) {
      const keep = keepOf(trim[0])
      const photosToo = /\b(photos?|pictures?|images?)\b/.test(trim[0]) || /\b(make|set)\b/.test(trim[0])
      add('trimClips', `Cut ${/selected/.test(trim[0]) ? 'each selected clip' : 'every clip'} down to ${s} seconds, keeping the ${keep === 'start' ? 'beginning' : keep === 'end' ? 'end' : 'middle'}. Shorter clips stay as they are and the gaps close up.`, { seconds: s, keep, scope: scopeOf(trim[0]), photos: photosToo ? 1 : 0 })
    }
  }

  // ---- Split into equal pieces ----
  const split =
    take(new RegExp(`\\b(?:split|cut|chop|slice|divide|break)\\b[^.;\\n]{0,24}\\b(?:every|each)\\s+${N} ?(?:(${SECS})|(${MINS}))`)) ??
    take(new RegExp(`\\b(?:split|cut|chop|slice|divide|break)\\b[^.;\\n]{0,30}\\binto\\s+${N}[- ]?(?:(?:${SECS})|(?:${MINS}))[- ]?(?:long |pieces|parts|chunks|clips|segments)?`))
  if (split) {
    const s = lengthIn(split[0])
    if (s >= 0.25) add('splitEvery', `Cut ${/selected/.test(split[0]) ? 'each selected clip' : 'every clip'} into ${s}-second pieces.`, { seconds: s, scope: /selected/.test(split[0]) ? 'selected' : 'all' })
  }

  // ---- Sort and shuffle ----
  if (take(/\b(?:shuffle|randomi[sz]e|mix up|scramble)\b[^.;\n]{0,20}\b(?:clips?|shots?|videos?|photos?|order)\b/)) add('sortClips', 'Shuffle the order of the clips on the main track.', { by: 'shuffle' })
  else {
    const sort = take(/\b(?:sort|order|arrange|reorder|rearrange)\b[^.;\n]{0,20}\b(?:clips?|shots?|videos?|photos?)\b[^.;\n]{0,14}\b(?:by|from|with|starting)?\s*(?:the )?(shortest|longest|length|duration|name|alphabet\w*|a-z|filename)?(?: first)?/)
    if (sort) {
      const w = sort[0]
      const by = /longest/.test(w) ? 'longest' : /name|alphabet|a-z|filename/.test(w) ? 'name' : 'length'
      add('sortClips', `Put the clips on the main track in order of ${by === 'name' ? 'file name' : by === 'longest' ? 'length, longest first' : 'length, shortest first'}.`, { by })
    }
  }

  // ---- Fade every clip ----
  const fade =
    take(new RegExp(`\\b(?:add |give |put )?(?:a )?(?:${N} ?(?:${SECS}) )?fades?(?: in and out| in/out)?(?: to| on| for)? ${WHO} ${THING}\\b(?: (?:in and out|in/out))?(?: (?:of|for|by) ${N} ?${SECS})?`)) ??
    take(new RegExp(`\\bfade\\b[^.;\\n]{0,6}\\b${WHO} ${THING}\\b(?: in and out)?(?: (?:of|for|by) ${N} ?${SECS})?`))
  if (fade) {
    const s = lengthIn(fade[0])
    add('fadeEach', 'Give every clip a short fade in and out.', { seconds: s > 0 ? s : 0.5 })
  }

  // ---- Fill the frame ----
  if (take(/\b(?:fill|cover|crop to fill|zoom to fill|scale to fill|stretch to fill)\b[^.;\n]{0,14}\b(?:the )?(?:frame|screen|canvas)\b|\b(?:remove|get rid of|no|without)\b[^.;\n]{0,10}\bblack bars\b/)) add('fillFrame', 'Scale every clip up just enough to fill the frame (no black bars; the edges are cropped).')

  // ---- Remove every item of a kind ----
  const kinds: [RegExp, string, string][] = [
    [/\b(?:titles?|text|texts|text overlays?|lower thirds?)\b/, 'text', 'text and titles'],
    [/\b(?:captions?|subtitles?)\b/, 'captions', 'captions'],
    [/\b(?:shapes?|stickers?)\b/, 'shapes', 'shapes'],
    [/\b(?:layers?|overlays?)\b/, 'layers', 'layers'],
    [/\btransitions?\b/, 'transitions', 'transitions'],
    [/\b(?:visuali[sz]ers?)\b/, 'visualizers', 'audio visualizers']
  ]
  const removeVerb = take(/\b(?:remove|delete|clear|strip|get rid of|take off|take out)\b[^.;\n]{0,10}\b(?:all|every|each)\b[^.;\n]{0,12}\b(?:titles?|text|texts|text overlays?|lower thirds?|captions?|subtitles?|shapes?|stickers?|layers?|overlays?|transitions?|visuali[sz]ers?)\b/)
  if (removeVerb) {
    const k = kinds.find(([re]) => re.test(removeVerb[0]))
    if (k) add('removeKind', `Delete all ${k[2]} from the timeline.`, { kind: k[1] })
  }
  return { steps, notes, rest }
}

function describe(spec: RenderSpec): string {
  const bits: string[] = []
  if (spec.presetId) bits.push(`the ${spec.presetId} preset`)
  if (spec.short) bits.push(`${spec.short}p`)
  if (spec.fps) bits.push(`${spec.fps} fps`)
  if (spec.codec) bits.push(spec.codec === 'h265' ? 'H.265' : 'H.264')
  if (spec.crf) bits.push(spec.crf <= 16 ? 'high quality' : spec.crf >= 26 ? 'small file' : 'standard quality')
  return bits.length ? ` (${bits.join(', ')})` : ' with your current export settings'
}
