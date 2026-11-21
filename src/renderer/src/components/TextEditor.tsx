import { useRef, useEffect } from 'react'
import type { Clip, TextProps } from '@shared/types'
import { FONT_CATEGORIES, TEXT_ANIMATIONS, TEXT_OUT_ANIMATIONS } from '@shared/effects/registry'
import { TEXT_LOOKS } from '@shared/agent/lexicon'
import * as ops from '@shared/timeline/ops'
import { useEditor } from '../store'
import { player } from '../engine/player'
import { useCustomFonts } from '../engine/fonts'
import { setTextEditor, toggleGroup, useUi } from '../ui'

const LOOK_BUTTONS = ['title', 'subtitle', 'neon', 'gold', 'chrome', 'outline', 'comic', 'retro', 'handwritten', 'meme', 'minimal', 'glitch']

/**
 * The text editor: a small window over the preview that opens when you add text or double-click it. The words, font, size, colour,
 * looks, animations, position and timing are all here, so the Properties panel is not needed for ordinary text.
 */
export function TextEditor() {
  const open = useUi((s) => s.textEditorOpen)
  // Selectors return the clip itself and a track id (stable values), never a fresh wrapper object, which would re-render forever.
  const selected = useEditor((s) => (s.selection.length === 1 ? ops.findClip(s.project!, s.selection[0])?.clip : undefined))
  const trackId = useEditor((s) => (s.selection.length === 1 ? ops.findClip(s.project!, s.selection[0])?.track.id : undefined))
  const customFonts = useCustomFonts((s) => s.names)
  const area = useRef<HTMLTextAreaElement>(null)
  const more = useUi((s) => s.openGroups.includes('text-editor-more'))
  const small = useUi((s) => s.openGroups.includes('text-editor-small'))
  const clip: Clip | undefined = selected?.text ? selected : undefined
  const id = clip?.id
  // The words are selected when the editor opens for a clip, so typing replaces the placeholder.
  useEffect(() => { if (open && id) { area.current?.focus(); area.current?.select() } }, [open, id])
  if (!open || !clip || !trackId) return null
  const t = clip.text!
  const set = (patch: Partial<TextProps>, key = 'text-edit'): void => useEditor.getState().updateSelected('Edit text', () => ({ text: { ...t, ...patch } }), key)
  const apply = useEditor.getState().apply
  const place = (y: number): void => useEditor.getState().updateSelected('Move text', (c) => ({ transform: { ...c.transform, x: 0, y } }))
  const start = (v: number): void => apply('Move text on the timeline', (p) => ops.moveClip(p, clip.id, trackId, Math.max(0, v)), { coalesce: `text-start-${clip.id}` })
  const length = (v: number): void => apply('Change text length', (p) => ops.trimClipEnd(p, clip.id, clip.start + Math.max(0.2, v)), { coalesce: `text-length-${clip.id}` })
  const isCaption = clip.origin === 'caption'

  return (
    <div className="text-editor" role="dialog" aria-label="Edit text" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <header>
        <strong>{isCaption ? 'Edit caption' : 'Edit text'}</strong>
        <span className="spacer" />
        <button aria-label={small ? 'Show the text editor' : 'Make the text editor small'} title={small ? 'Show all settings' : 'Make this window small so the preview is visible'} onClick={() => toggleGroup('text-editor-small')}>{small ? '▢' : '–'}</button>
        <button aria-label="Close text editor" onClick={() => setTextEditor(false)}>×</button>
      </header>
      {!small && (
        <>
      <textarea ref={area} aria-label="Text" rows={3} value={t.content} onChange={(e) => set({ content: e.target.value })} placeholder="Type your text" />
      <div className="te-row">
        <select aria-label="Font" title="The typeface of the text" value={t.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
          {customFonts.length > 0 && <optgroup label="Your fonts">{customFonts.map((f) => <option key={f}>{f}</option>)}</optgroup>}
          {FONT_CATEGORIES.map((c) => <optgroup key={c.name} label={c.name}>{c.fonts.map((f) => <option key={f}>{f}</option>)}</optgroup>)}
        </select>
        <input type="number" aria-label="Font size" min={8} max={540} step={1} value={Math.round(t.fontSize * 1080)} onChange={(e) => set({ fontSize: Math.min(0.5, Math.max(0.008, (Number(e.target.value) || t.fontSize * 1080) / 1080)) })} title="Font size in points (for a 1080-pixel-high picture; it scales with the project size)" />
        <input type="color" title="Text colour" aria-label="Text colour" value={t.color.length === 7 ? t.color : '#ffffff'} onChange={(e) => set({ color: e.target.value })} />
      </div>
      <div className="te-row">
        <button className={t.weight >= 700 ? 'on' : ''} aria-pressed={t.weight >= 700} title="Bold" aria-label="Bold" onClick={() => set({ weight: t.weight >= 700 ? 400 : 800 })}><b>B</b></button>
        <button className={t.italic ? 'on' : ''} aria-pressed={t.italic} title="Slanted letters" aria-label="Italic" onClick={() => set({ italic: !t.italic })}><i>I</i></button>
        <button className={t.uppercase ? 'on' : ''} aria-pressed={t.uppercase} title="ALL CAPITALS" aria-label="Capitals" onClick={() => set({ uppercase: !t.uppercase })}>AA</button>
        {(['left', 'center', 'right'] as const).map((a) => <button key={a} className={t.align === a ? 'on' : ''} aria-pressed={t.align === a} aria-label={`Align ${a}`} onClick={() => set({ align: a })}>{a === 'left' ? '⟸' : a === 'center' ? '≡' : '⟹'}</button>)}
      </div>
      {!isCaption && t.animation === 'typewriter' && (
        <div className="te-row" role="group" aria-label="Typed out">
          <label className="te-inline">Typing time <input type="number" aria-label="Typing time" min={0.2} max={60} step={0.1} value={t.typeSeconds ?? Math.round(Math.max(0.2, [...t.content].length / 26) * 10) / 10} onChange={(e) => set({ typeSeconds: Math.min(60, Math.max(0.2, Number(e.target.value) || 1)) })} title="Seconds the whole text takes to type out" /> s</label>
          <label className="te-inline"><input type="checkbox" aria-label="Blinking cursor" checked={t.typeCursor !== false} onChange={(e) => set({ typeCursor: e.target.checked })} /> Blinking cursor</label>
        </div>
      )}
      {!isCaption && (
        <div className="te-row">
          <label className="te-inline" title="How the text arrives on screen">Appears <select aria-label="Animation in" value={t.animation} onChange={(e) => set({ animation: e.target.value })}>{TEXT_ANIMATIONS.map((a) => <option key={a.type} value={a.type}>{a.name}</option>)}</select></label>
          <label className="te-inline" title="How the text leaves the screen">Leaves <select aria-label="Animation out" value={t.animationOut ?? 'none'} onChange={(e) => set({ animationOut: e.target.value === 'none' ? undefined : e.target.value })}><option value="none">None</option>{TEXT_OUT_ANIMATIONS.filter((a) => a.type !== 'none').map((a) => <option key={a.type} value={a.type}>{a.name}</option>)}</select></label>
        </div>
      )}
      <button type="button" className="te-more" aria-expanded={more} onClick={() => toggleGroup('text-editor-more')} title="Outline, shadow, quick styles, position and timing">{more ? '▾' : '▸'} More options</button>
      {more && (
        <>
          <div className="te-row">
        <label className="te-inline" title="A line around each letter">Outline <input type="range" aria-label="Outline" min={0} max={0.15} step={0.005} value={t.outlineWidth} onChange={(e) => set({ outlineWidth: Number(e.target.value) })} /></label>
        <label className="te-inline" title="A dark shadow behind the text so it is easier to read">Shadow <input type="range" aria-label="Shadow" min={0} max={1} step={0.05} value={t.shadow} onChange={(e) => set({ shadow: Number(e.target.value) })} /></label>
          </div>
      <div className="te-looks" role="group" aria-label="Looks" title="Quick styles: one click sets font, colour and effects together">
        {LOOK_BUTTONS.map((l) => <button key={l} onClick={() => set({ ...TEXT_LOOKS[l].look, content: t.content, fontSize: t.fontSize }, 'text-look')} title={`Give the text the ${TEXT_LOOKS[l].name} look`}>{TEXT_LOOKS[l].name}</button>)}
      </div>
      <div className="te-row">
        <span title="Where the text sits in the picture">Position</span>
        <button onClick={() => place(-0.34)}>Top</button><button onClick={() => place(0)}>Middle</button><button onClick={() => place(0.34)}>Bottom</button>
      </div>
      <div className="te-row">
        <label className="te-inline" title="The second of the video where the text appears">Starts at <input type="number" aria-label="Starts at" min={0} step={0.1} value={Math.round(clip.start * 100) / 100} onChange={(e) => start(Number(e.target.value) || 0)} /> s</label>
        <label className="te-inline" title="How many seconds the text stays on screen">Lasts <input type="number" aria-label="Lasts" min={0.2} step={0.1} value={Math.round(clip.duration * 100) / 100} onChange={(e) => length(Number(e.target.value) || clip.duration)} /> s</label>
      </div>
      <div className="te-row">
        <button onClick={() => apply('Text starts here', (p) => ops.moveClip(p, clip.id, trackId, player.time))} title="Move the text so it starts at the playhead">Start at playhead</button>
        <button onClick={() => apply('Text ends here', (p) => ops.trimClipEnd(p, clip.id, Math.max(clip.start + 0.2, player.time)))} title="Make the text end at the playhead">End at playhead</button>
      </div>
        </>
      )}
      <div className="te-row">
        <span className="spacer" />
        <button onClick={() => useEditor.getState().duplicateSelection()}>Duplicate</button>
        <button className="danger" aria-label="Delete text" onClick={() => { useEditor.getState().deleteSelection(); setTextEditor(false) }}>Delete</button>
      </div>
        </>
      )}
    </div>
  )
}
