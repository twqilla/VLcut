import { useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { COLOUR_STYLES, type StyleDef, gradeOnly, withIntensity } from '@shared/styles/styles'
import { applyStyle } from '@shared/agent/tools'
import { projectDuration } from '@shared/timeline/ops'
import { useEditor } from '../store'
import { player, usePlayback } from '../engine/player'
import { refreshAssistantEnvironment, runSteps, useAssistant } from '../assistant'

/** A live thumbnail: the current frame with the style applied. */
function StyleThumb({ style, project }: { style: StyleDef; project: Project }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const time = usePlayback((s) => (s.playing ? -1 : s.time)) // do not redraw ten thumbnails per frame during playback
  useEffect(() => {
    const id = setTimeout(() => {
      if (ref.current && time >= 0) player.renderVariant(applyStyle(project, style), ref.current)
    }, 60)
    return () => clearTimeout(id)
  }, [style, project, time])
  const { width, height } = project.settings
  const w = 240
  return <canvas ref={ref} width={w} height={Math.round((w * height) / width / 2) * 2} />
}

export function StylesTab() {
  const project = useEditor((s) => s.project!)
  const custom = useAssistant((s) => s.customStyles).map(gradeOnly)
  const [intensity, setIntensity] = useState(1)
  const [name, setName] = useState('')
  const empty = projectDuration(project) <= 0
  const applied = project.tracks.find((t) => t.name === 'Look')?.clips[0]

  useEffect(() => void refreshAssistantEnvironment(), [])

  const apply = (style: StyleDef) => void runSteps(`${style.name} style`, [{ tool: 'applyStyle', args: { styleId: style.id, intensity, colourOnly: 1 }, description: `Apply the ${style.name} colour style: ${style.description}` }])

  /** Captures the look as it stands on the timeline (including the user's tweaks) as a reusable style. */
  const saveVariation = async () => {
    const base = [...custom, ...COLOUR_STYLES].find((s) => applied && s.look.length === applied.effects.length && s.look.every((e, i) => e.type === applied.effects[i].type)) ?? COLOUR_STYLES[0]
    const style: StyleDef = {
      ...base,
      id: `custom-${Date.now()}`,
      name: name.trim() || `My ${base.name}`,
      tagline: 'Saved variation',
      builtin: false,
      look: (applied?.effects ?? []).filter((e) => e.enabled).map((e) => ({ type: e.type, params: { ...e.params } })),
      title: {}, caption: {}, gradeOnly: true
    }
    await window.api.styles.save(style)
    setName('')
    await refreshAssistantEnvironment()
  }

  return (
    <div className="styles-tab">
      {empty && <p className="hint">Add a clip to see previews.</p>}
      <label className="field">
        <span className="field-label">Strength</span>
        <input type="range" min={0.3} max={1.5} step={0.05} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
        <span className="dim">{Math.round(intensity * 100)}%</span>
      </label>
      <div className="style-list">
        {[...custom, ...COLOUR_STYLES].map((style) => (
          <article key={style.id} className="style-card">
            <button className="style-apply" disabled={empty} onClick={() => apply(style)} title={`${style.description} Click to apply (one undo step).`}>
              {!empty && <StyleThumb style={withIntensity(style, intensity)} project={project} />}
              <span className="style-name">{style.name}</span>
              <span className="style-tagline">{style.tagline}</span>
            </button>
            {!style.builtin && <button className="danger" onClick={() => void window.api.styles.remove(style.id).then(refreshAssistantEnvironment)}>Delete my style</button>}
          </article>
        ))}
      </div>
      <div className="style-save">
        <h3>Save as my style</h3>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Style name" aria-label="Style name" />
          <button disabled={!applied} onClick={() => void saveVariation()} title="Save the current Look layer as your own style">Save</button>
          <button disabled={!applied} onClick={() => void runSteps('Remove style', [{ tool: 'removeStyle', args: {}, description: 'Remove the applied style and keep your own edits.' }])}>Remove style</button>
        </div>
      </div>
    </div>
  )
}
