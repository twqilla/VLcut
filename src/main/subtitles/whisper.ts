/**
 * Offline speech recognition through whisper.cpp (MIT licence).
 * The app looks for the `whisper-cli` program and a model file; both can be
 * bundled with the installer or downloaded once from inside the app.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SpeechStatus, Word } from '@shared/types'
import { toolPath } from '../media/tools'

export const MODELS: Record<string, { file: string; sizeMb: number; note: string }> = {
  tiny: { file: 'ggml-tiny.bin', sizeMb: 75, note: 'Fastest, least accurate' },
  base: { file: 'ggml-base.bin', sizeMb: 142, note: 'Good balance (recommended)' },
  small: { file: 'ggml-small.bin', sizeMb: 466, note: 'More accurate, slower (best if words are missed)' }
}
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'
/** Windows build of whisper.cpp. Pinned; update together with the parser if the output format changes. */
const WINDOWS_BINARY_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip'

/**
 * Keep quiet or unclear speech instead of dropping it: whisper normally throws away a piece when it thinks
 * there is no speech (-nth) or when it is not confident enough (-lpt, -et). The thresholds are loosened,
 * and the audio is levelled first (above) so quiet voices reach the model at a normal volume.
 */
export const RECOGNITION_FLAGS = ['-nth', '0.85', '-lpt', '-2.0', '-et', '3.0']

const exe = (n: string): string => (process.platform === 'win32' ? `${n}.exe` : n)

function findBinary(userDir: string): string | null {
  const names = ['whisper-cli', 'whisper-cpp', 'whisper']
  const dirs = [join(process.resourcesPath ?? '', 'bin'), userDir, join(userDir, 'Release'), ...(process.env.PATH ?? '').split(delimiter)]
  for (const dir of dirs) for (const name of names) if (dir && existsSync(join(dir, exe(name)))) return join(dir, exe(name))
  return null
}

async function findModels(userDir: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {}
  for (const dir of [join(process.resourcesPath ?? '', 'models'), userDir]) {
    let files: string[] = []
    try {
      files = await readdir(dir)
    } catch {
      continue
    }
    for (const [name, m] of Object.entries(MODELS)) if (files.includes(m.file)) found[name] ??= join(dir, m.file)
  }
  return found
}

export async function speechStatus(userDir: string): Promise<SpeechStatus> {
  return { binary: findBinary(userDir), models: Object.keys(await findModels(userDir)), canAutoInstall: process.platform === 'win32' }
}

let activeProc: ChildProcess | null = null
let activeAbort: AbortController | null = null
let cancelled = false

/** Stops recognition or a download that is running. */
export function cancelSpeech(): void {
  cancelled = true
  activeAbort?.abort()
  activeProc?.kill()
}

async function download(url: string, dest: string, onProgress: (fraction: number) => void): Promise<void> {
  activeAbort = new AbortController()
  const res = await fetch(url, { redirect: 'follow', signal: activeAbort.signal })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (chunk: Buffer) => {
    got += chunk.length
    if (total) onProgress(got / total)
  })
  try {
    await pipeline(body, createWriteStream(`${dest}.part`))
  } catch (err) {
    await rm(`${dest}.part`, { force: true })
    throw cancelled ? new Error('Cancelled.') : err
  } finally {
    activeAbort = null
  }
  await rename(`${dest}.part`, dest)
}

function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd })
    let err = ''
    proc.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err.trim() || `${cmd} exited with code ${code}`))))
  })
}

/** One-time setup: downloads a model, and on Windows the whisper.cpp program too. Needs internet once. */
export async function installSpeech(userDir: string, model: string, onProgress: (label: string, fraction: number) => void): Promise<SpeechStatus> {
  cancelled = false
  const spec = MODELS[model]
  if (!spec) throw new Error(`Unknown model: ${model}`)
  await mkdir(userDir, { recursive: true })
  if (!findBinary(userDir)) {
    if (process.platform !== 'win32') throw new Error('Install whisper.cpp first (for example "brew install whisper-cpp" on macOS, or your Linux package manager) so that "whisper-cli" is on your PATH.')
    const zip = join(userDir, 'whisper.zip')
    await download(WINDOWS_BINARY_URL, zip, (f) => onProgress('Downloading speech engine', f))
    await run('tar', ['-xf', zip], userDir) // tar ships with Windows 10 and later and reads zip files
    await rm(zip, { force: true })
  }
  if (!(await findModels(userDir))[model]) await download(MODEL_URL + spec.file, join(userDir, spec.file), (f) => onProgress(`Downloading ${model} model (${spec.sizeMb} MB)`, f))
  return speechStatus(userDir)
}

interface WhisperJson {
  result?: { language?: string }
  transcription?: { offsets: { from: number; to: number }; text: string }[]
}

/** Turns whisper.cpp's JSON (run with one token per segment) into clean words. */
export function parseWhisperJson(json: WhisperJson): { words: Word[]; language?: string } {
  const words: Word[] = []
  for (const seg of json.transcription ?? []) {
    const raw = seg.text
    const text = raw.trim()
    // Skip non-speech markers such as [MUSIC] or (applause).
    if (!text || /^[[(].*[\])]$/.test(text) || /^[[(♪]/.test(text)) continue
    const [start, end] = [seg.offsets.from / 1000, seg.offsets.to / 1000]
    const last = words[words.length - 1]
    // A piece with no leading space (or pure punctuation) continues the previous word.
    if (last && (!/^\s/.test(raw) || /^[\p{P}]+$/u.test(text))) {
      last.text += text
      last.end = Math.max(last.end, end)
    } else words.push({ text, start, end: Math.max(end, start + 0.05) })
  }
  return { words, language: json.result?.language }
}

export async function transcribe(path: string, userDir: string, model: string, language: string, onProgress: (fraction: number) => void): Promise<{ words: Word[]; language?: string }> {
  const binary = findBinary(userDir)
  const modelPath = (await findModels(userDir))[model]
  if (!binary || !modelPath) throw new Error('Speech recognition is not installed yet.')
  cancelled = false
  const work = await mkdtemp(join(tmpdir(), 'vlcut-stt-'))
  try {
    const wav = join(work, 'audio.wav')
    await run(toolPath('ffmpeg'), ['-y', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-af', 'highpass=f=70,dynaudnorm=f=200:g=11:p=0.9:m=15', '-c:a', 'pcm_s16le', wav])
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(binary, ['-m', modelPath, '-f', wav, '-l', language || 'auto', '-oj', '-of', join(work, 'out'), '-ml', '1', '-sow', '-pp', ...RECOGNITION_FLAGS])
      let err = ''
      proc.stderr.on('data', (d: Buffer) => {
        const text = d.toString()
        err = (err + text).slice(-2000)
        const m = /progress\s*=\s*(\d+)%/.exec(text)
        if (m) onProgress(Number(m[1]) / 100)
      })
      proc.on('error', reject)
      proc.on('close', (code) => { activeProc = null; return code === 0 ? resolve() : reject(new Error(cancelled ? 'Cancelled.' : err.trim() || `whisper exited with code ${code}`)) })
      activeProc = proc
    })
    return parseWhisperJson(JSON.parse(await readFile(join(work, 'out.json'), 'utf8')) as WhisperJson)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
