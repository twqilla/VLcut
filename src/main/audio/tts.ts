/** Text-to-speech with the voices already on the computer: Windows speech, macOS `say`, or espeak-ng on Linux. Nothing is uploaded. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '@shared/types'
import { probeMedia } from '../media/probe'
import { toolPath } from '../media/tools'

export interface Command { file: string; args: string[]; env?: Record<string, string> }

const WIN_LIST = 'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }'
// Text and voice arrive through files and environment variables, never spliced into the script, so nothing typed can run as code.
const WIN_SPEAK = [
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  'if ($env:TTS_VOICE) { $s.SelectVoice($env:TTS_VOICE) }',
  '$s.Rate = [int]$env:TTS_RATE',
  '$s.SetOutputToWaveFile($env:TTS_OUT)',
  '$s.Speak([System.IO.File]::ReadAllText($env:TTS_TEXT, [System.Text.Encoding]::UTF8))',
  '$s.Dispose()'
].join('; ')

export function listCommand(platform: NodeJS.Platform): Command {
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WIN_LIST] }
  if (platform === 'darwin') return { file: 'say', args: ['-v', '?'] }
  return { file: 'espeak-ng', args: ['--voices'] }
}

export function parseVoices(platform: NodeJS.Platform, output: string): string[] {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (platform === 'win32') return lines
  if (platform === 'darwin') return lines.map((l) => l.split(/\s{2,}/)[0].trim()).filter(Boolean)
  // espeak-ng: "Pty Language Age/Gender VoiceName File Other Languages"
  return lines.slice(1).map((l) => l.split(/\s+/)[3]).filter(Boolean)
}

/** `rate` is -10..10 (0 normal), the same scale on every system. */
export function speakCommand(platform: NodeJS.Platform, o: { textFile: string; out: string; voice?: string; rate: number }): Command {
  const wpm = Math.round(175 * 1.12 ** o.rate)
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', WIN_SPEAK], env: { TTS_TEXT: o.textFile, TTS_OUT: o.out, TTS_VOICE: o.voice ?? '', TTS_RATE: String(Math.max(-10, Math.min(10, Math.round(o.rate)))) } }
  if (platform === 'darwin') return { file: 'say', args: [...(o.voice ? ['-v', o.voice] : []), '-r', String(wpm), '-o', o.out, '-f', o.textFile] }
  return { file: 'espeak-ng', args: [...(o.voice ? ['-v', o.voice] : []), '-s', String(wpm), '-w', o.out, '-f', o.textFile] }
}

function run(c: Command): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(c.file, c.args, { env: { ...process.env, ...c.env }, timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
        return reject(new Error(missing ? (process.platform === 'linux' ? 'No speech engine found. Install espeak-ng (for example: sudo apt install espeak-ng).' : `Could not start ${c.file}.`) : stderr || err.message))
      }
      resolve(stdout)
    })
  )
}

export async function listVoices(platform: NodeJS.Platform = process.platform): Promise<string[]> {
  try {
    return parseVoices(platform, await run(listCommand(platform)))
  } catch {
    return []
  }
}

/** Speaks `text` into a WAV file in `dir` and returns it as a library asset. */
export async function speak(dir: string, text: string, voice: string | undefined, rate: number, platform: NodeJS.Platform = process.platform): Promise<MediaAsset> {
  const clean = text.replace(/\r/g, '').trim()
  if (!clean) throw new Error('Type the words to speak first.')
  await mkdir(dir, { recursive: true })
  const name = createHash('sha1').update(`${platform}|${voice}|${rate}|${clean}`).digest('hex').slice(0, 14)
  const wav = join(dir, `${name}.wav`)
  if (!existsSync(wav)) {
    const textFile = join(dir, `${name}.txt`)
    await writeFile(textFile, clean, 'utf8')
    const raw = platform === 'win32' || platform === 'linux' ? wav : join(dir, `${name}.aiff`)
    try {
      await run(speakCommand(platform, { textFile, out: raw, voice, rate }))
      if (raw !== wav) await new Promise<void>((res, rej) => execFile(toolPath('ffmpeg'), ['-y', '-v', 'error', '-i', raw, '-ar', '48000', '-ac', '2', wav], (e, _o, s) => (e ? rej(new Error(s || e.message)) : res())))
    } finally {
      await unlink(textFile).catch(() => undefined)
      if (raw !== wav) await unlink(raw).catch(() => undefined)
    }
  }
  const asset = await probeMedia(wav)
  return { ...asset, name: `Voice · ${clean.slice(0, 28)}${clean.length > 28 ? '…' : ''}`, hasAudio: true }
}
