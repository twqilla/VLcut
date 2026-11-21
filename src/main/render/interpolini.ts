/**
 * Runs interpolini (https://github.com/Z1xus/interpolini, GPL-3.0) for motion blur. interpolini interpolates
 * the footage to a very high frame rate with RIFE or SVP on the graphics card and blends it back down;
 * this module only finds the program, downloads it on request, runs it and reads its progress.
 */
import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { InterpoliniStatus } from '@shared/types'
import { explainExit } from '@shared/winExit'
import { type InterpoliniSettings, interpoliniArgs, parseInterpoliniLine } from '@shared/render/interpolini'

const exe = process.platform === 'win32' ? 'interpolini-cli.exe' : 'interpolini-cli'
/** The Windows build published by the project (see its README). */
const WINDOWS_ZIP = 'https://github.com/Z1xus/interpolini/releases/latest/download/interpolini-windows-x86_64.zip'

/** The environment interpolini gets: ours without the variables Electron and Chromium add for themselves, so it starts like it does from a terminal. */
export function cleanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) if (!/^(ELECTRON_|CHROME_|NODE_|GOOGLE_|ORIGINAL_XDG|npm_)/i.test(k) && k !== 'VLCUT_INTERPOLINI') out[k] = v
  return out
}

async function findIn(dir: string, depth: number): Promise<string | null> {
  if (existsSync(join(dir, exe))) return join(dir, exe)
  if (depth <= 0) return null
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) {
      const found = await findIn(join(dir, entry.name), depth - 1)
      if (found) return found
    }
  }
  return null
}

/** Looks, in order, at VLCUT_INTERPOLINI, the app's own folder for it, the install folder and the PATH. */
const CHOSEN = 'interpolini-path.txt'
/** Remembers a copy of interpolini-cli the person picked by hand (for example from the official installer). */
export async function chooseInterpolini(userDir: string, file: string): Promise<InterpoliniStatus> {
  await writeFile(join(userDir, CHOSEN), file, 'utf8')
  return interpoliniStatus(userDir)
}

