/** Themes and layouts the person can change in Settings. Pure data plus validation, so shared theme files can be trusted. */

export const THEME_COLOR_KEYS = ['bg', 'panel', 'raised', 'field', 'line', 'lineStrong', 'text', 'textHi', 'muted', 'accent', 'accentHi', 'onAccent', 'warn', 'danger', 'video', 'audio', 'image'] as const
export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number]

/** Names shown in the editor, and the CSS variable each one sets. */
export const THEME_COLOR_LABELS: Record<ThemeColorKey, { label: string; css: string; group: 'Surfaces' | 'Text' | 'Accent' | 'Clips and status' }> = {
  bg: { label: 'Background', css: '--bg', group: 'Surfaces' },
  panel: { label: 'Panels', css: '--panel', group: 'Surfaces' },
  raised: { label: 'Buttons and cards', css: '--raised', group: 'Surfaces' },
  field: { label: 'Input fields', css: '--field', group: 'Surfaces' },
  line: { label: 'Lines', css: '--line', group: 'Surfaces' },
  lineStrong: { label: 'Strong lines', css: '--line-strong', group: 'Surfaces' },
  text: { label: 'Text', css: '--text', group: 'Text' },
  textHi: { label: 'Bright text', css: '--text-hi', group: 'Text' },
  muted: { label: 'Dim text', css: '--muted', group: 'Text' },
  accent: { label: 'Accent', css: '--accent', group: 'Accent' },
  accentHi: { label: 'Accent highlight', css: '--accent-hi', group: 'Accent' },
  onAccent: { label: 'Text on accent', css: '--accent-ink', group: 'Accent' },
  warn: { label: 'Warning', css: '--warn', group: 'Clips and status' },
  danger: { label: 'Error', css: '--danger', group: 'Clips and status' },
  video: { label: 'Video clips', css: '--video', group: 'Clips and status' },
  audio: { label: 'Audio clips', css: '--audio', group: 'Clips and status' },
  image: { label: 'Image clips', css: '--image', group: 'Clips and status' }
}

export interface Theme {
  id: string
  name: string
  colors: Record<ThemeColorKey, string>
  /** Corner rounding in pixels (0 = square). */
  radius: number
  /** Font family for the interface; empty for the default. */
  font: string
  /** Base text size in pixels. */
  fontSize: number
  density: 'compact' | 'comfortable' | 'spacious'
  /** The soft glow around active controls. */
  glow: boolean
}

export interface Layout {
  /** Which side the tall preview column sits on. */
  previewSide: 'left' | 'right'
  /** Properties and Assistant above the preview instead of below it. */
  inspectorAbove: boolean
  /** Media library above the timeline, or in a column beside it. */
  librarySide: 'top' | 'left' | 'right'
  showLibrary: boolean
  showInspector: boolean
}

/** Style modifiers: looks that stack on top of any theme, in any combination. */
export const STYLE_MODS = [
  { id: 'neon', name: 'Neon', note: 'Glowing accent outlines and light-up text.' },
  { id: 'glass', name: 'Glass', note: 'Frosted, see-through panels over a soft colour glow.' },
  { id: 'aurora', name: 'Aurora', note: 'A slowly shifting colour glow behind everything.' },
  { id: 'outline', name: 'Outline', note: 'Wireframe look: thin lines, no fills.' },
  { id: 'brutal', name: 'Brutalist', note: 'Thick borders and hard offset shadows.' },
  { id: 'depth', name: 'Depth', note: 'Raised panels with soft, deep shadows.' },
  { id: 'gradient', name: 'Gradient', note: 'Accent-tinted gradients on panels and buttons.' },
  { id: 'mono', name: 'Monospace', note: 'Typewriter-style interface font.' },
  { id: 'scan', name: 'Scanlines', note: 'A faint CRT line pattern over the interface.' }
] as const
export type StyleModId = (typeof STYLE_MODS)[number]['id']

