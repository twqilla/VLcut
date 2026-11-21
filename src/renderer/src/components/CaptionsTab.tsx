import { useEffect, useState } from 'react'
import type { SpeechStatus } from '@shared/types'
import { BUILTIN_STYLES } from '@shared/styles/styles'
import { shiftWords } from '@shared/captions/refine'
import { addCaptions, captionsFromSrt, exportSubtitles, forgetTranscript, removeCaptions } from '@shared/agent/tools'
import { useEditor } from '../store'
import { TEXT_LOOKS } from '@shared/agent/lexicon'
import { TARGET_LANGUAGES, captionLines, translateCaptions } from '@shared/agent/translate'

const LANGUAGES: [string, string][] = [['auto', 'Detect language'], ['en', 'English'], ['de', 'German'], ['es', 'Spanish'], ['fr', 'French'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'], ['hr', 'Croatian'], ['sr', 'Serbian'], ['tr', 'Turkish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['hi', 'Hindi'], ['ar', 'Arabic']]

/** Takes the caption clips of `translated` (same ids) into `current`, so edits made meanwhile are not lost. */
function translateCaptionsSync(current: import('@shared/types').Project, translated: import('@shared/types').Project): import('@shared/types').Project {
  const text = new Map(translated.tracks.flatMap((t) => t.clips).filter((c) => c.origin === 'caption').map((c) => [c.id, c.text]))
  return { ...current, tracks: current.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (text.has(c.id) && text.get(c.id) ? { ...c, text: text.get(c.id)! } : c)) })) }
}

