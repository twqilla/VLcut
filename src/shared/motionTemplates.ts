/**
 * Ready-made intros, lower thirds, title cards, end cards and social prompts. Each is built from the same text and
 * shape clips you can make by hand, so after placing one every part stays editable on the timeline.
 */
import type { Clip, Project, ShapeProps, TextProps } from './types'
import { shapeClip, textClip } from './timeline/model'
import * as ops from './timeline/ops'

export type TemplateCategory = 'Intros' | 'Lower thirds' | 'Titles' | 'End cards' | 'Social'
export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['Intros', 'Lower thirds', 'Titles', 'End cards', 'Social']

export interface TemplateField { key: string; label: string; default: string; kind?: 'text' | 'color' }

/** One part of a template: its clip starts at `clip.start` seconds after the template's own start. */
export interface Layer { kind: 'text' | 'shape'; clip: Clip }

export interface MotionTemplate {
  id: string
  name: string
  category: TemplateCategory
  /** What it looks like in a few words, shown under the name. */
  blurb: string
  seconds: number
  fields: TemplateField[]
  build(f: Record<string, string>): Layer[]
}

const text = (content: string, props: Partial<TextProps>, at: number, dur: number, x = 0, y = 0): Layer => {
  const clip = textClip(at, { content, ...props }, dur)
  return { kind: 'text', clip: { ...clip, transform: { ...clip.transform, x, y } } }
}
const shape = (props: Partial<ShapeProps>, at: number, dur: number, x = 0, y = 0): Layer => {
  const clip = shapeClip(at, props, dur)
  return { kind: 'shape', clip: { ...clip, transform: { ...clip.transform, x, y } } }
}
const title = (key = 'title'): TemplateField => ({ key, label: 'Title', default: 'Your title' })
const sub = (key = 'subtitle', def = 'A short line underneath'): TemplateField => ({ key, label: 'Subtitle', default: def })
const accent = (def = '#e8a33d'): TemplateField => ({ key: 'color', label: 'Accent colour', default: def, kind: 'color' })

