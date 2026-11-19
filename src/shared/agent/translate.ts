/** Translating captions with a local language model (Ollama). The model only returns text; timing and layout are kept. */
import type { Clip, Project, Word } from '../types'

export const TARGET_LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Polish', 'Croatian', 'Serbian', 'Turkish', 'Russian', 'Ukrainian', 'Japanese', 'Korean', 'Chinese', 'Hindi', 'Arabic']

export interface CaptionLine { id: string; text: string }

/** The caption clips, in time order, with their plain text. */
export function captionLines(project: Project): CaptionLine[] {
  return project.tracks.flatMap((t) => t.clips).filter((c) => c.origin === 'caption' && c.text).sort((a, b) => a.start - b.start).map((c) => ({ id: c.id, text: c.text!.words?.length ? c.text!.words.map((w) => w.text).join(' ') : c.text!.content.replace(/\*/g, '') }))
}

export function translationPrompt(lines: CaptionLine[], language: string): string {
  const input = JSON.stringify(lines.map((l) => l.text))
  return `Translate these subtitle lines into ${language}. Keep each line short and natural for subtitles. Return ONLY a JSON array of ${lines.length} strings, in the same order, with no extra text.\n${input}`
}

/** Reads the model's reply: a JSON array of strings (possibly inside a code block), or numbered lines as a fallback. */
export function parseTranslation(reply: string, expected: number): string[] | null {
  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(reply.slice(start, end + 1))
      if (Array.isArray(arr) && arr.length === expected && arr.every((x) => typeof x === 'string')) return arr.map((x: string) => x.trim())
    } catch {
      // fall through to the line format
    }
  }
  const numbered = reply.split(/\r?\n/).map((l) => /^\s*(\d+)[.):-]\s*(.+)$/.exec(l)).filter((m): m is RegExpExecArray => Boolean(m))
  if (numbered.length === expected) return numbered.map((m) => m[2].trim().replace(/^["“]|["”]$/g, ''))
  return null
}

/** Spreads words evenly across a caption's duration (the translation has no word timings of its own). */
export function evenWords(text: string, duration: number): Word[] {
  const parts = text.split(/\s+/).filter(Boolean)
  const per = duration / Math.max(1, parts.length)
  return parts.map((t, i) => ({ text: t, start: i * per, end: (i + 1) * per }))
}

/** Replaces each caption's text with its translation, keeping its look, timing and position. */
export function applyTranslation(project: Project, lines: CaptionLine[], translated: string[]): Project {
  const byId = new Map(lines.map((l, i) => [l.id, translated[i]]))
  const swap = (c: Clip): Clip => {
    const text = byId.get(c.id)
    if (text === undefined || !c.text) return c
    return { ...c, text: { ...c.text, content: text, words: c.text.words ? evenWords(text, c.duration) : undefined } }
  }
  return { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.map(swap) })) }
}

/** Translates in batches so long videos fit a small model's window. */
export async function translateCaptions(project: Project, language: string, ask: (prompt: string) => Promise<string>, batch = 25): Promise<{ project: Project; translated: number; failed: number }> {
  const lines = captionLines(project)
  const out: (string | null)[] = []
  for (let i = 0; i < lines.length; i += batch) {
    const slice = lines.slice(i, i + batch)
    let result: string[] | null = null
    for (let attempt = 0; attempt < 2 && !result; attempt++) result = parseTranslation(await ask(translationPrompt(slice, language)), slice.length)
    out.push(...(result ?? slice.map(() => null)))
  }
  const ok = lines.filter((_, i) => out[i] !== null)
  const next = applyTranslation(project, ok, ok.map((_, k) => out.filter((x): x is string => x !== null)[k]))
  return { project: next, translated: ok.length, failed: lines.length - ok.length }
}