/** Ready-made combinations. */
export const MOD_COMBOS: { name: string; mods: StyleModId[] }[] = [
  { name: 'Cyberpunk', mods: ['neon', 'scan', 'mono'] },
  { name: 'Frosted', mods: ['glass', 'aurora', 'depth'] },
  { name: 'Blueprint', mods: ['outline', 'mono'] },
  { name: 'Poster', mods: ['brutal', 'gradient'] },
  { name: 'Night club', mods: ['neon', 'aurora', 'glass'] }
]

export interface AppSettings {
  /** Style modifiers switched on. */
  mods: StyleModId[]
  themeId: string
  customThemes: Theme[]
  layout: Layout
}

const midnight: Theme['colors'] = { bg: '#000000', panel: '#06080d', raised: '#0d121c', field: '#000000', line: '#151d2e', lineStrong: '#232f4a', text: '#e8eefc', textHi: '#ffffff', muted: '#8593b3', accent: '#2f80ff', accentHi: '#6aa9ff', onAccent: '#ffffff', warn: '#f2b84b', danger: '#ff6b7f', video: '#6aa9ff', audio: '#4fd1b5', image: '#f2b84b' }

const make = (id: string, name: string, colors: Partial<Theme['colors']>, rest: Partial<Omit<Theme, 'id' | 'name' | 'colors'>> = {}): Theme => ({ id, name, colors: { ...midnight, ...colors }, radius: 0, font: '', fontSize: 13, density: 'comfortable', glow: true, ...rest })

export const BUILTIN_THEMES: Theme[] = [
  make('midnight', 'Midnight (default)', {}),
  make('graphite', 'Graphite', { bg: '#0a0a0b', panel: '#121214', raised: '#1b1b1f', field: '#0a0a0b', line: '#26262b', lineStrong: '#383840', text: '#e6e6ea', muted: '#8d8d99', accent: '#3d78f0', accentHi: '#86b0ff' }, { glow: false }),
  make('daylight', 'Daylight (light)', { bg: '#e9edf5', panel: '#ffffff', raised: '#f1f4fa', field: '#ffffff', line: '#d5dbe8', lineStrong: '#b6c0d6', text: '#1b2434', textHi: '#000000', muted: '#5b6781', accent: '#2563eb', accentHi: '#1d4ed8', onAccent: '#ffffff', warn: '#b7791f', danger: '#d1344c', video: '#2563eb', audio: '#0f9f84', image: '#b7791f' }, { glow: false }),
  make('contrast', 'High contrast', { bg: '#000000', panel: '#000000', raised: '#0e0e0e', field: '#000000', line: '#ffffff', lineStrong: '#ffffff', text: '#ffffff', textHi: '#ffffff', muted: '#d6d6d6', accent: '#ffe14a', accentHi: '#fff2a0', onAccent: '#000000', warn: '#ffb020', danger: '#ff6b6b', video: '#7fd1ff', audio: '#5dffc5', image: '#ffe14a' }, { glow: false, fontSize: 14 }),
  make('ember', 'Ember', { onAccent: '#1a0b02', accent: '#ff7a2f', accentHi: '#ffa066', panel: '#0a0705', raised: '#14100c', line: '#241a12', lineStrong: '#3b2a1c', video: '#ffa066' }),
  make('forest', 'Forest', { onAccent: '#03140a', accent: '#2fd47a', accentHi: '#6be8a5', panel: '#050a07', raised: '#0b140e', line: '#14231a', lineStrong: '#20382a', video: '#6be8a5', audio: '#6aa9ff' }),
  make('violet', 'Violet', { accent: '#9b6bff', accentHi: '#c0a1ff', panel: '#07050d', raised: '#100c1c', line: '#1c1630', lineStrong: '#2f2552', video: '#c0a1ff' }),
  make('soft', 'Soft (rounded)', { panel: '#0a0d14', raised: '#121826', line: '#1a2236', lineStrong: '#2a3552' }, { radius: 8, density: 'spacious' })
]

export const DEFAULT_LAYOUT: Layout = { previewSide: 'right', inspectorAbove: false, librarySide: 'top', showLibrary: true, showInspector: true }
export const DEFAULT_SETTINGS: AppSettings = { mods: [], themeId: 'midnight', customThemes: [], layout: DEFAULT_LAYOUT }

