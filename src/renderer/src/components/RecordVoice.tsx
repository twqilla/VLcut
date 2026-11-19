import { useEffect, useRef, useState } from 'react'
import { makeClip } from '@shared/timeline/model'
import * as ops from '@shared/timeline/ops'
import { useEditor } from '../store'
import { player } from '../engine/player'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Record a voice-over from the microphone straight onto an audio track, optionally while the timeline plays. */
export function RecordVoice() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [state, setState] = useState<'idle' | 'countdown' | 'recording' | 'saving'>('idle')
  const [count, setCount] = useState(3)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [countdown, setCountdown] = useState(true)
  const [playAlong, setPlayAlong] = useState(false)
  const [note, setNote] = useState('')
  const stop = useRef<(() => void) | null>(null)

  const refresh = async (): Promise<void> => setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'))
  useEffect(() => { void refresh().catch(() => undefined); return () => stop.current?.() }, [])

  const start = async () => {
    setNote('')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    } catch (err) {
      setNote(`The microphone could not be opened: ${(err as Error).message || 'permission denied'}. Check that it is plugged in and that Windows lets desktop apps use it (Settings → Privacy → Microphone).`)
      return
    }
    void refresh()
    if (countdown) {
      setState('countdown')
      for (let n = 3; n >= 1; n--) { setCount(n); await sleep(1000) }
    }
    const startAt = player.time
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    let peakSeen = 0
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' })
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const began = performance.now()
    let raf = 0
    const tick = (): void => {
      analyser.getFloatTimeDomainData(buf)
      const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
      peakSeen = Math.max(peakSeen, peak)
      setLevel(peak)
      setSeconds((performance.now() - began) / 1000)
      raf = requestAnimationFrame(tick)
    }
    const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
    stop.current = () => { if (recorder.state !== 'inactive') recorder.stop() }
    recorder.start(250)
    if (playAlong) player.play()
    setState('recording')
    raf = requestAnimationFrame(tick)
    await finished
    cancelAnimationFrame(raf)
    player.pause()
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
    setLevel(0)
    stop.current = null
    setState('saving')
    try {
      const { project, addMedia, apply, select } = useEditor.getState()
      const number = project!.media.filter((m) => m.name.startsWith('Voice recording')).length + 1
      const asset = await window.api.recording.save(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer(), number)
      addMedia([asset])
      const clip = makeClip({ assetId: asset.id, start: startAt, duration: asset.duration })
      apply('Record voice-over', (p) => {
        const free = p.tracks.find((t) => t.kind === 'audio' && !t.locked && ops.freeStart(t, clip.start, clip.duration) === clip.start)
        const withTrack = free ? p : ops.addTrack(p, 'audio')
        return ops.addClip(withTrack, (free ?? withTrack.tracks[withTrack.tracks.length - 1]).id, clip)
      })
      select([clip.id])
      setNote(`Recorded ${asset.duration.toFixed(1)} s and put it at ${startAt.toFixed(1)} s.${peakSeen < 0.01 ? ' It is almost silent: is the microphone muted or the wrong one selected?' : ''}`)
    } catch (err) {
      setNote((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setState('idle')
    }
  }

  return (
    <>
      <h3>Record voice-over (microphone)</h3>
      <div className="audio-tools">
        <div className="row">
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Microphone" disabled={state !== 'idle'}>
            <option value="">Default microphone</option>
            {devices.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
          </select>
        </div>
        <div className="meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))}><i style={{ width: `${Math.min(100, Math.sqrt(level) * 100)}%` }} /></div>
        <div className="row">
          {state === 'recording' ? (
            <button className="primary" onClick={() => stop.current?.()} aria-label="Stop recording">■ Stop · {seconds.toFixed(1)} s</button>
          ) : (
            <button className="primary" disabled={state !== 'idle'} onClick={() => void start()} aria-label="Start recording">● {state === 'countdown' ? `Starting in ${count}…` : state === 'saving' ? 'Saving…' : 'Record at the playhead'}</button>
          )}
        </div>
        <label className="check"><input type="checkbox" checked={countdown} disabled={state !== 'idle'} onChange={(e) => setCountdown(e.target.checked)} /> 3-second countdown</label>
        <label className="check"><input type="checkbox" checked={playAlong} disabled={state !== 'idle'} onChange={(e) => setPlayAlong(e.target.checked)} /> Play the timeline while recording (use headphones)</label>
        {note && <p className="hint" role="status">{note}</p>}
        <p className="hint">The take is saved as a normal audio file in your library and placed on an audio track at the playhead. Nothing is uploaded.</p>
      </div>
    </>
  )
}
