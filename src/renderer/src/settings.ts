/** The person's theme and layout, applied to the whole interface and remembered between sessions. */
import { create } from 'zustand'
import { type AppSettings, type Layout, type Theme, BUILTIN_THEMES, DEFAULT_SETTINGS, sanitizeSettings, themeCssVars } from '@shared/theme'

const KEY = 'vlcut:settings'

function load(): AppSettings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const useSettings = create<AppSettings>(() => load())

export const allThemes = (s: AppSettings): Theme[] => [...BUILTIN_THEMES, ...s.customThemes]
export const currentTheme = (s: AppSettings): Theme => allThemes(s).find((t) => t.id === s.themeId) ?? BUILTIN_THEMES[0]

/** Writes the theme into CSS variables on the page. Values were validated by `sanitizeTheme`. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(themeCssVars(theme))) root.style.setProperty(name, value)
  const light = parseInt(theme.colors.panel.slice(1, 3), 16) > 160
  root.style.setProperty('color-scheme', light ? 'light' : 'dark')
  document.body.classList.remove('density-compact', 'density-comfortable', 'density-spacious')
  document.body.classList.add(`density-${theme.density}`)
  if (theme.font) void document.fonts.load(`400 14px "${theme.font}"`).catch(() => undefined)
}

function persist(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Settings still apply for this session if storage is unavailable.
  }
}

/** Switches the style-modifier classes on the page to match `mods`. */
export function applyMods(mods: string[]): void {
  for (const c of [...document.body.classList]) if (c.startsWith('mod-')) document.body.classList.remove(c)
  for (const m of mods) document.body.classList.add(`mod-${m}`)
}

export function updateSettings(patch: Partial<AppSettings>): void {
  const next = sanitizeSettings({ ...useSettings.getState(), ...patch })
  useSettings.setState(next, true)
  persist(next)
  applyTheme(currentTheme(next))
  applyMods(next.mods)
}

export const setLayout = (patch: Partial<Layout>): void => updateSettings({ layout: { ...useSettings.getState().layout, ...patch } })

/** Saves an edited theme under its id (replacing a custom theme of that id) and switches to it. */
export function saveTheme(theme: Theme): void {
  const s = useSettings.getState()
  updateSettings({ customThemes: [...s.customThemes.filter((t) => t.id !== theme.id), theme], themeId: theme.id })
}

export function deleteTheme(id: string): void {
  const s = useSettings.getState()
  updateSettings({ customThemes: s.customThemes.filter((t) => t.id !== id), themeId: s.themeId === id ? 'midnight' : s.themeId })
}

export function startSettings(): void {
  applyTheme(currentTheme(useSettings.getState()))
  applyMods(useSettings.getState().mods)
  // A change made in another window (e.g. the clip-prep window) applies here too.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    useSettings.setState(load(), true)
    applyTheme(currentTheme(useSettings.getState()))
    applyMods(useSettings.getState().mods)
  })
}
