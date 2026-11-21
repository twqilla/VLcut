import type { TextProps } from '@shared/types'

/** The ready-made text styles in the Text tab (they can also be dragged onto the timeline). */
export const TEXT_PRESETS: { name: string; sample: string; text: Partial<TextProps> }[] = [
  { name: 'Headline', sample: 'Headline', text: { content: 'Headline', fontFamily: 'Inter', weight: 900, fontSize: 0.11, animation: 'slideUp' } },
  { name: 'Editorial pair', sample: 'Bold & italic', text: { content: 'Say it *beautifully.*', fontFamily: 'Inter', weight: 700, fontSize: 0.09, accentFontFamily: 'Instrument Serif', accentItalic: true, color: '#f3ead7', animation: 'words' } },
  { name: 'Label chip', sample: 'LABEL', text: { content: 'EDITED', fontFamily: 'JetBrains Mono', weight: 700, fontSize: 0.03, letterSpacing: 0.18, uppercase: true, color: '#1a1408', boxColor: '#e8b45a', boxRadius: 0.15, shadow: 0, animation: 'fade' } },
  { name: 'Impact', sample: 'IMPACT', text: { content: 'IMPACT', fontFamily: 'Anton', weight: 400, fontSize: 0.18, uppercase: true, animation: 'pop' } },
  { name: 'Serif title', sample: 'A quiet title', text: { content: 'A quiet title', fontFamily: 'Cormorant Garamond', weight: 400, fontSize: 0.1, letterSpacing: 0.04, animation: 'tracking' } },
  { name: 'Marker', sample: 'Scribble', text: { content: 'VIRAL', fontFamily: 'Permanent Marker', weight: 400, fontSize: 0.16, color: '#ff4a3d', animation: 'drop' } },
  { name: 'Terminal', sample: '> typed out', text: { content: '> typed out', fontFamily: 'VT323', weight: 400, fontSize: 0.08, color: '#7dff9b', animation: 'typewriter', shadow: 0 } },
  { name: 'Blocky game', sample: 'CRAFT', text: { content: 'CRAFT', fontFamily: 'Monocraft', weight: 400, fontSize: 0.09, color: '#ffffff', extrudeDepth: 0.02, extrudeAngle: 45, extrudeColor: '#3a3a3a', shadow: 0, animation: 'fade' } },
  { name: 'Lower third', sample: 'Name · Role', text: { content: 'Name Surname\n*Role or location*', fontFamily: 'DM Sans', weight: 700, fontSize: 0.045, align: 'left', accentFontFamily: 'DM Sans', accentItalic: false, accentColor: '#c9c3b5', boxColor: '#141311', animation: 'fade' } }
]
