import { useState } from 'react'
import { useEditor } from '../store'
import { formatDuration } from '../format'
import { ASSET_MIME } from './Timeline'
import { clearGhost, dragPayload } from '../dragGhost'
import { describeShots, useJobs } from '../jobs'
import { useEffect } from 'react'
import { searchMedia } from '@shared/analysis/search'
import { player } from '../engine/player'

const KIND_LABEL = { video: 'Video', audio: 'Audio', image: 'Image' } as const

export function MediaLibrary() {
  const media = useEditor((s) => s.project!.media)
  const selectedAssetId = useEditor((s) => s.selectedAssetId)
  const { addMedia, removeMedia, selectAsset } = useEditor.getState()
  const [dragging, setDragging] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const analyzing = useJobs((s) => s.analyzing)
  const failed = useJobs((s) => s.failed)
  const proxying = useJobs((s) => s.proxying)
  const describing = useJobs((s) => s.describing)
  const [vision, setVision] = useState<string | null>(null)
  const [visionError, setVisionError] = useState('')
  useEffect(() => void window.api.vision.status().then(setVision), [])
  const undescribed = media.reduce((n, m) => n + (m.kind === 'video' ? (m.analysis?.shots ?? []).filter((s) => !s.description).length : 0), 0)
  const hits = query.trim() ? searchMedia(media, query) : null
  void player

  const importAssets = async (load: () => Promise<Awaited<ReturnType<typeof window.api.media.pick>>>, requested?: number) => {
    const assets = await load()
    addMedia(assets)
    const errors = await window.api.media.takeErrors()
    const unreadable = errors.length || (requested === undefined ? 0 : requested - assets.length)
    setMessage(
      errors.length
        ? `${errors.length} file${errors.length === 1 ? '' : 's'} could not be imported. ${errors[0].name}: ${errors[0].message}`
        : unreadable > 0
          ? `${unreadable} file${unreadable === 1 ? '' : 's'} could not be read as media.`
          : ''
    )
  }

  return (
    <div
      className={`media-library ${dragging ? 'dragging' : ''}`}
    >
      <div className="panel-header">
        <h2>Media</h2>
        <button className="primary" onClick={() => void importAssets(() => window.api.media.pick())}>
          Import
        </button>
      </div>
      {message && <p className="notice small">{message}</p>}
      {media.length > 0 && <input className="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: “dark static shots”, a spoken phrase, a file name…" aria-label="Search footage" />}
      {vision && undescribed > 0 && (
        <div className="vision-row">
          <button disabled={Boolean(describing)} onClick={() => { setVisionError(''); describeShots().catch((err: Error) => setVisionError(err.message)) }} title="Lets search find what is in the picture">
            {describing ? `Describing shot ${describing}…` : `Describe ${undescribed} shot${undescribed === 1 ? '' : 's'} with ${vision}`}
          </button>
          {visionError && <p className="notice small">{visionError}</p>}
        </div>
      )}
      {hits && (
        <ul className="media-list hits">
          {hits.length === 0 && <li><p className="hint">Nothing matched. Search understands motion, brightness, colour, sound, shot length, file names and recognised speech. It finds objects and places only after shots are described by a local vision model: run one in Ollama (for example “ollama pull llava”) and a “Describe shots” button appears here.</p></li>}
          {hits.map((h, i) => (
            <li key={i}>
              <button className="media-item" onClick={() => selectAsset(h.asset.id)} title={h.reason}>
                <span className={`kind kind-${h.asset.kind}`}>{h.shot ? `${formatDuration(h.shot.start)}` : formatDuration(h.time)}</span>
                <span className="media-name">{h.asset.name}</span>
                <span className="media-meta">{h.reason}{h.shot?.duplicateOf ? ' · duplicate take' : ''}</span>
              </button>
              <button className="icon add" aria-label="Add to timeline" title="Add this part to the timeline" onClick={() => (h.shot ? useEditor.getState().insertRange(h.asset.id, h.shot.start, h.shot.end) : useEditor.getState().insertAsset(h.asset.id))}>+</button>
            </li>
          ))}
        </ul>
      )}
      {hits ? null : media.length === 0 ? (
        <p className="empty">Import files or drop them here.</p>
      ) : (
        <ul className="media-list">
          {media.filter((m) => !m.builtinSfx && !m.builtinOverlay).map((m) => (
            <li key={m.id} className={m.id === selectedAssetId ? 'selected' : ''}>
              <button
                className="media-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(ASSET_MIME, m.id)
                  e.dataTransfer.effectAllowed = 'copy'
                  dragPayload.duration = m.duration > 0 ? m.duration : 5
                  dragPayload.label = m.name
                }}
                onDragEnd={clearGhost}
                onClick={() => selectAsset(m.id === selectedAssetId ? null : m.id)}
                onDoubleClick={() => useEditor.getState().insertAsset(m.id)}
                title={`${m.path}\nDrag onto the timeline, or double-click to add at the end.`}
              >
                <span className={`kind kind-${m.kind}`}>{KIND_LABEL[m.kind]}</span>
                <span className="media-name">{m.name}</span>
                <span className="media-meta">
                  {m.missing ? 'Missing file' : m.kind === 'image' ? `${m.width}×${m.height}` : formatDuration(m.duration)}
                  {m.blurredFrom && ' · motion blurred'}
                  {proxying.includes(m.id) && ' · preparing preview…'}
                  {failed[`proxy-${m.id}`] && ' · cannot be decoded'}
                  {analyzing.includes(m.id) && ' · analysing…'}
                  {failed[m.id] && ' · analysis failed'}
                  {m.analysis && m.kind === 'video' && ` · ${m.analysis.shots.length} shot${m.analysis.shots.length === 1 ? '' : 's'}`}
                  {m.analysis?.bpm ? ` · ${Math.round(m.analysis.bpm)} BPM` : ''}
                </span>
              </button>
              <button className="icon" aria-label={`Remove ${m.name}`} onClick={() => removeMedia(m.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