const HEX = /^#[0-9a-fA-F]{6}$/
const clamp = (v: unknown, min: number, max: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)
/** Font names: letters, digits, spaces and a few punctuation marks. Nothing that could break out of a CSS value. */
const SAFE_FONT = /^[\p{L}\p{N} ._()-]{1,60}$/u

/** Cleans a theme from a file or from storage: unknown fields dropped, colours must be #rrggbb, numbers clamped. */
export function sanitizeTheme(raw: unknown, fallbackId = 'custom'): Theme | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Record<string, unknown>
  const colorsIn = (t.colors && typeof t.colors === 'object' ? t.colors : {}) as Record<string, unknown>
  const colors = { ...midnight }
  let known = 0
  for (const key of THEME_COLOR_KEYS) {
    const v = colorsIn[key]
    if (typeof v === 'string' && HEX.test(v)) {
      colors[key] = v.toLowerCase()
      known++
    }
  }
  if (!known) return null
  const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 40).replace(/[<>]/g, '') : 'Imported theme'
  const id = typeof t.id === 'string' && /^[\w-]{1,40}$/.test(t.id) ? t.id : fallbackId
  return {
    id,
    name,
    colors,
    radius: Math.round(clamp(t.radius, 0, 16, 0)),
    font: typeof t.font === 'string' && SAFE_FONT.test(t.font) ? t.font : '',
    fontSize: Math.round(clamp(t.fontSize, 11, 18, 13) * 2) / 2,
    density: t.density === 'compact' || t.density === 'spacious' ? t.density : 'comfortable',
    glow: t.glow !== false
  }
}

export function sanitizeLayout(raw: unknown): Layout {
  const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    previewSide: l.previewSide === 'left' ? 'left' : 'right',
    inspectorAbove: l.inspectorAbove === true,
    librarySide: l.librarySide === 'left' || l.librarySide === 'right' ? l.librarySide : 'top',
    showLibrary: l.showLibrary !== false,
    showInspector: l.showInspector !== false
  }
}

export function sanitizeSettings(raw: unknown): AppSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const custom = (Array.isArray(s.customThemes) ? s.customThemes : []).map((t, i) => sanitizeTheme(t, `custom-${i}`)).filter((t): t is Theme => Boolean(t)).slice(0, 24)
  const all = [...BUILTIN_THEMES, ...custom]
  const mods = (Array.isArray(s.mods) ? s.mods : []).filter((m, i, a): m is StyleModId => STYLE_MODS.some((x) => x.id === m) && a.indexOf(m) === i)
  return { mods, themeId: typeof s.themeId === 'string' && all.some((t) => t.id === s.themeId) ? s.themeId : 'midnight', customThemes: custom, layout: sanitizeLayout(s.layout) }
}

/** CSS custom properties for a theme. Every value has been validated, so this is safe to assign to the page. */
export function themeCssVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = { '--radius': `${theme.radius}px`, '--ui-size': `${theme.fontSize}px`, '--glow-strength': theme.glow ? '38%' : '0%' }
  for (const key of THEME_COLOR_KEYS) vars[THEME_COLOR_LABELS[key].css] = theme.colors[key]
  vars['--ui-font'] = theme.font ? `"${theme.font}", "Inter", "Segoe UI", system-ui, sans-serif` : `"Inter", "Segoe UI", system-ui, sans-serif`
  return vars
}

const lum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Readability problems in a theme, in plain words. */
export function themeWarnings(theme: Theme): string[] {
  const c = theme.colors
  const out: string[] = []
  if (contrastRatio(c.text, c.panel) < 4.5) out.push('Text on panels is hard to read (contrast below 4.5:1).')
  if (contrastRatio(c.muted, c.panel) < 3) out.push('Dim text on panels is very faint.')
  if (contrastRatio(c.onAccent, c.accent) < 3.5) out.push('Text on accent-coloured buttons is hard to read.')
  if (contrastRatio(c.accent, c.panel) < 2) out.push('The accent colour almost disappears against the panels.')
  return out
}
