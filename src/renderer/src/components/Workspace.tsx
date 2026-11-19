import { useEffect, useRef, useState } from 'react'
import { useEditor, type SaveState } from '../store'
import { player } from '../engine/player'
import { Sidebar } from './Sidebar'
import { Preview } from './Preview'
import { Inspector } from './Inspector'
import { Timeline } from './Timeline'
import { Resizer, usePanelSize } from './Resizer'
import { ExportDialog } from './ExportDialog'
import { AssistantPanel } from './AssistantPanel'
import { SettingsDialog } from './SettingsDialog'
import { useSettings } from '../settings'
import { requestShortcutList, togglePreviewFocus, useUi } from '../ui'
import { bindingMap, comboFromEvent, withKey } from '@shared/shortcuts'
import { useKeys } from '../keys'
import { nestSelection, unnestSelection } from '../nest'
import { useDrop, useFileDrop } from '../dropFiles'
import { ContextMenu } from './ContextMenu'
import '../jobs'
import { IS_PREP } from '../App'

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'All changes saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed'
}

/** What each shortcut action does. The keys that trigger them come from shared/shortcuts and the person's changes. */
const ACTIONS: Record<string, (s: ReturnType<typeof useEditor.getState>) => void> = {
  save: (s) => void s.save(),
  undo: (s) => s.undo(),
  redo: (s) => s.redo(),
  copy: (s) => s.copySelection(),
  paste: (s) => s.paste(),
  duplicate: (s) => s.duplicateSelection(),
  selectAll: (s) => s.select(s.project!.tracks.flatMap((t) => t.clips.map((c) => c.id))),
  playPause: (s) => { s.selectAsset(null); player.toggle() },
  previewFocus: () => togglePreviewFocus(),
  split: (s) => s.splitAtPlayhead(),
  delete: (s) => s.deleteSelection(),
  stepBack: () => player.step(-1),
  stepForward: () => player.step(1),
  back10: () => player.step(-10),
  forward10: () => player.step(10),
  toStart: () => player.seek(0),
  toEnd: () => player.seek(Infinity),
  zoomIn: (s) => s.setZoom(s.zoom * 1.25),
  zoomOut: (s) => s.setZoom(s.zoom / 1.25),
  deselect: (s) => s.select([]),
  showShortcuts: () => requestShortcutList(),
  nest: () => void nestSelection(),
  unnest: () => unnestSelection()
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e)
      if (!combo) return
      const id = bindingMap(useKeys.getState().overrides).get(combo)
      if (!id) return
      // Leave typing alone (saving still works from a text field).
      const el = e.target as HTMLElement
      const typing = el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox')
      if (typing && id !== 'save') return
      e.preventDefault()
      ACTIONS[id]?.(useEditor.getState())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function Workspace() {
  const name = useEditor((s) => s.project!.name)
  const saveState = useEditor((s) => s.saveState)
  const { save, closeProject } = useEditor.getState()
  // The preview is a tall column on the right that runs alongside both the library and the timeline.
  const [right, resizeRight] = usePanelSize('previewColumn', 520, 300, 960)
  const [library, resizeLibrary] = usePanelSize('libraryHeight', 260, 150, 640)
  const [inspector, resizeInspector] = usePanelSize('inspectorHeight', 300, 140, 700)
  const [exporting, setExporting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState<'Theme' | 'Shortcuts' | false>(false)
  const keyOverrides = useKeys((s) => s.overrides)
  const shortcutRequests = useUi((s) => s.shortcutRequests)
  // Only a request made while this workspace is open counts (the counter outlives the workspace).
  const handledRequests = useRef(shortcutRequests)
  useEffect(() => { if (shortcutRequests !== handledRequests.current) { handledRequests.current = shortcutRequests; setSettingsOpen('Shortcuts') } }, [shortcutRequests])
  const baseLayout = useSettings((s) => s.layout)
  const focus = useUi((s) => s.previewFocus)
  const collapsed = useUi((s) => s.libraryCollapsed)
  // Focusing the preview hides the properties panel for now without touching the saved layout.
  const layout = focus ? { ...baseLayout, showInspector: false } : baseLayout
  const [libraryWidth, resizeLibraryWidth] = usePanelSize('libraryWidth', 340, 200, 800)
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const [sent, setSent] = useState('')
  const send = async () => {
    const n = await useEditor.getState().sendSelection()
    setSent(n ? `Sent ${n} clip${n === 1 ? '' : 's'}` : IS_PREP ? 'The main project window is closed' : 'Open Split view first')
  }
  useEffect(() => {
    if (!IS_PREP) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key === 'Enter' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName)) void send()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [rightTab, setRightTab] = useState<'Properties' | 'Assistant'>('Properties')
  useShortcuts()
  useFileDrop('project')
  const dropOver = useDrop((s) => s.over)
  const dropNote = useDrop((s) => s.note)

  return (
    <div className="workspace">
      {IS_PREP ? (
        <header className="topbar prep">
          <strong className="project-title">Clip prep <span className="dim">· pile clips on any track, trim them, then send them to your project</span></strong>
          <span className={`save-state ${saveState}`} role="status">{SAVE_LABEL[saveState]}</span>
          <span className="dim" role="status">{sent}</span>
          <button className="primary" disabled={!hasSelection} onClick={() => void send()} title="Send the selected clips to the playhead of the main project (Enter)">Send to project →</button>
        </header>
      ) : (
        <header className="topbar">
          <button onClick={() => { localStorage.setItem('home-tab', 'Projects'); void closeProject() }}>← Projects</button>
          <strong className="project-title">{name}</strong>
          {sent && <span className="dim" role="status">{sent}</span>}
          <span className={`save-state ${saveState}`} role="status">{SAVE_LABEL[saveState]}</span>
          {saveState !== 'saved' && <button onClick={() => void save()} disabled={saveState === 'saving'} title={withKey('Save now', 'save', keyOverrides)}>Save</button>}
          <select
            value=""
            aria-label="More"
            title="Clips folder, split view and sending clips to the other window"
            onChange={(e) => {
              const choice = e.target.value
              if (choice === 'clips') { localStorage.setItem('home-tab', 'Clips'); void closeProject() }
              else if (choice === 'split') void useEditor.getState().openSplit()
              else if (choice === 'send') void send()
            }}
          >
            <option value="">More</option>
            <option value="clips">Clips folder</option>
            <option value="split">Split view</option>
            <option value="send" disabled={!hasSelection}>Send selected clips to clip prep</option>
          </select>
          <button onClick={() => void window.api.window.toggleFullscreen()} aria-label="Full screen" title="Full screen (F11)">Full screen</button>
          <button onClick={() => setSettingsOpen('Theme')} aria-label="Settings" title="Theme, colours, fonts and layout">Settings</button>
          <button className="primary" onClick={() => { player.pause(); setExporting(true) }}>Export</button>
        </header>
      )}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      <ContextMenu />
      {dropOver && <div className="drop-overlay" role="status"><strong>Drop your files here</strong><span>Drop on the timeline to place them there, anywhere else to add them to the library. Folders work too.</span></div>}
      {dropNote && <div className="drop-toast" role="status">{dropNote}</div>}
      {settingsOpen && <SettingsDialog key={settingsOpen} initialTab={settingsOpen} onClose={() => setSettingsOpen(false)} />}
      <div className="stage" style={{ flexDirection: layout.previewSide === 'left' ? 'row-reverse' : 'row' }}>
        <div className="left-col" style={{ flexDirection: layout.librarySide === 'top' ? 'column' : layout.librarySide === 'left' ? 'row' : 'row-reverse' }}>
          {layout.showLibrary && (
            <>
              <section className={`panel library ${collapsed ? 'collapsed' : ''}`} style={layout.librarySide === 'top' ? { height: collapsed ? 46 : library } : collapsed ? { width: 46, height: 'auto' } : { width: libraryWidth, height: 'auto' }}>
                <Sidebar />
              </section>
              {layout.librarySide === 'top'
                ? <Resizer direction="vertical" onResize={resizeLibrary} label="Resize library" />
                : <Resizer direction="horizontal" onResize={(d) => resizeLibraryWidth(layout.librarySide === 'left' ? d : -d)} label="Resize library" />}
            </>
          )}
          <section className="panel timeline-panel">
            <Timeline />
          </section>
        </div>
        <Resizer direction="horizontal" onResize={(d) => resizeRight(layout.previewSide === 'left' ? d : -d)} label="Resize preview column" />
        <div className={`right-col ${focus ? 'focus' : ''}`} style={{ width: focus ? undefined : right, flexDirection: layout.inspectorAbove ? 'column-reverse' : 'column' }}>
          <section className="panel preview-panel">
            <Preview />
          </section>
          {layout.showInspector && (
            <>
              <Resizer direction="vertical" onResize={(d) => resizeInspector(layout.inspectorAbove ? d : -d)} label="Resize properties" />
              <section className="panel inspector-panel" style={{ height: inspector }}>
                <div className="sidebar">
                  <nav className="tabs" role="tablist">
                    {(['Properties', 'Assistant'] as const).map((t) => (
                      <button key={t} role="tab" aria-selected={rightTab === t} className={rightTab === t ? 'active' : ''} onClick={() => setRightTab(t)}>{t}</button>
                    ))}
                  </nav>
                  <div className="tab-body">{rightTab === 'Properties' ? <Inspector /> : <AssistantPanel />}</div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
