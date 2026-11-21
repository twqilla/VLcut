import { Icon, type IconName } from './Icon'
import { setAudioTab, setLibraryCollapsed, setTextEditor, useUi } from '../ui'
import type { TextProps } from '@shared/types'
import * as ops from '@shared/timeline/ops'
import { makeClip, textClip, vizClip } from '@shared/timeline/model'
import { ensureTrack } from '@shared/agent/tools'
import { cutBetweenSelection, syncSelectionByAudio } from '../motion'
import { runSteps, sfxContext } from '../assistant'
import { EFFECTS, EFFECT_STACKS, type EffectStack, TRANSITIONS } from '@shared/effects/registry'
import { useEditor } from '../store'
import { player } from '../engine/player'
import { MediaLibrary } from './MediaLibrary'
import { StylesTab } from './StylesTab'
import { CaptionsTab } from './CaptionsTab'
import { RecordVoice } from './RecordVoice'
import { LooksTab } from './LooksTab'
import { TemplatesTab } from './TemplatesTab'
import type { Snapshot } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { formatDate, mediaUrl } from '../format'
import { TEXT_PRESETS } from '../textPresets'
import { TEXT_MIME, clearGhost, dragPayload } from '../dragGhost'
import { applyDragProps } from '../applyDrag'

const TABS = ['Media', 'Audio', 'Styles', 'Looks', 'Text', 'Templates', 'Captions', 'Effects', 'Transitions', 'History'] as const
type Tab = (typeof TABS)[number]


function TextTab() {
  const add = (preset: (typeof TEXT_PRESETS)[number]) => {
    const { apply, select, project } = useEditor.getState()
    const clip = textClip(player.time, preset.text)
    if (preset.name === 'Lower third') clip.transform = { ...clip.transform, x: -0.22, y: 0.32 }
    const track = project!.tracks.find((t) => t.kind === 'text' && !t.locked)
    apply(`Add ${preset.name} text`, (p) => {
      const withTrack = track ? p : ops.addTrack(p, 'text')
      return ops.addClip(withTrack, (track ?? withTrack.tracks[0]).id, clip)
    })
    select([clip.id])
    setTextEditor(true)
  }
  return (
    <div className="tile-grid">
      {TEXT_PRESETS.map((preset) => (
        <button key={preset.name} className="tile" draggable onClick={() => add(preset)} title="Click to add at the playhead, or drag onto the timeline"
          onDragStart={(e) => { e.dataTransfer.setData(TEXT_MIME, preset.name); e.dataTransfer.effectAllowed = 'copy'; dragPayload.duration = 3; dragPayload.label = preset.name }}
          onDragEnd={clearGhost}>
          <span className="tile-sample" style={{ fontFamily: `"${preset.text.fontFamily}"`, fontWeight: preset.text.weight, color: preset.text.boxColor ? undefined : preset.text.color }}>{preset.sample}</span>
          <span className="tile-name">{preset.name}</span>
        </button>
      ))}
    </div>
  )
}

function ApplyList({ items, onPick, noun }: { items: { type: string; name: string; group?: string }[]; onPick(type: string): void; noun: string }) {
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.group ?? '').toLowerCase().includes(q)) : items
  const groups = [...new Set(shown.map((i) => i.group ?? ''))]
  return (
    <div className="apply-list">
      <input type="search" className="list-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${noun.replace(/^an? /, '')}s…`} aria-label={`Search ${noun.replace(/^an? /, '')}s`} />
      {!hasSelection && <p className="hint">Select a clip first.</p>}
      {groups.map((g) => (
        <div key={g}>
          {g && <h3>{g}</h3>}
          {shown.filter((i) => (i.group ?? '') === g).map((i) => (
            <button key={i.type} className={hasSelection ? '' : 'soft-disabled'} aria-disabled={!hasSelection} onClick={() => hasSelection && onPick(i.type)} title="Click to add to the selected clip, or drag onto a clip in the timeline" {...applyDragProps({ kind: noun.includes('transition') ? 'transition' : 'effect', id: i.type, name: i.name })}>{i.name}</button>
          ))}
        </div>
      ))}
    </div>
  )
}

