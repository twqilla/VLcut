import '@fontsource/inter/400.css'
import '@fontsource/inter/400-italic.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/900.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/archivo-black/400.css'
import '@fontsource/anton/400.css'
import '@fontsource/bebas-neue/400.css'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource/playfair-display/400.css'
import '@fontsource/playfair-display/400-italic.css'
import '@fontsource/playfair-display/700.css'
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/400-italic.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/vt323/400.css'
import '@fontsource/permanent-marker/400.css'
import './fontFaces'
import { FONTS } from '@shared/effects/registry'

import { create } from 'zustand'
import { mediaUrl } from '../format'

/** Names of fonts the user has added, for font menus. */
export const useCustomFonts = create<{ names: string[] }>(() => ({ names: [] }))

/** Registers the user's own font files so text can use them in the preview and the export. */
export async function loadCustomFonts(list?: { name: string; path: string }[]): Promise<void> {
  const fonts = list ?? (await window.api.fonts.list())
  await Promise.all(
    fonts.map(async (f) => {
      if ([...document.fonts].some((x) => x.family === f.name)) return
      try {
        document.fonts.add(await new FontFace(f.name, `url("${mediaUrl(f.path)}")`).load())
      } catch {
        // A damaged font file is skipped; text falls back to the default font.
      }
    })
  )
  useCustomFonts.setState({ names: fonts.map((f) => f.name) })
}

let ready: Promise<void> | undefined

/** Canvas text silently falls back to a system font unless the web font is loaded first. */
export function ensureFonts(): Promise<void> {
  ready ??= Promise.all([loadCustomFonts().catch(() => undefined),
    FONTS.flatMap((f) => [`400 20px "${f}"`, `700 20px "${f}"`, `italic 400 20px "${f}"`].map((spec) => document.fonts.load(spec).catch(() => [])))
  ]).then(() => undefined)
  return ready
}
