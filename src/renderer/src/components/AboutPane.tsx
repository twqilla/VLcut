import { useEffect, useState } from 'react'

type Doc = 'LICENSE.txt' | 'THIRD_PARTY_NOTICES.md' | 'PRIVACY.md' | 'FONT_LICENSES.txt' | 'ffmpeg-version.txt'
const DOCS: [Doc, string][] = [['LICENSE.txt', 'Licence (GPL-3.0)'], ['THIRD_PARTY_NOTICES.md', 'Third-party notices'], ['FONT_LICENSES.txt', 'Font licences'], ['PRIVACY.md', 'Privacy'], ['ffmpeg-version.txt', 'Video engine version']]

/** Version, licence, what the app is built from, privacy, and the texts the licences ask to be shown to the person using the program. */
export function AboutPane() {
  const [version, setVersion] = useState('')
  const [open, setOpen] = useState<Doc | null>(null)
  const [text, setText] = useState('')
  useEffect(() => void window.api.legal.version().then(setVersion), [])
  useEffect(() => {
    if (!open) return setText('')
    void window.api.legal.read(open).then((t) => setText(t || 'This file is not part of this build (development builds only have some of the notices).'))
  }, [open])
  return (
    <div className="settings-body about-pane">
      <h3>VLcut {version}</h3>
      <p>Free software under the GNU General Public License, version 3 or later. It comes with no warranty. You may use, study, change and share it under that licence, and the source code is yours to have: ask the person who gave you this program, or use VLcut-source.zip from the same place.</p>
      <p>It runs on your computer. It has no accounts or tracking and sends nothing about you anywhere. The few things that use the internet (captions setup and the optional motion-blur tool) are listed under Privacy.</p>
      <p>You are responsible for having the right to use the videos, photos, music and voices you put into your projects, and for following the rules of the sites you post to. The app does not include or download copyrighted music.</p>
      <p>Built with FFmpeg, Electron, whisper.cpp and open-source fonts. TikTok, YouTube, Instagram, Discord, X, Minecraft, Kodak and Fuji are trademarks of their owners; VLcut is not affiliated with them.</p>
      <div className="row" role="group" aria-label="Legal documents">
        {DOCS.map(([id, label]) => <button key={id} className={open === id ? 'on' : ''} onClick={() => setOpen(open === id ? null : id)}>{label}</button>)}
      </div>
      {open && <textarea readOnly rows={16} value={text} aria-label={DOCS.find(([id]) => id === open)![1]} style={{ width: '100%', fontFamily: 'monospace', fontSize: 11 }} />}
    </div>
  )
}
