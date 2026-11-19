/** Plain-language search over the media library: file names, measured shot qualities and transcripts. */
import type { MediaAsset, Shot } from '../types'

export interface SearchHit {
  asset: MediaAsset
  /** Present when a specific shot matched. */
  shot?: Shot
  shotIndex?: number
  /** Source time to jump to. */
  time: number
  score: number
  /** Why it matched, for display. */
  reason: string
}

/** Words people use, mapped to the tags the analyser produces. */
const SYNONYMS: Record<string, string[]> = {
  static: ['static'], still: ['static'], tripod: ['static'], locked: ['static'], calm: ['static', 'gentle-motion'], slow: ['gentle-motion', 'static'],
  moving: ['gentle-motion', 'fast-motion'], moves: ['gentle-motion', 'fast-motion'], movement: ['gentle-motion', 'fast-motion'], motion: ['gentle-motion', 'fast-motion'],
  pan: ['pan-left', 'pan-right'], camera: [], fast: ['fast-motion'], action: ['fast-motion'], shaky: ['fast-motion'], energetic: ['fast-motion'], dynamic: ['fast-motion'],
  dark: ['dark'], night: ['dark'], moody: ['dark'], shadow: ['dark'], bright: ['bright'], sunny: ['bright'], daylight: ['bright'], light: ['bright'],
  colorful: ['colorful'], colourful: ['colorful'], vivid: ['colorful'], saturated: ['colorful'], muted: ['muted'], grey: ['muted'], gray: ['muted'], desaturated: ['muted'],
  talking: ['sound'], speech: ['sound'], speaking: ['sound'], dialogue: ['sound'], voice: ['sound'], loud: ['sound'], silent: ['quiet'], quiet: ['quiet'],
  towards: ['push-in'], toward: ['push-in'], approaches: ['push-in'], approaching: ['push-in'], closer: ['push-in'], push: ['push-in'], pushes: ['push-in'], zoom: ['push-in', 'pull-out'], zooms: ['push-in', 'pull-out'], zooming: ['push-in', 'pull-out'],
  away: ['pull-out'], pulls: ['pull-out'], pull: ['pull-out'], back: ['pull-out'], backwards: ['pull-out'], reveal: ['pull-out'],
  pans: ['pan-left', 'pan-right'], panning: ['pan-left', 'pan-right'], tilt: ['tilt-up', 'tilt-down'], tilts: ['tilt-up', 'tilt-down'],
  short: ['short'], quick: ['short'], long: ['long'], best: [], good: []
}
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and', 'or', 'with', 'where', 'find', 'show', 'me', 'clips', 'clip', 'shots', 'shot', 'footage', 'video', 'videos', 'is', 'are', 'that', 'which', 'all', 'my'])

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

export function searchMedia(media: MediaAsset[], query: string, limit = 40): SearchHit[] {
  const terms = words(query).filter((w) => !STOP.has(w))
  if (!terms.length) return []
  const wantsBest = /\b(best|good|great|strongest)\b/i.test(query)
  const hits: SearchHit[] = []

  for (const asset of media) {
    const nameWords = words(asset.name)
    const nameMatches = terms.filter((t) => nameWords.some((w) => w.includes(t)))
    if (nameMatches.length) hits.push({ asset, time: 0, score: nameMatches.length * 2, reason: `File name contains “${nameMatches.join(', ')}”` })

    const analysis = asset.analysis
    if (!analysis) continue

    analysis.shots.forEach((shot, shotIndex) => {
      const matched = terms.filter((t) => (SYNONYMS[t] ?? []).some((tag) => shot.tags.includes(tag)))
      // Words from a local vision model's description of the picture.
      const seen = words(shot.description ?? '')
      const described = terms.filter((t) => t.length > 2 && seen.some((w) => w === t || w === `${t}s` || t === `${w}s`))
      if (!matched.length && !described.length && !wantsBest) return
      if (!matched.length && !described.length && shot.score < 0.5) return
      const camera = shot.camera && matched.some((t) => SYNONYMS[t].includes(shot.camera!)) ? 3 : 0
      hits.push({ asset, shot, shotIndex, time: shot.start, score: matched.length + camera + described.length * 2 + shot.score * (wantsBest ? 2 : 0.5), reason: described.length ? `Shows ${shot.description}${matched.length ? ` · ${shot.tags.filter((tag) => matched.some((t) => SYNONYMS[t].includes(tag))).join(', ')}` : ''}` : matched.length ? `Looks ${shot.tags.filter((tag) => matched.some((t) => SYNONYMS[t].includes(tag))).join(', ')}` : `Rated ${Math.round(shot.score * 100)}%` })
    })

    // Phrase search in the transcript.
    const transcript = analysis.transcript ?? []
    const spoken = transcript.map((w) => words(w.text)[0] ?? '')
    for (let i = 0; i < spoken.length; i++) {
      let n = 0
      while (n < terms.length && spoken[i + n] === terms[n]) n++
      if (n === terms.length || (n === 0 && terms.length === 1 && spoken[i].startsWith(terms[0]) && terms[0].length > 2)) {
        const from = Math.max(0, i - 3)
        hits.push({ asset, time: transcript[i].start, score: 3 + n, reason: `Says “…${transcript.slice(from, i + Math.max(n, 1) + 3).map((w) => w.text).join(' ')}…”` })
        i += Math.max(n, 1)
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