const STACKS_KEY = 'effect-stacks'
export function loadCustomStacks(): EffectStack[] {
  try {
    return JSON.parse(localStorage.getItem(STACKS_KEY) ?? '[]') as EffectStack[]
  } catch {
    return []
  }
}
export function saveCustomStacks(stacks: EffectStack[]): void {
  localStorage.setItem(STACKS_KEY, JSON.stringify(stacks))
  window.dispatchEvent(new Event('effect-stacks'))
}

/** One-click effect combinations. Each click adds to the clip's stack, so combinations can be layered. */
function StacksList() {
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const [custom, setCustom] = useState(loadCustomStacks)
  useEffect(() => {
    const update = () => setCustom(loadCustomStacks())
    window.addEventListener('effect-stacks', update)
    return () => window.removeEventListener('effect-stacks', update)
  }, [])
  const { addEffectStack } = useEditor.getState()
  return (
    <div className="apply-list stacks">
      <h3>Stacks</h3>
      <div className="stack-grid" title="Ready-made combinations. Click several to layer them; every effect stays adjustable in Properties.">
        {[...custom, ...EFFECT_STACKS].map((stack) => (
          <span key={stack.name} className="stack-item">
            <button className={hasSelection ? '' : 'soft-disabled'} aria-disabled={!hasSelection} onClick={() => hasSelection && addEffectStack(stack.name, stack.effects)} title={`${stack.effects.map((e) => EFFECTS.find((x) => x.type === e.type)?.name).join(' + ')} · click, or drag onto a clip`} {...applyDragProps({ kind: 'stack', id: stack.name, name: stack.name, effects: stack.effects })}>
              {stack.name}
              <span className="dim"> · {stack.effects.length}</span>
            </button>
            {stack.custom && <button className="icon" aria-label={`Delete ${stack.name}`} onClick={() => saveCustomStacks(custom.filter((c) => c.name !== stack.name))}>×</button>}
          </span>
        ))}
      </div>
    </div>
  )
}


/** Sound effects to drop at the playhead, and the audio clean-up tools. */
/** Two or more cameras filming the same event: line them up by sound, then cut between them. */
function Multicam() {
  const count = useEditor((s) => s.selection.length)
  const [seconds, setSeconds] = useState(4)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <>
      <h3>Multicam</h3>
      <div className="audio-tools">
        <p className="hint">Select the clips from each camera (Ctrl-click), put them on separate tracks, then:</p>
        <button disabled={count < 2 || busy} onClick={() => { setBusy(true); setNote(''); void syncSelectionByAudio().then(setNote).finally(() => setBusy(false)) }}>{busy ? 'Listening…' : 'Line up by sound'}</button>
        <div className="row">
          <label className="check">Switch every <input type="number" min={1} max={60} step={1} value={seconds} onChange={(e) => setSeconds(Math.max(1, Number(e.target.value) || 4))} aria-label="Seconds per angle" style={{ width: 56 }} /> s</label>
          <button disabled={count < 2} onClick={() => setNote(cutBetweenSelection(seconds))}>Cut between cameras</button>
        </div>
        {note && <p className="hint" role="status">{note}</p>}
        <p className="hint">Lining up compares the sound of each clip with the first one, so it needs a shared sound (voices, claps, music). If the match is not clear, nothing moves.</p>
      </div>
    </>
  )
}