export function CaptionsTab() {
  const project = useEditor((s) => s.project!)
  const { apply, patchMedia } = useEditor.getState()
  const [status, setStatus] = useState<SpeechStatus | null>(null)
  const [model, setModel] = useState('base')
  const [language, setLanguage] = useState('auto')
  const [progress, setProgress] = useState<{ label: string; fraction: number } | null>(null)
  const [message, setMessage] = useState('')
  const [templateId, setTemplateId] = useState('studio-warm')
  const [llm, setLlm] = useState<{ available: boolean; model: string | null }>({ available: false, model: null })
  const [target, setTarget] = useState('Spanish')
  const [translating, setTranslating] = useState(false)
  const [translateNote, setTranslateNote] = useState('')
  const [unchecked, setUnchecked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => void window.api.llm.status().then(setLlm), [])

  useEffect(() => {
    void window.api.speech.status().then((s) => {
      setStatus(s)
      if (s.models.length && !s.models.includes('base')) setModel(s.models[0])
    })
    return window.api.speech.onProgress(setProgress)
  }, [])

  const template = BUILTIN_STYLES.find((s) => s.id === templateId)!
  const used = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)))
  const speakable = project.media.filter((m) => used.has(m.id) && (m.hasAudio || m.kind === 'audio') && !m.builtinSfx && !m.missing)
  const chosen = speakable.filter((m) => !unchecked.includes(m.id))
  const pending = chosen.filter((m) => !m.analysis?.transcript)
  const captionCount = project.tracks.flatMap((t) => t.clips).filter((c) => c.origin === 'caption').length
  const ready = Boolean(status?.binary && status.models.includes(model))

  const guard = async (work: () => Promise<void>) => {
    setMessage('')
    try {
      await work()
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setProgress(null)
    }
  }

  const install = () => guard(async () => { setBusy(true); try { setStatus(await window.api.speech.install(model)) } finally { setBusy(false) } })

  /** Gives every caption one of the text looks (neon, gold, comic…), keeping its words and timing. */
  const lookCaptions = (id: string) =>
    apply('Caption look', (p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.origin === 'caption' && c.text ? { ...c, text: { ...c.text, ...TEXT_LOOKS[id].look, fontSize: Math.min(0.075, TEXT_LOOKS[id].look.fontSize ?? 0.05), animation: c.text.words?.length ? c.text.animation : TEXT_LOOKS[id].look.animation ?? c.text.animation, content: c.text.content, words: c.text.words } } : c)) })) }))

  const translate = async () => {
    setTranslating(true)
    setTranslateNote('')
    try {
      const r = await translateCaptions(useEditor.getState().project!, target, (prompt) => window.api.llm.complete(prompt))
      if (r.translated) apply(`Translate captions to ${target}`, (p) => translateCaptionsSync(p, r.project))
      setTranslateNote(r.translated ? `Translated ${r.translated} caption${r.translated === 1 ? '' : 's'} to ${target}${r.failed ? `; ${r.failed} could not be translated and were left as they were` : ''}. Undo brings the original back.` : 'The model did not give usable translations. Try a larger model, or translate fewer captions at a time.')
    } catch (err) {
      setTranslateNote((err as Error).message)
    } finally {
      setTranslating(false)
    }
  }

  const generate = () => apply('Generate captions', (p) => addCaptions(p, template.caption, template.captionY, { maxWords: 7, maxGap: 0.7, assetIds: chosen.map((m) => m.id) }).project)
  const removeAll = () => {
    let n = 0
    apply('Remove captions', (p) => { const r = removeCaptions(p); n = r.count; return r.project })
    setMessage(n ? `Removed ${n} caption${n === 1 ? '' : 's'}. Undo brings them back.` : 'There are no captions to remove.')
  }
  const forget = (id: string) => { apply('Forget recognised speech', (p) => forgetTranscript(p, id)); setMessage('The recognised speech was forgotten for that file. Captions already on the timeline are kept; remove them with “Remove all captions”.') }
  const cancel = () => void window.api.speech.cancel()

  const transcribe = () =>
    guard(async () => {
      setBusy(true)
      try {
      for (const asset of pending) {
        const result = await window.api.speech.transcribe(asset.path, model, language)
        patchMedia((media) => media.map((m) => (m.id === asset.id ? { ...m, analysis: { version: 1, silences: [], shots: [], beats: [], bpm: null, loudness: null, ...m.analysis, transcript: result.words, language: result.language } } : m)))
      }
      generate()
      } finally {
        setBusy(false)
      }
    })

  const importSrt = () =>
    guard(async () => {
      const srt = await window.api.files.openText(['srt', 'vtt'])
      if (!srt) return
      let count = 0
      apply('Import subtitles', (p) => {
        const r = captionsFromSrt(p, srt, template.caption, template.captionY)
        count = r.captions
        return r.project
      })
      setMessage(count ? `Imported ${count} captions.` : 'No captions found in that file.')
    })

  const exportAs = (format: 'srt' | 'vtt') => guard(async () => { await window.api.files.saveText(`${project.name}.${format}`, exportSubtitles(project, format)) })

  const restyle = (id: string) => {
    setTemplateId(id)
    const t = BUILTIN_STYLES.find((s) => s.id === id)!
    apply(`Caption style: ${t.name}`, (p) => ({ ...p, tracks: p.tracks.map((tr) => ({ ...tr, clips: tr.clips.map((c) => (c.origin === 'caption' && c.text ? { ...c, text: { ...c.text, ...t.caption }, transform: { ...c.transform, y: t.captionY } } : c)) })) }))
  }

  /** Moves the timing of every caption word a little (for captions that sit early or late). One undo step. */
  const nudgeCaptions = (seconds: number): void =>
    useEditor.getState().apply(seconds < 0 ? 'Captions earlier' : 'Captions later', (p) => ({
      ...p,
      tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.origin === 'caption' && c.text?.words ? { ...c, text: { ...c.text, words: shiftWords(c.text.words, seconds) } } : c)) }))
    }), { coalesce: 'caption-nudge' })
  return (
    <div className="captions-tab">
      <section>
        <h3>Speech recognition</h3>
        {status === null ? <p className="hint">Checking…</p> : ready ? (
          <p className="hint">Installed and running on this computer. Nothing is uploaded.</p>
        ) : (
          <>
            <p className="hint">
              Captions are recognised offline with whisper.cpp. It needs a one-time download ({status.canAutoInstall ? 'the speech engine and a model' : 'a model'}); after that it works without internet.
              {!status.binary && !status.canAutoInstall && ' On this system, install whisper.cpp yourself first so that “whisper-cli” is on your PATH.'}
            </p>
            <button onClick={() => void install()} disabled={Boolean(progress)}>Download and set up</button>
          </>
        )}
        <label className="field"><span className="field-label">Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="tiny">Tiny · 75 MB · fastest</option>
            <option value="base">Base · 142 MB · recommended</option>
            <option value="small">Small · 466 MB · most accurate</option>
          </select>
        </label>
        <label className="field"><span className="field-label">Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        {speakable.length > 0 && (
          <ul className="speech-files" aria-label="Files to recognise">
            {speakable.map((m) => (
              <li key={m.id}>
                <label><input type="checkbox" checked={!unchecked.includes(m.id)} disabled={busy} onChange={(e) => setUnchecked((u) => (e.target.checked ? u.filter((x) => x !== m.id) : [...u, m.id]))} /> {m.name}</label>
                <span className="hint">{m.analysis?.transcript ? `${m.analysis.transcript.length} words recognised` : 'not recognised yet'}</span>
                {m.analysis?.transcript && <button disabled={busy} aria-label={`Forget the recognised speech of ${m.name}`} onClick={() => forget(m.id)}>Forget</button>}
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="primary" disabled={!ready || !chosen.length || busy} onClick={() => void (pending.length ? transcribe() : generate())}>
            {pending.length ? `Recognise speech in ${pending.length} file${pending.length === 1 ? '' : 's'} and add captions` : captionCount ? 'Regenerate captions from the chosen files' : 'Add captions from the chosen files'}
          </button>
          {(busy || progress) && <button aria-label="Cancel" onClick={cancel}>Cancel</button>}
          <button disabled={!captionCount || busy} onClick={removeAll}>Remove all captions{captionCount ? ` (${captionCount})` : ''}</button>
        </div>
        <div className="row" role="group" aria-label="Caption timing">
          <span className="dim" title="If the words show up a little early or late, move all of them">Timing</span>
          <button disabled={!captionCount} onClick={() => nudgeCaptions(-0.05)} title="Words appear 0.05 s earlier" aria-label="Captions earlier">◀ Earlier</button>
          <button disabled={!captionCount} onClick={() => nudgeCaptions(0.05)} title="Words appear 0.05 s later" aria-label="Captions later">Later ▶</button>
        </div>
        {!speakable.length && <p className="hint">Put footage with sound on the timeline first.</p>}
        {speakable.length > 0 && !chosen.length && <p className="hint">Tick at least one file above to use its speech.</p>}
        {progress && <div className="progress-line"><progress value={progress.fraction} max={1} /><span>{progress.label} · {Math.round(progress.fraction * 100)}%</span></div>}
        {message && <p className="notice small">{message}</p>}
      </section>

      <section>
        <h3>Caption design</h3>
        <div className="caption-templates">
          {BUILTIN_STYLES.map((s) => (
            <button key={s.id} className={s.id === templateId ? 'on' : ''} onClick={() => restyle(s.id)} title={`Apply to ${captionCount || 'new'} captions`}>
              <span className="sample" style={{ fontFamily: `"${s.caption.fontFamily}"`, fontWeight: s.caption.weight, fontStyle: s.caption.italic ? 'italic' : 'normal', textTransform: s.caption.uppercase ? 'uppercase' : 'none', color: s.caption.color, background: s.caption.boxColor || undefined }}>
                Every <span style={s.caption.activeWordBox ? { background: s.caption.activeWordBox, borderRadius: 3, padding: '0 3px' } : { color: s.caption.highlightColor }}>word</span> lands
              </span>
              <span className="tile-name">{s.name}</span>
            </button>
          ))}
        </div>
        <p className="hint">Select any caption on the timeline to correct words or change its font, colours, box, outline and animation.</p>
      </section>

      <section>
        <h3>More caption looks</h3>
        <div className="caption-templates">
          {['neon', 'gold', 'chrome', 'outline', 'comic', 'gradient', 'glitch', 'retro', 'handwritten', 'meme', 'minimal', 'kinetic'].map((id) => (
            <button key={id} disabled={!captionCount} onClick={() => lookCaptions(id)} title={captionCount ? `Apply to ${captionCount} captions` : 'Add captions first'}>
              <span className="tile-name">{TEXT_LOOKS[id].name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Translate captions</h3>
        <div className="row">
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Translate captions to">
            {TARGET_LANGUAGES.map((l) => <option key={l}>{l}</option>)}
          </select>
          <button disabled={!captionCount || !llm.available || translating} onClick={() => void translate()}>{translating ? 'Translating…' : 'Translate'}</button>
        </div>
        {!llm.available && <p className="hint">Translation uses a language model running on this computer through the free Ollama app, so nothing is uploaded. Ollama was not found. Install it, download a model (for example “ollama pull llama3.1”) and it will be used automatically.</p>}
        {llm.available && <p className="hint">Using {llm.model}. Each caption keeps its timing and look; word-by-word highlighting becomes evenly spaced. Quality depends on the model.</p>}
        {translateNote && <p className="notice small" role="status">{translateNote}</p>}
        <p className="hint">{captionLines(project).length} captions on the timeline.</p>
      </section>

      <section>
        <h3>Files</h3>
        <div className="row">
          <button onClick={() => void importSrt()}>Import .srt</button>
          <button disabled={!captionCount} onClick={() => void exportAs('srt')}>Export .srt</button>
          <button disabled={!captionCount} onClick={() => void exportAs('vtt')}>Export .vtt</button>
        </div>
      </section>
    </div>
  )
}
