import { useEffect, useState } from 'react'
import { BUILTIN_THEMES, MOD_COMBOS, STYLE_MODS, type StyleModId, THEME_COLOR_KEYS, THEME_COLOR_LABELS, type Theme, type ThemeColorKey, sanitizeTheme, themeWarnings } from '@shared/theme'
import { FONT_CATEGORIES } from '@shared/effects/registry'
import { newId } from '@shared/timeline/model'
import { allThemes, currentTheme, deleteTheme, saveTheme, setLayout, updateSettings, useSettings } from '../settings'
import { useCustomFonts } from '../engine/fonts'
import { ShortcutSettings } from './ShortcutSettings'
import { AboutPane } from './AboutPane'

const GROUPS = ['Surfaces', 'Text', 'Accent', 'Clips and status'] as const

/** A tiny picture of the workspace with the chosen arrangement. */
function LayoutMock() {
  const l = useSettings((s) => s.layout)
  const block = (label: string, grow = 1, extra: React.CSSProperties = {}) => (
    <div style={{ flex: grow, border: '1px solid var(--line-strong)', background: 'var(--raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--muted)', minHeight: 0, minWidth: 0, ...extra }}>{label}</div>
  )
  const library = l.showLibrary ? block('Library', 1) : null
  const timeline = block('Timeline', 1.4)
  const main = l.librarySide === 'top'
    ? <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>{library}{timeline}</div>
    : <div style={{ flex: 1, display: 'flex', flexDirection: l.librarySide === 'left' ? 'row' : 'row-reverse', gap: 3 }}>{library && <div style={{ flex: 0.6, display: 'flex' }}>{library}</div>}<div style={{ flex: 1.4, display: 'flex' }}>{timeline}</div></div>
  const preview = block('Preview', 1.6, { background: '#000' })
  const inspector = l.showInspector ? block('Properties', 1) : null
  const side = <div style={{ flex: 0.8, display: 'flex', flexDirection: l.inspectorAbove ? 'column-reverse' : 'column', gap: 3 }}>{preview}{inspector}</div>
  return (
    <div aria-label="Layout preview" style={{ display: 'flex', flexDirection: l.previewSide === 'left' ? 'row-reverse' : 'row', gap: 3, height: 130, padding: 6, border: '1px solid var(--line)', background: 'var(--bg)' }}>
      {main}
      {side}
    </div>
  )
}