export const MOTION_TEMPLATES: MotionTemplate[] = [
  {
    id: 'cleanTitle', name: 'Clean title card', category: 'Intros', blurb: 'Big title, a line that draws itself, a subtitle', seconds: 4, fields: [title(), sub(), accent('#ffffff')],
    build: (f) => [
      text(f.title, { fontFamily: 'Inter', weight: 800, fontSize: 0.1, animation: 'slideUp', animationOut: 'fade' }, 0, 4, 0, -0.04),
      shape({ kind: 'line', width: 0.28, fill: f.color, stroke: f.color, strokeWidth: 0.004, animation: 'draw' }, 0.4, 3.4, 0, 0.05),
      text(f.subtitle, { fontFamily: 'Inter', weight: 400, fontSize: 0.04, letterSpacing: 0.12, uppercase: true, animation: 'fade', animationOut: 'fade' }, 0.8, 3.2, 0, 0.1)
    ]
  },
  {
    id: 'slamIntro', name: 'Slam intro', category: 'Intros', blurb: 'Heavy uppercase title that pops in over a colour bar', seconds: 3, fields: [title(), sub('subtitle', 'Season one'), accent('#ff3b3b')],
    build: (f) => [
      shape({ kind: 'rect', width: 0.8, height: 0.2, fill: f.color, radius: 0.06, animation: 'grow' }, 0, 3, 0, 0),
      text(f.title, { fontFamily: 'Anton', weight: 400, uppercase: true, fontSize: 0.15, color: '#ffffff', animation: 'pop', animationOut: 'fade', shadow: 0.4 }, 0.15, 2.85, 0, -0.005),
      text(f.subtitle, { fontFamily: 'Inter', weight: 700, fontSize: 0.035, letterSpacing: 0.2, uppercase: true, animation: 'fade' }, 0.7, 2.3, 0, 0.17)
    ]
  },
  {
    id: 'cinematicTitle', name: 'Cinematic title', category: 'Intros', blurb: 'Wide-spaced serif title between two thin lines', seconds: 5, fields: [title(), sub('subtitle', 'A film by you')],
    build: (f) => [
      shape({ kind: 'line', width: 0.5, fill: '#ffffff', stroke: '#ffffff', strokeWidth: 0.002, animation: 'draw' }, 0, 5, 0, -0.1),
      text(f.title, { fontFamily: 'Cormorant Garamond', weight: 400, fontSize: 0.1, letterSpacing: 0.16, uppercase: true, animation: 'tracking', animationOut: 'fade' }, 0.3, 4.7, 0, 0),
      shape({ kind: 'line', width: 0.5, fill: '#ffffff', stroke: '#ffffff', strokeWidth: 0.002, animation: 'draw' }, 0, 5, 0, 0.1),
      text(f.subtitle, { fontFamily: 'Inter', weight: 300, fontSize: 0.028, letterSpacing: 0.3, uppercase: true, animation: 'fade', animationOut: 'fade' }, 1.2, 3.8, 0, 0.155)
    ]
  },
  {
    id: 'neonSign', name: 'Neon sign', category: 'Intros', blurb: 'Glowing neon title with a flicker-in', seconds: 4, fields: [title('title'), { key: 'color', label: 'Glow colour', default: '#22d3ee', kind: 'color' }],
    build: (f) => [text(f.title, { fontFamily: 'Orbitron', weight: 700, fontSize: 0.11, color: '#f4ffff', glowColor: f.color, glowAmount: 1, animation: 'fade', animationOut: 'fade', shadow: 0 }, 0, 4)]
  },
  {
    id: 'glitchIntro', name: 'Glitch intro', category: 'Intros', blurb: 'Glitching title and a mono tagline', seconds: 3, fields: [title('title'), sub('subtitle', 'SYSTEM ONLINE')],
    build: (f) => [
      text(f.title, { fontFamily: 'Space Grotesk', weight: 700, fontSize: 0.12, uppercase: true, animation: 'glitch', animationOut: 'fade' }, 0, 3, 0, -0.02),
      text(f.subtitle, { fontFamily: 'JetBrains Mono', weight: 500, fontSize: 0.03, color: '#7dff9b', letterSpacing: 0.15, animation: 'typewriter' }, 0.6, 2.4, 0, 0.08)
    ]
  },
  {
    id: 'lowerSimple', name: 'Simple lower third', category: 'Lower thirds', blurb: 'Name and role beside a colour bar', seconds: 5, fields: [{ key: 'name', label: 'Name', default: 'Alex Rivera' }, { key: 'role', label: 'Role', default: 'Director' }, accent()],
    build: (f) => [
      shape({ kind: 'rect', width: 0.008, height: 0.1, fill: f.color, radius: 0, animation: 'grow' }, 0, 5, -0.4, 0.34),
      text(f.name, { fontFamily: 'DM Sans', weight: 700, fontSize: 0.045, align: 'left', animation: 'slideRight', animationOut: 'fade' }, 0.1, 4.8, -0.2, 0.315),
      text(f.role, { fontFamily: 'DM Sans', weight: 400, fontSize: 0.03, align: 'left', color: '#d8d8d8', animation: 'slideRight', animationOut: 'fade' }, 0.25, 4.65, -0.2, 0.365)
    ]
  },
  {
    id: 'lowerBox', name: 'Boxed lower third', category: 'Lower thirds', blurb: 'Name on a colour box, role on a dark one', seconds: 5, fields: [{ key: 'name', label: 'Name', default: 'Alex Rivera' }, { key: 'role', label: 'Role', default: 'Director' }, accent('#2563eb')],
    build: (f) => [
      text(f.name, { fontFamily: 'Archivo Black', weight: 400, fontSize: 0.04, align: 'left', boxColor: f.color, boxPadding: 0.45, boxRadius: 0.05, animation: 'slideRight', animationOut: 'fade' }, 0, 5, -0.28, 0.31),
      text(f.role, { fontFamily: 'Inter', weight: 600, fontSize: 0.028, align: 'left', boxColor: '#0b1020e6', boxPadding: 0.45, boxRadius: 0.05, animation: 'slideRight', animationOut: 'fade' }, 0.2, 4.8, -0.28, 0.375)
    ]
  },
  {
    id: 'lowerTag', name: 'Minimal tag', category: 'Lower thirds', blurb: 'One small chip in the corner', seconds: 4, fields: [{ key: 'label', label: 'Label', default: 'Tokyo, Japan' }, accent('#ffffff')],
    build: (f) => [text(f.label, { fontFamily: 'JetBrains Mono', weight: 600, fontSize: 0.03, letterSpacing: 0.08, uppercase: true, color: '#101010', boxColor: f.color, boxPadding: 0.5, boxRadius: 0.3, animation: 'pop', animationOut: 'fade' }, 0, 4, -0.33, 0.4)]
  },
  {
    id: 'lowerHandle', name: 'Social handle', category: 'Lower thirds', blurb: 'Your @handle in a rounded chip', seconds: 5, fields: [{ key: 'handle', label: 'Handle', default: '@yourname' }, accent('#ff2d6f')],
    build: (f) => [text(f.handle, { fontFamily: 'Poppins', weight: 600, fontSize: 0.035, color: '#ffffff', boxColor: f.color, boxPadding: 0.5, boxRadius: 0.5, animation: 'slideUp', animationOut: 'fade' }, 0, 5, 0.3, 0.38)]
  },
  {
    id: 'chapter', name: 'Chapter title', category: 'Titles', blurb: 'Big number with the chapter name', seconds: 4, fields: [{ key: 'number', label: 'Number', default: '01' }, title('title'), accent()],
    build: (f) => [
      text(f.number, { fontFamily: 'Anton', weight: 400, fontSize: 0.22, color: f.color, animation: 'scaleUp', animationOut: 'fade' }, 0, 4, 0, -0.06),
      text(f.title, { fontFamily: 'Inter', weight: 600, fontSize: 0.05, letterSpacing: 0.18, uppercase: true, animation: 'fade', animationOut: 'fade' }, 0.5, 3.5, 0, 0.1)
    ]
  },
  {
    id: 'quote', name: 'Quote card', category: 'Titles', blurb: 'A quotation in serif type with the author below', seconds: 6, fields: [{ key: 'quote', label: 'Quote', default: 'Make something people want.' }, { key: 'author', label: 'Author', default: 'Someone wise' }],
    build: (f) => [
      text(`“${f.quote}”`, { fontFamily: 'Playfair Display', weight: 500, italic: true, fontSize: 0.065, lineHeight: 1.25, animation: 'fade', animationOut: 'fade' }, 0, 6, 0, -0.03),
      text(`— ${f.author}`, { fontFamily: 'Inter', weight: 500, fontSize: 0.032, letterSpacing: 0.1, color: '#cfcfcf', animation: 'fade', animationOut: 'fade' }, 1, 5, 0, 0.12)
    ]
  },
  {
    id: 'kinetic', name: 'Kinetic words', category: 'Titles', blurb: 'Words pop in one after another', seconds: 3, fields: [{ key: 'text', label: 'Words', default: 'MAKE IT COUNT' }],
    build: (f) => [text(f.text, { fontFamily: 'Montserrat', weight: 900, fontSize: 0.12, uppercase: true, animation: 'words', animationOut: 'fade', shadow: 0.3 }, 0, 3)]
  },
  {
    id: 'countdown', name: 'Countdown 3-2-1', category: 'Titles', blurb: 'Three big numbers, one second each', seconds: 3, fields: [accent('#ffffff')],
    build: (f) => ['3', '2', '1'].map((n, i) => text(n, { fontFamily: 'Anton', weight: 400, fontSize: 0.3, color: f.color, animation: 'pop', animationOut: 'fade' }, i, 1))
  },
  {
    id: 'thanks', name: 'Thanks for watching', category: 'End cards', blurb: 'A closing thank-you and a call to action', seconds: 6, fields: [{ key: 'title', label: 'Message', default: 'Thanks for watching' }, { key: 'cta', label: 'Call to action', default: 'Follow for more' }, accent('#ff2d6f')],
    build: (f) => [
      text(f.title, { fontFamily: 'Inter', weight: 800, fontSize: 0.08, animation: 'slideUp', animationOut: 'fade' }, 0, 6, 0, -0.05),
      text(f.cta, { fontFamily: 'Inter', weight: 700, fontSize: 0.04, color: '#ffffff', boxColor: f.color, boxPadding: 0.5, boxRadius: 0.4, animation: 'pop', animationOut: 'fade' }, 0.8, 5.2, 0, 0.09)
    ]
  },
  {
    id: 'credits', name: 'Credits card', category: 'End cards', blurb: 'Three credit lines with roles', seconds: 7, fields: [{ key: 'l1', label: 'Line 1', default: 'Directed by Alex Rivera' }, { key: 'l2', label: 'Line 2', default: 'Music by Sam Lee' }, { key: 'l3', label: 'Line 3', default: 'Edited in VLcut' }],
    build: (f) => [f.l1, f.l2, f.l3].map((l, i) => text(l, { fontFamily: 'Inter', weight: i === 0 ? 700 : 400, fontSize: i === 0 ? 0.05 : 0.04, color: i === 0 ? '#ffffff' : '#c9c9c9', animation: 'fade', animationOut: 'fade' }, 0.5 + i * 0.7, 6 - i * 0.7, 0, -0.08 + i * 0.1))
  },
  {
    id: 'subscribe', name: 'Subscribe prompt', category: 'Social', blurb: 'A rounded button that pops in', seconds: 4, fields: [{ key: 'label', label: 'Button text', default: 'SUBSCRIBE' }, accent('#ff0033')],
    build: (f) => [text(f.label, { fontFamily: 'Poppins', weight: 800, fontSize: 0.04, letterSpacing: 0.08, color: '#ffffff', boxColor: f.color, boxPadding: 0.55, boxRadius: 0.2, animation: 'pop', animationOut: 'fade' }, 0, 4, 0.3, 0.36)]
  },
  {
    id: 'hookTop', name: 'Hook text', category: 'Social', blurb: 'A bold hook line at the top of the frame', seconds: 3, fields: [{ key: 'text', label: 'Hook', default: 'Wait for the end' }],
    build: (f) => [text(f.text, { fontFamily: 'Montserrat', weight: 800, fontSize: 0.06, color: '#111111', boxColor: '#ffffff', boxPadding: 0.5, boxRadius: 0.15, animation: 'pop', animationOut: 'fade' }, 0, 3, 0, -0.34)]
  },
  {
    id: 'pov', name: 'POV label', category: 'Social', blurb: 'A "POV:" caption with a highlighted line', seconds: 4, fields: [{ key: 'text', label: 'Text', default: 'you finally learn to edit' }, accent('#ffe14a')],
    build: (f) => [text(`POV: *${f.text}*`, { fontFamily: 'Inter', weight: 800, fontSize: 0.055, accentFontFamily: 'Inter', accentColor: f.color, outlineWidth: 0.05, animation: 'fade', animationOut: 'fade' }, 0, 4, 0, -0.3)]
  },
  {
    id: 'beforeAfter', name: 'Before / after labels', category: 'Social', blurb: 'Two small labels for a comparison', seconds: 5, fields: [{ key: 'a', label: 'Left label', default: 'BEFORE' }, { key: 'b', label: 'Right label', default: 'AFTER' }],
    build: (f) => [
      text(f.a, { fontFamily: 'Inter', weight: 800, fontSize: 0.035, letterSpacing: 0.12, color: '#ffffff', boxColor: '#000000b3', boxPadding: 0.5, boxRadius: 0.2, animation: 'fade', animationOut: 'fade' }, 0, 5, -0.25, -0.4),
      text(f.b, { fontFamily: 'Inter', weight: 800, fontSize: 0.035, letterSpacing: 0.12, color: '#ffffff', boxColor: '#000000b3', boxPadding: 0.5, boxRadius: 0.2, animation: 'fade', animationOut: 'fade' }, 0, 5, 0.25, -0.4)
    ]
  }
]

