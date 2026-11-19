/** Built-in overlay clips (light leaks, film grain, dust, flashes, glitch bars): what the library lists. The generator is main/media/overlays.ts. */
import type { BlendMode } from './types'

export type OverlayCategory = 'Light leaks' | 'Film' | 'Flashes' | 'Digital'

export interface OverlayInfo {
  id: string
  name: string
  category: OverlayCategory
  seconds: number
  /** How it should sit on the picture: light is added ('screen'), grain is blended in ('overlay'). */
  blend: BlendMode
  opacity: number
  tags: string[]
}

const o = (id: string, name: string, category: OverlayCategory, seconds: number, blend: BlendMode, opacity: number, ...tags: string[]): OverlayInfo => ({ id, name, category, seconds, blend, opacity, tags })

export const OVERLAY_CATALOG: OverlayInfo[] = [
  o('leakWarm', 'Warm light leak', 'Light leaks', 5, 'screen', 0.85, 'orange', 'sun', 'film', 'leak'),
  o('leakCool', 'Cool light leak', 'Light leaks', 5, 'screen', 0.85, 'blue', 'teal', 'leak'),
  o('leakRainbow', 'Rainbow light leak', 'Light leaks', 5, 'screen', 0.8, 'prism', 'colour', 'leak'),
  o('filmBurn', 'Film burn', 'Light leaks', 5, 'screen', 0.9, 'orange', 'edge', 'burn'),
  o('streak', 'Anamorphic streak', 'Light leaks', 5, 'screen', 0.9, 'flare', 'lens', 'blue', 'cinematic'),
  o('grain', 'Film grain', 'Film', 3, 'overlay', 0.55, 'noise', 'texture'),
  o('dust', 'Dust and scratches', 'Film', 4, 'screen', 0.8, 'old', 'speck', 'scratch'),
  o('flash', 'White flash', 'Flashes', 0.6, 'screen', 1, 'hit', 'camera', 'beat'),
  o('flashWarm', 'Warm flash', 'Flashes', 0.6, 'screen', 1, 'hit', 'beat'),
  o('glitchBars', 'Glitch bars', 'Digital', 4, 'screen', 0.9, 'rgb', 'error', 'digital'),
  o('vhsNoise', 'VHS tracking', 'Digital', 5, 'screen', 0.8, 'tape', 'retro', 'noise')
]

export function searchOverlays(query: string, category?: OverlayCategory): OverlayInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return OVERLAY_CATALOG.filter((x) => (!category || x.category === category) && words.every((w) => `${x.name} ${x.category} ${x.tags.join(' ')}`.toLowerCase().includes(w)))
}

/** Other ways to name an overlay in a request. */
export const OVERLAY_ALIASES: Record<string, string[]> = {
  leakWarm: ['warm light leak', 'light leak', 'light leaks', 'sun leak'], leakCool: ['cool light leak', 'blue light leak'], leakRainbow: ['rainbow light leak', 'rainbow leak', 'prism'], filmBurn: ['film burn'],
  streak: ['anamorphic streak', 'lens streak', 'streak', 'anamorphic flare', 'blue streak'], grain: ['film grain', 'grain'], dust: ['dust and scratches', 'dust', 'scratches', 'old film'],
  flash: ['white flash', 'flash'], flashWarm: ['warm flash'], glitchBars: ['glitch bars', 'glitch'], vhsNoise: ['vhs tracking', 'vhs noise', 'vhs']
}