export function SettingsDialog({ onClose, initialTab = 'Theme' }: { onClose: () => void; initialTab?: 'Theme' | 'Styles' | 'Layout' | 'Shortcuts' | 'About' }) {
  const settings = useSettings()
  const theme = currentTheme(settings)
  const customFonts = useCustomFonts((s) => s.names)
  const [startFull, setStartFull] = useState(false)
  useEffect(() => void window.api.window.state().then((w) => setStartFull(w.startFullscreen)), [])
  const [tab, setTab] = useState<'Theme' | 'Styles' | 'Layout' | 'Shortcuts' | 'About'>(initialTab)
  const [note, setNote] = useState('')
  const [report, setReport] = useState('')
  const builtin = BUILTIN_THEMES.some((t) => t.id === theme.id)
  /** Editing a built-in theme makes a custom copy first, so the built-in is never altered. */
  const edit = (patch: Partial<Theme>): void => {
    const base: Theme = builtin ? { ...theme, id: `custom-${newId().slice(0, 8)}`, name: `${theme.name.replace(' (default)', '')} (custom)` } : theme
    saveTheme({ ...base, ...patch })
  }
  const setColor = (key: ThemeColorKey, value: string): void => edit({ colors: { ...theme.colors, [key]: value } })
  const exportTheme = async (): Promise<void> => {
    const saved = await window.api.files.saveText(`${theme.name.replace(/[^\w -]+/g, '').trim() || 'theme'}.vlcut-theme.json`, JSON.stringify({ vlcutTheme: 1, ...theme }, null, 2))
    setNote(saved ? 'Theme saved. Share the file; anyone can load it with Import.' : '')
  }
  const importTheme = async (): Promise<void> => {
    const text = await window.api.files.openText(['json'])
    if (text === null) return
    try {
      const parsed = sanitizeTheme(JSON.parse(text), `custom-${newId().slice(0, 8)}`)
      if (!parsed) return setNote('That file is not a VLcut theme.')
      // An imported theme always gets a fresh id so it can never replace one of yours.
      saveTheme({ ...parsed, id: `custom-${newId().slice(0, 8)}` })
      setNote(`Loaded “${parsed.name}”.`)
    } catch {
      setNote('That file could not be read as a theme.')
    }
  }
  const warnings = themeWarnings(theme)
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="modal settings">
        <header>
          <h2>Settings</h2>
          <button onClick={onClose} aria-label="Close settings">×</button>
        </header>
        <nav className="tabs" role="tablist">
          {(['Theme', 'Styles', 'Layout', 'Shortcuts', 'About'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
        </nav>

        {tab === 'Theme' && (
          <div className="settings-body">
            <div className="theme-grid" role="listbox" aria-label="Themes">
              {allThemes(settings).map((t) => (
                <div key={t.id} className={`theme-card ${t.id === theme.id ? 'on' : ''}`}>
                  <button role="option" aria-selected={t.id === theme.id} onClick={() => updateSettings({ themeId: t.id })} title={t.name}>
                    <span className="swatches">{(['bg', 'panel', 'raised', 'accent', 'text'] as ThemeColorKey[]).map((k) => <i key={k} style={{ background: t.colors[k] }} />)}</span>
                    <span>{t.name}</span>
                  </button>
                  {!BUILTIN_THEMES.some((b) => b.id === t.id) && <button className="x" aria-label={`Delete ${t.name}`} onClick={() => deleteTheme(t.id)}>×</button>}
                </div>
              ))}
            </div>

            {!builtin && (
              <label className="field"><span className="field-label">Name</span><input value={theme.name} maxLength={40} aria-label="Theme name" onChange={(e) => saveTheme({ ...theme, name: e.target.value || 'My theme' })} /></label>
            )}
            {builtin && <p className="hint">Change anything below and your changes are saved as a new custom theme; the built-in one stays as it is.</p>}

            <h3>Shape and text</h3>
            <label className="field"><span className="field-label">Corners</span><input type="range" min={0} max={16} step={1} value={theme.radius} aria-label="Corner rounding" onChange={(e) => edit({ radius: Number(e.target.value) })} /><span className="dim">{theme.radius === 0 ? 'square' : `${theme.radius}px`}</span></label>
            <label className="field"><span className="field-label">Text size</span><input type="range" min={11} max={18} step={0.5} value={theme.fontSize} aria-label="Text size" onChange={(e) => edit({ fontSize: Number(e.target.value) })} /><span className="dim">{theme.fontSize}px</span></label>
            <label className="field"><span className="field-label">Spacing</span>
              <select value={theme.density} aria-label="Spacing" onChange={(e) => edit({ density: e.target.value as Theme['density'] })}>
                <option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option>
              </select>
            </label>
            <label className="field"><span className="field-label">Font</span>
              <select value={theme.font} aria-label="Interface font" onChange={(e) => edit({ font: e.target.value })}>
                <option value="">Inter (default)</option>
                {customFonts.length > 0 && <optgroup label="Your fonts">{customFonts.map((f) => <option key={f}>{f}</option>)}</optgroup>}
                {FONT_CATEGORIES.filter((c) => c.name !== 'Handwriting').map((c) => <optgroup key={c.name} label={c.name}>{c.fonts.map((f) => <option key={f}>{f}</option>)}</optgroup>)}
              </select>
            </label>
            <label className="field"><span className="field-label">Glow</span><label className="check"><input type="checkbox" checked={theme.glow} onChange={(e) => edit({ glow: e.target.checked })} /> Soft glow around active controls</label></label>

            {GROUPS.map((group) => (
              <section key={group}>
                <h3>{group}</h3>
                {THEME_COLOR_KEYS.filter((k) => THEME_COLOR_LABELS[k].group === group).map((k) => (
                  <label key={k} className="field">
                    <span className="field-label">{THEME_COLOR_LABELS[k].label}</span>
                    <input type="color" value={theme.colors[k]} aria-label={THEME_COLOR_LABELS[k].label} onChange={(e) => setColor(k, e.target.value)} />
                    <code className="dim">{theme.colors[k]}</code>
                  </label>
                ))}
              </section>
            ))}
            {warnings.map((w) => <p key={w} className="notice small" role="status">{w}</p>)}
            <div className="field">
              <button onClick={() => void exportTheme()}>Export theme…</button>
              <button onClick={() => void importTheme()}>Import theme…</button>
              <button onClick={() => updateSettings({ themeId: 'midnight' })}>Back to the default</button>
            </div>
            {note && <p className="hint" role="status">{note}</p>}
          </div>
        )}

        {tab === 'Shortcuts' && <ShortcutSettings />}
        {tab === 'About' && <AboutPane />}

        {tab === 'Styles' && (
          <div className="settings-body">
            <p className="hint">Styles stack on top of any theme. Switch on as many as you like; they are designed to combine.</p>
            <div className="mod-grid" role="group" aria-label="Style modifiers">
              {STYLE_MODS.map((m) => {
                const on = settings.mods.includes(m.id)
                return (
                  <button key={m.id} className={`mod-card ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => updateSettings({ mods: on ? settings.mods.filter((x) => x !== m.id) : [...settings.mods, m.id] })}>
                    <strong>{m.name}</strong>
                    <span>{m.note}</span>
                  </button>
                )
              })}
            </div>
            <h3>Combinations</h3>
            <div className="field">
              {MOD_COMBOS.map((c) => <button key={c.name} title={c.mods.join(' + ')} onClick={() => updateSettings({ mods: c.mods as StyleModId[] })}>{c.name}</button>)}
              <button onClick={() => updateSettings({ mods: [] })}>None</button>
            </div>
            <div className="mod-sample" aria-hidden="true">
              <div className="panel"><h3>Sample panel</h3><p>Buttons, fields and headings follow the styles you picked.</p><div className="field"><button>Button</button><button className="primary">Primary</button><input defaultValue="Field" /></div></div>
            </div>
          </div>
        )}

        <div className="settings-body" style={{ paddingTop: 0 }}>
          <h3>Help</h3>
          <div className="field">
            <button onClick={() => void window.api.diagnostics.collect({ theme: settings.themeId, mods: settings.mods }).then(async (text) => { setReport(text); try { await navigator.clipboard.writeText(text); setNote('Diagnostics copied. Paste them into a message when something goes wrong.') } catch { setNote('Select the text below and copy it.') } })}>Copy diagnostics</button>
          </div>
          {report && <textarea readOnly rows={8} value={report} aria-label="Diagnostics report" style={{ width: '100%', fontFamily: 'monospace', fontSize: 11 }} />}
          <p className="hint">Versions, graphics, tools and recent errors only. Your name, folders, file names and project content are removed.</p>
        </div>

        {tab === 'Layout' && (
          <div className="settings-body">
            <label className="check"><input type="checkbox" aria-label="Open in full screen" checked={startFull} onChange={(e) => { setStartFull(e.target.checked); void window.api.window.setStartFullscreen(e.target.checked) }} /> Open in true full screen (the app always opens maximised; F11 switches full screen on and off)</label>
            <LayoutMock />
            <label className="field"><span className="field-label">Preview side</span>
              <select value={settings.layout.previewSide} aria-label="Preview side" onChange={(e) => setLayout({ previewSide: e.target.value as 'left' | 'right' })}>
                <option value="right">Right (default)</option><option value="left">Left</option>
              </select>
            </label>
            <label className="field"><span className="field-label">Properties</span>
              <select value={settings.layout.inspectorAbove ? 'above' : 'below'} aria-label="Properties position" onChange={(e) => setLayout({ inspectorAbove: e.target.value === 'above' })}>
                <option value="below">Below the preview (default)</option><option value="above">Above the preview</option>
              </select>
            </label>
            <label className="field"><span className="field-label">Library</span>
              <select value={settings.layout.librarySide} aria-label="Library position" onChange={(e) => setLayout({ librarySide: e.target.value as 'top' | 'left' | 'right' })}>
                <option value="top">Above the timeline (default)</option><option value="left">Left of the timeline</option><option value="right">Right of the timeline</option>
              </select>
            </label>
            <label className="field"><span className="field-label">Show panels</span>
              <span className="checks">
                <label className="check"><input type="checkbox" checked={settings.layout.showLibrary} onChange={(e) => setLayout({ showLibrary: e.target.checked })} /> Library</label>
                <label className="check"><input type="checkbox" checked={settings.layout.showInspector} onChange={(e) => setLayout({ showInspector: e.target.checked })} /> Properties and assistant</label>
              </span>
            </label>
            <p className="hint">Drag the thin lines between panels to resize them; sizes are remembered. Hiding a panel gives its space to the timeline and preview.</p>
            <div className="field"><button onClick={() => setLayout({ previewSide: 'right', inspectorAbove: false, librarySide: 'top', showLibrary: true, showInspector: true })}>Reset layout</button></div>
          </div>
        )}
      </div>
    </div>
  )
}