export const templateById = (id: string): MotionTemplate | undefined => MOTION_TEMPLATES.find((t) => t.id === id)

/** The template's fields filled in: what was given, else the default. Control characters are removed and text is kept short. */
export function templateValues(t: MotionTemplate, given: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(t.fields.map((f) => {
    const raw = typeof given[f.key] === 'string' ? given[f.key] : f.default
    const clean = f.kind === 'color' ? (/^#[0-9a-f]{6}$/i.test(raw) ? raw : f.default) : raw.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 200)
    return [f.key, clean]
  }))
}

/**
 * Puts a template on the timeline starting at `at`. Each part goes on a track with room for it (text parts on text
 * tracks, shapes on video tracks), adding tracks above when the ones there are busy.
 */
export function insertTemplate(project: Project, t: MotionTemplate, given: Record<string, string>, at: number): { project: Project; ids: string[] } {
  let next = project
  const ids: string[] = []
  for (const layer of t.build(templateValues(t, given))) {
    const clip = { ...layer.clip, start: Math.max(0, at) + layer.clip.start }
    const kind = layer.kind === 'text' ? 'text' : 'video'
    let track = next.tracks.find((tr) => tr.kind === kind && !tr.locked && ops.freeStart(tr, clip.start, clip.duration) === clip.start)
    if (!track) {
      next = ops.addTrack(next, kind)
      track = next.tracks[0] // new picture and text tracks go on top
    }
    next = ops.addClip(next, track.id, clip)
    ids.push(clip.id)
  }
  return { project: next, ids }
}