/** Puts a visualiser layer on its own picture track, as long as the sound that is playing under the playhead (or 10 s). */
function addVisualizer(): void {
  const { project, apply, select } = useEditor.getState()
  if (!project) return
  const t = player.time
  const sound = project.tracks.flatMap((tr) => tr.clips).find((c) => c.assetId && project.media.find((m) => m.id === c.assetId)?.kind === 'audio' && t >= c.start && t < c.start + c.duration)
  const clip = vizClip(t, {}, sound ? Math.max(0.5, sound.start + sound.duration - t) : 10)
  apply('Add audio visualizer', (p) => {
    const ensured = ensureTrack(p, 'video', 'Visualizer', 'top')
    return ops.addClip(ensured.project, ensured.track.id, clip)
  })
  select([clip.id])
}

/** Text to speech with this computer's own voices: type words, get a voice-over clip at the playhead. */
function VoiceOver() {
  const [text, setText] = useState('')
  const [voices, setVoices] = useState<string[]>([])
  const [voice, setVoice] = useState('')
  const [rate, setRate] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const player_ = useRef<HTMLAudioElement | null>(null)
  useEffect(() => void window.api.tts.voices().then(setVoices), [])
  useEffect(() => () => player_.current?.pause(), [])
  const clean = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  const listen = async () => {
    setBusy(true); setNote('')
    try {
      const asset = await window.api.tts.speak(text, voice || undefined, rate)
      player_.current?.pause()
      player_.current = new Audio(mediaUrl(asset.path))
      await player_.current.play()
    } catch (err) { setNote(clean(err)) } finally { setBusy(false) }
  }
  const speak = async () => {
    setBusy(true)
    setNote('')
    try {
      const asset = await window.api.tts.speak(text, voice || undefined, rate)
      useEditor.getState().addMedia([asset])
      const clip = makeClip({ assetId: asset.id, start: player.time, duration: asset.duration })
      useEditor.getState().apply('Add voice-over', (p) => {
        const free = p.tracks.find((t) => t.kind === 'audio' && !t.locked && ops.freeStart(t, clip.start, clip.duration) === clip.start)
        const withTrack = free ? p : ops.addTrack(p, 'audio')
        return ops.addClip(withTrack, (free ?? withTrack.tracks[withTrack.tracks.length - 1]).id, clip)
      })
      useEditor.getState().select([clip.id])
      setNote(`Added a ${asset.duration.toFixed(1)} s voice-over at the playhead.`)
    } catch (err) {
      setNote(clean(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h3>Voice-over (text to speech)</h3>
      <div className="audio-tools">
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type what the voice should say…" aria-label="Text to speak" />
        <div className="row">
          <select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Voice">
            <option value="">Default voice</option>
            {voices.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <label className="check" title="Speaking speed"><input type="range" min={-6} max={6} step={1} value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Speaking speed" /> speed</label>
        </div>
        <div className="row">
          <button disabled={busy || !text.trim()} onClick={() => void listen()}>▶ Listen</button>
          <button className="primary" disabled={busy || !text.trim()} onClick={() => void speak()}>{busy ? 'Working…' : 'Add voice-over at playhead'}</button>
        </div>
        {note && <p className="hint" role="status">{note}</p>}
        <p className="hint">Uses the voices that come with this computer (Windows speech, macOS speech, or espeak-ng on Linux). More voices can be added in your system's speech settings. Nothing is uploaded.</p>
      </div>
    </>
  )
}

function AudioTab() {
  const [cutMode, setCutMode] = useState('beats:1')
  const autoMute = useEditor((s) => s.autoMute)
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const tool = (tool: 'duckMusic' | 'denoise' | 'syncToBeats' | 'syncToSnares' | 'removeAudio', description: string) => void runSteps(description, [{ tool, args: {}, description }])
  const tab = useUi((u) => u.audioTab) || 'Voice'
  const show = (name: string): boolean => tab === 'All' || tab === name
  const TABS: [string, IconName, string][] = [['Voice', 'mic', 'Record your voice or turn text into speech'], ['Music', 'music', 'Cut to the beat, visualizer, lower music'], ['Clip', 'volume', 'Sound of the selected clips'], ['Cameras', 'film', 'Line up several cameras by sound'], ['All', 'grid', 'Everything in one long list']]
  return (
    <div className="apply-list">
      <div className="prop-tabs" role="tablist" aria-label="Audio tools">
        {TABS.map(([name, icon, hint]) => (
          <button key={name} role="tab" aria-selected={tab === name} className={tab === name ? 'on' : ''} onClick={() => setAudioTab(name)} title={hint}>
            <Icon name={icon} size={14} />
            <span>{name}</span>
          </button>
        ))}
      </div>
      {show('Voice') && (
        <>
          <RecordVoice />
          <VoiceOver />
        </>
      )}
      {show('Music') && (
        <>
      <h3>Audio visualizer</h3>
      <div className="audio-tools">
        <button onClick={() => addVisualizer()}>Add a visualizer at the playhead</button>
      </div>
      <h3>Cut to the music</h3>
      <div className="audio-tools">
        <div className="row">
          <select value={cutMode} onChange={(e) => setCutMode(e.target.value)} aria-label="Cut on">
            <option value="beats:1">Every beat</option>
            <option value="beats:2">Every 2nd beat</option>
            <option value="beats:4">Every 4th beat</option>
            <option value="snares:1">Every snare hit</option>
          </select>
          <button className="primary" onClick={() => { const [on, every] = cutMode.split(':'); void runSteps('Auto-cut to the music', [{ tool: 'autoCutToBeat', args: { on, every: Number(every) }, description: `Cut the footage on ${on === 'snares' ? 'every snare hit' : 'the beat'}, with a slight punch-in on alternate pieces.` }]) }}>Auto-cut</button>
        </div>
        <button onClick={() => tool('syncToSnares', 'Move each cut on the main track to the nearest snare hit.')}>Snap existing cuts to snares</button>
      </div>
      <h3>Tools</h3>
      <button onClick={() => tool('duckMusic', 'Lower the music to 22% while people speak, with smooth ramps.')}>Lower music under speech</button>
      <button onClick={() => tool('denoise', 'Turn on noise reduction for every clip with sound (applied in the export).')}>Reduce background noise</button>
      <button onClick={() => tool('syncToBeats', 'Move each cut on the main track to the nearest beat of the music.')}>Move cuts onto the beat</button>
        </>
      )}
      {show('Clip') && (
        <>
      <h3>Clip sound</h3>
      <div className="audio-tools">
        <button disabled={!hasSelection} onClick={() => useEditor.getState().removeAudio()} title="Keeps the picture, removes the clip's own sound">Remove audio from selected clips</button>
        <button onClick={() => tool('removeAudio', 'Remove the sound from the video clips (their picture stays; music and sound effects are kept).')}>Remove audio from all video clips</button>
        <button onClick={() => useEditor.getState().restoreAudio()} title="Puts the clips' own sound back (selected clips, or all clips when none is selected)">Bring the audio back{hasSelection ? ' on selected clips' : ' on all clips'}</button>
        <label className="check"><input type="checkbox" checked={autoMute} onChange={(e) => useEditor.getState().setAutoMute(e.target.checked)} /> Automatically remove the audio from clips I add</label>
      </div>
        </>
      )}
      {show('Cameras') && <Multicam />}
    </div>
  )
}

function HistoryTab() {
  const past = useEditor((s) => s.past)
  const future = useEditor((s) => s.future)
  const { undo, redo } = useEditor.getState()
  const projectId = useEditor((s) => s.project!.id)
  /** Every state the project has been in, oldest first: the opening state, then one per edit, then the undone edits that can still be redone. */
  const entries = [{ label: 'Project opened', ai: false }, ...past.map((h) => ({ label: h.label, ai: h.source === 'assistant' })), ...[...future].reverse().map((h) => ({ label: h.label, ai: h.source === 'assistant' }))]
  const current = past.length
  /** Moves to a state by stepping back or forward, so the later states stay available. */
  const goTo = (k: number): void => { for (let n = current; n > k; n--) undo(); for (let n = current; n < k; n++) redo() }
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  useEffect(() => void window.api.projects.snapshots(projectId).then(setSnapshots), [projectId, past.length])
  const restore = async (snap: Snapshot) => {
    const restored = await window.api.projects.loadSnapshot(projectId, snap.file)
    useEditor.getState().apply(`Restore “${snap.label}”`, () => ({ ...restored, updatedAt: new Date().toISOString() }))
  }
  return (
    <>
    <div className="history-panel">
    <p className="hint">Click a step to go back (or forward) to how the project was then. Later steps stay in the list, greyed out, until you make a new edit.</p>
    <ol className="history-list" role="listbox" aria-label="History" tabIndex={0} onKeyDown={(e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); goTo(Math.max(0, current - 1)) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); goTo(Math.min(entries.length - 1, current + 1)) }
      else if (e.key === 'Home') { e.preventDefault(); goTo(0) }
      else if (e.key === 'End') { e.preventDefault(); goTo(entries.length - 1) }
    }}>
      {entries.map((h, k) => (
        <li key={k} role="option" aria-selected={k === current} className={`history-row ${k === current ? 'current' : ''} ${k > current ? 'undone' : ''}`} onClick={() => goTo(k)} title={k === current ? 'The project is at this step' : 'Go to this step'}>
          <span className="history-num">{k}</span>
          <span className="history-label">{h.label}</span>
          {h.ai && <span className="badge">AI</span>}
        </li>
      ))}
    </ol>
    <div className="row"><button onClick={() => goTo(Math.max(0, current - 1))} disabled={current === 0}>Undo</button><button onClick={() => goTo(Math.min(entries.length - 1, current + 1))} disabled={current >= entries.length - 1}>Redo</button></div>
    </div>
    {snapshots.length > 0 && (
      <div className="apply-list">
        <h3>Restore points</h3>
        <p className="hint">Saved to disk before each assistant request. Restoring is itself undoable.</p>
        {snapshots.map((s) => (
          <button key={s.file} onClick={() => void restore(s)}>{s.label} <span className="dim">· {formatDate(s.at)}</span></button>
        ))}
      </div>
    )}
    </>
  )
}

export function Sidebar() {
  const [tab, setTab] = useState<Tab>('Media')
  const { addEffect, setTransition } = useEditor.getState()
  const collapsed = useUi((u) => u.libraryCollapsed)
  return (
    <div className="sidebar">
      <nav className="tabs" role="tablist" onWheel={(e) => { if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY }}>
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} ref={(el) => { if (el && tab === t) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }} onClick={() => { setTab(t); if (collapsed) setLibraryCollapsed(false) }}>{t}</button>
        ))}
        <button className="icon-btn collapse-toggle" onClick={() => setLibraryCollapsed(!collapsed)} aria-pressed={collapsed} title={collapsed ? 'Show the library' : 'Hide the library to give the timeline more room'} aria-label={collapsed ? 'Expand library' : 'Collapse library'}><Icon name={collapsed ? 'down' : 'up'} /></button>
      </nav>
      <div className="tab-body">
        {tab === 'Media' && <MediaLibrary />}
        {tab === 'Audio' && <AudioTab />}
        {tab === 'Styles' && <StylesTab />}
        {tab === 'Looks' && <LooksTab />}
        {tab === 'Text' && <TextTab />}
        {tab === 'Templates' && <TemplatesTab />}
        {tab === 'Captions' && <CaptionsTab />}
        {tab === 'Effects' && <StacksList />}
        {tab === 'Effects' && <ApplyList noun="an effect" items={EFFECTS.map((e) => ({ type: e.type, name: e.name, group: e.category }))} onPick={addEffect} />}
        {tab === 'Transitions' && <ApplyList noun="a transition" items={TRANSITIONS} onPick={setTransition} />}
        {tab === 'History' && <HistoryTab />}
      </div>
    </div>
  )
}