export async function findInterpolini(userDir: string): Promise<string | null> {
  const override = process.env.VLCUT_INTERPOLINI
  if (override && existsSync(override)) return override
  const chosen = (await readFile(join(userDir, CHOSEN), 'utf8').catch(() => '')).trim()
  if (chosen && existsSync(chosen)) return chosen
  for (const dir of [join(userDir, 'interpolini'), join(process.resourcesPath ?? '', 'interpolini')]) {
    const found = await findIn(dir, 2)
    if (found) return found
  }
  for (const base of [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (!base) continue
    const found = await findIn(join(base, 'interpolini'), 1)
    if (found) return found
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) if (dir && existsSync(join(dir, exe))) return join(dir, exe)
  return null
}

/**
 * Vulkan layers are add-ons that graphics drivers, overlays and capture tools install for every program that uses the graphics card.
 * A broken one crashes interpolini the moment it starts (exit code 0xC0000005). Starting it with them switched off avoids that.
 */
const VK_FIX: NodeJS.ProcessEnv = { VK_LOADER_LAYERS_DISABLE: '~implicit~' }
const VK_FLAG = 'interpolini-vulkan-layers-off.txt'
let layersOff = false

/** The environment interpolini is started with. */
export const interpoliniEnv = (): NodeJS.ProcessEnv => ({ ...cleanEnv(), ...(layersOff ? VK_FIX : {}) })

export async function loadVkFix(userDir: string): Promise<void> {
  layersOff = existsSync(join(userDir, VK_FLAG))
}

interface Attempt { ok: boolean; info: string; code?: number }

function attempt(path: string, env: NodeJS.ProcessEnv): Promise<Attempt> {
  return new Promise((resolve) =>
    // --help is the documented flag; the program runs from its own folder so it finds its libraries and models.
    execFile(path, ['--help'], { timeout: 20000, cwd: dirname(path), windowsHide: true, env }, (err, stdout, stderr) => {
      const text = `${stdout}\n${stderr}`.trim()
      if (!err) return resolve({ ok: true, info: text.split('\n')[0].trim() || 'ready' })
      const code = (err as { code?: unknown }).code
      // Some builds exit with a number after printing their usage: the program ran, so it works.
      if (typeof code === 'number' && /interpolini|usage|options/i.test(text)) return resolve({ ok: true, info: text.split('\n')[0].trim().slice(0, 120) })
      const why = typeof code === 'number' ? explainExit(code, null) : (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'The file is missing. Download interpolini again.' : String((err as { killed?: boolean }).killed ? 'It did not answer in time.' : err.message.split('\n')[0]).slice(0, 200)
      resolve({ ok: false, code: typeof code === 'number' ? code : undefined, info: `It could not be started. ${why} Motion blur in the export (Frame blending with Vegas weighting) works without it.${text ? ` Its own message: ${text.slice(0, 160)}` : ''}` })
    })
  )
}

/** The libraries interpolini needs next to its program (by name start). A missing one is the commonest reason it will not start. */
const NEEDED_LIBRARIES = ['avcodec-', 'avformat-', 'avutil-', 'swresample-', 'swscale-', 'open_svpflow', 'svpflow1_vs', 'svpflow2_vs', 'interpolini_rife']

export async function missingLibraries(exePath: string): Promise<string[]> {
  const names = (await readdir(dirname(exePath)).catch(() => [])).map((n) => n.toLowerCase())
  return NEEDED_LIBRARIES.filter((prefix) => !names.some((n) => n.startsWith(prefix) && n.endsWith('.dll')))
}

export async function interpoliniStatus(userDir: string): Promise<InterpoliniStatus> {
  const path = await findInterpolini(userDir)
  const canAutoInstall = process.platform === 'win32'
  if (!path) return { path: null, info: 'interpolini is not installed.', canAutoInstall }
  // Windows opens a message box and waits when a library is missing, so check the files first and say it plainly.
  if (process.platform === 'win32') {
    const missing = await missingLibraries(path)
    if (missing.length) return { path, info: `It could not be started: ${missing.map((m) => `${m.replace(/-$/, '')}*.dll`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing next to interpolini-cli.exe. Antivirus software often removes such files: check Windows Security → Protection history, restore them, then press “Install this version” to download a complete copy. Motion blur in the export (Frame blending with Vegas weighting) works without it.`, canAutoInstall }
  }
  let first = await attempt(path, cleanEnv())
  if (first.ok) {
    layersOff = false
    await rm(join(userDir, VK_FLAG), { force: true })
    return { path, info: first.info, canAutoInstall }
  }
  // A crash at start (access violation): try again without the Vulkan layers, and keep doing so if that works.
  if (first.code !== undefined && first.code !== 1) {
    const second = await attempt(path, { ...cleanEnv(), ...VK_FIX })
    if (second.ok) {
      layersOff = true
      await writeFile(join(userDir, VK_FLAG), 'on', 'utf8')
      return { path, info: `${second.info} · started with the graphics add-on layers switched off, because they crashed it`, canAutoInstall }
    }
    first = { ...first, info: `${first.info} Starting it without the graphics add-on layers did not help either.` }
  }
  return { path, info: first.info, canAutoInstall }
}

/** One-time download of the program from the project's releases (Windows). */
export async function installInterpolini(userDir: string, onProgress: (label: string, fraction: number) => void, version?: string): Promise<InterpoliniStatus> {
  if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('That version number is not valid.')
  if (process.platform !== 'win32') throw new Error('Automatic download is only available on Windows. Get interpolini from https://github.com/Z1xus/interpolini and put interpolini-cli on your PATH.')
  // An older version goes into its own folder and is remembered, so the newest copy and its models stay untouched.
  const dir = join(userDir, version ? `interpolini-${version}` : 'interpolini')
  const url = version ? `https://github.com/Z1xus/interpolini/releases/download/v${version}/interpolini-windows-x86_64.zip` : WINDOWS_ZIP
  // Everything is unpacked into a fresh folder first. A copy that is already working is replaced only when the new one is complete,
  // so a download that antivirus software cuts short can never leave half a program behind.
  const staging = `${dir}.new`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  const zip = join(staging, 'interpolini.zip')
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (chunk: Buffer) => {
    got += chunk.length
    if (total) onProgress('Downloading interpolini', got / total)
  })
  await pipeline(body, createWriteStream(`${zip}.part`))
  await rename(`${zip}.part`, zip)
  onProgress('Unpacking', 1)
  const unpackError = await new Promise<string>((resolve) => execFile('tar', ['-xf', zip, '-C', staging], (err, _o, stderr) => resolve(err ? (stderr || err.message).trim().slice(0, 300) : '')))
  await rm(zip, { force: true })
  const exePath = await findIn(staging, 2)
  const missing = exePath ? await missingLibraries(exePath) : [exe]
  if (unpackError || missing.length) {
    await rm(staging, { recursive: true, force: true })
    const what = missing.length ? ` Missing: ${missing.map((m) => (m === exe ? exe : `${m.replace(/-$/, '')}*.dll`)).join(', ')}.` : ''
    throw new Error(`The download could not be unpacked completely.${what}${unpackError ? ` Windows said: ${unpackError}` : ''} This usually means antivirus software blocked a file. In Windows Security → Virus & threat protection → Manage settings → Exclusions, add the folder ${dir}, then try again. Your previous copy (if any) was left as it was.`)
  }
  // Keep the person's own settings file when a copy is replaced.
  const oldExe = await findIn(dir, 2)
  const oldIni = oldExe ? join(dirname(oldExe), 'interpolini.ini') : ''
  if (oldIni && exePath && existsSync(oldIni)) await copyFile(oldIni, join(dirname(exePath), 'interpolini.ini')).catch(() => undefined)
  await rm(dir, { recursive: true, force: true })
  await rename(staging, dir)
  if (version) {
    const found = await findIn(dir, 2)
    if (!found) throw new Error(`The download of version ${version} did not contain ${exe}.`)
    await writeFile(join(userDir, CHOSEN), found, 'utf8')
  }
  return interpoliniStatus(userDir)
}

/**
 * Blurs one clip with interpolini and returns the path of the file it made. Progress lines are passed
 * on as they arrive. A failure is reported with interpolini's own message.
 */
export function runInterpolini(cli: string, clip: string, settings: InterpoliniSettings, blendFps: number, onProgress: (text: string) => void, onKill: (kill: () => void) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc: ChildProcessWithoutNullStreams = spawn(cli, interpoliniArgs(settings, blendFps, clip), { cwd: dirname(clip), env: interpoliniEnv(), windowsHide: true })
    onKill(() => proc.kill())
    let output: string | null = null
    let failure = ''
    let buffered = ''
    let stderr = ''
    const take = (line: string): void => {
      const e = parseInterpoliniLine(line)
      if (!e) return
      if (e.event === 'progress') onProgress(`frame ${e.frame} of ${e.frames} (${Math.round(e.fps)} fps)`)
      else if (e.event === 'preparing') onProgress(`preparing, ${Math.round(e.done * 100)}%`)
      else if (e.event === 'warning' || e.event === 'info') onProgress(e.message)
      else if (e.event === 'done') output = e.output
      else if (e.event === 'failed') failure = e.error
    }
    proc.stdout.on('data', (d: Buffer) => {
      buffered += d.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      lines.forEach(take)
    })
    proc.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-1500)))
    proc.on('error', (err) => reject(new Error(`interpolini could not be started: ${err.message}`)))
    proc.on('close', (code) => {
      take(buffered)
      // The real program reports the path as it was given to it; resolve a relative one against the clip's folder.
      if (output && !failure) return resolve(isAbsolute(output) ? output : join(dirname(clip), output))
      reject(new Error(`interpolini failed: ${failure || stderr.trim() || `${explainExit(code, null)} No file was produced.`}`))
    })
  })
}
