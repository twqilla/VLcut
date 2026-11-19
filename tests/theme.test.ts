import { expect, test } from 'vitest'
import { BUILTIN_THEMES, DEFAULT_LAYOUT, THEME_COLOR_KEYS, contrastRatio, sanitizeSettings, sanitizeTheme, themeCssVars, themeWarnings } from '../src/shared/theme'

test('every built-in theme is complete, valid and readable', () => {
  expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(8)
  for (const t of BUILTIN_THEMES) {
    expect(sanitizeTheme(t), t.id).toEqual(t) // already clean
    for (const k of THEME_COLOR_KEYS) expect(t.colors[k], `${t.id}.${k}`).toMatch(/^#[0-9a-f]{6}$/)
    expect(themeWarnings(t), t.id).toEqual([])
  }
  expect(new Set(BUILTIN_THEMES.map((t) => t.id)).size).toBe(BUILTIN_THEMES.length)
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
})

test('a high-contrast theme really is high contrast, and a muddy one is flagged', () => {
  const hc = BUILTIN_THEMES.find((t) => t.id === 'contrast')!
  expect(contrastRatio(hc.colors.text, hc.colors.panel)).toBeGreaterThan(15)
  const muddy = { ...BUILTIN_THEMES[0], colors: { ...BUILTIN_THEMES[0].colors, text: '#222222', accent: '#080808' } }
  expect(themeWarnings(muddy).length).toBeGreaterThanOrEqual(2)
})

test('imported theme files cannot inject anything: only #rrggbb colours, safe fonts and clamped numbers get through', () => {
  const evil = sanitizeTheme({
    name: '<img src=x onerror=alert(1)>',
    colors: { bg: 'red; background: url(http://evil)', panel: '#112233', text: 'expression(alert(1))', accent: '#ABCDEF', bogus: '#ffffff' },
    radius: 9999, font: 'Inter"; } body { display:none } /*', fontSize: -5, density: 'enormous', glow: 'yes'
  })!
  expect(evil.colors.panel).toBe('#112233')
  expect(evil.colors.accent).toBe('#abcdef')
  expect(evil.colors.bg).toBe('#000000') // rejected, default kept
  expect(evil.name).not.toMatch(/[<>]/)
  expect(evil.radius).toBe(16)
  expect(evil.font).toBe('')
  expect(evil.fontSize).toBe(11)
  expect(evil.density).toBe('comfortable')
  const css = Object.values(themeCssVars(evil)).join(' ')
  expect(css).not.toMatch(/[;{}<>]|url\(|expression/)
  expect(sanitizeTheme({ colors: { bg: 'nope' } })).toBeNull()
  expect(sanitizeTheme('x')).toBeNull()
  expect(sanitizeTheme(null)).toBeNull()
})

test('settings from storage are repaired rather than trusted', () => {
  expect(sanitizeSettings(null)).toEqual({ mods: [], themeId: 'midnight', customThemes: [], layout: DEFAULT_LAYOUT })
  expect(sanitizeSettings({ mods: ['neon', 'glass', 'neon', 'evil; x', 5] }).mods).toEqual(['neon', 'glass'])
  const s = sanitizeSettings({ themeId: 'gone', layout: { previewSide: 'left', librarySide: 'sideways', showLibrary: false, inspectorAbove: 'yes' }, customThemes: [{ id: 'mine', name: 'Mine', colors: { accent: '#ff00aa' } }, 5, null] })
  expect(s.themeId).toBe('midnight')
  expect(s.layout).toEqual({ previewSide: 'left', inspectorAbove: false, librarySide: 'top', showLibrary: false, showInspector: true })
  expect(s.customThemes).toHaveLength(1)
  expect(sanitizeSettings({ themeId: 'mine', customThemes: [{ id: 'mine', name: 'Mine', colors: { accent: '#ff00aa' } }] }).themeId).toBe('mine')
})
