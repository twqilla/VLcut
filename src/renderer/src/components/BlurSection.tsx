import { useEffect, useState } from 'react'
import type { InterpoliniSettings } from '@shared/render/interpolini'
import { Section } from './fields'
import { InterpoliniPanel } from './InterpoliniPanel'
import { cancelBlur, loadBlurSettings, saveBlurSettings, useBlur } from '../blur'

interface Props {
  title: string
  /** Frame rate the blurred copy is blended down to (the project's). */
  blendFps: number
  clipFps: number
  /** Label of the main button. */
  action: string
  onBlur(settings: InterpoliniSettings): void
  /** Set when what is selected is already blurred. */
  blurredNote?: string
  onRemove?: () => void
  /** One line about what the result is used for. */
  explain: string
}

/** Motion blur with interpolini for a clip or a library file: settings, one button, progress. */
export function BlurSection({ title, blendFps, clipFps, action, onBlur, blurredNote, onRemove, explain }: Props) {
  const [settings, setSettings] = useState(loadBlurSettings)
  const { busy, text, error } = useBlur()
  useEffect(() => saveBlurSettings(settings), [settings])
  return (
    <Section title={title}>
      {blurredNote && <p className="hint blurred-note">Blurred with interpolini: {blurredNote}.</p>}
      <InterpoliniPanel settings={settings} onChange={setSettings} exportFps={blendFps} clipFps={clipFps} blendLabel="the project's frame rate" />
      <div className="field blur-actions">
        <button className="primary" disabled={busy} onClick={() => onBlur(settings)}>{action}</button>
        {onRemove && <button disabled={busy} onClick={onRemove}>Remove blur</button>}
        {busy && <button onClick={cancelBlur}>Cancel</button>}
      </div>
      {busy && <p className="hint" role="status">Blurring… {text}</p>}
      {error && <p className="notice small" role="alert">{error}</p>}
      <p className="hint">{explain}</p>
    </Section>
  )
}
