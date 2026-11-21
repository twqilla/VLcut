/**
 * Runs interpolini (https://github.com/Z1xus/interpolini, GPL-3.0) for motion blur. interpolini interpolates
 * the footage to a very high frame rate with RIFE or SVP on the graphics card and blends it back down;
 * this module only finds the program, downloads it on request, runs it and reads its progress.
 */
import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { InterpoliniStatus } from '@shared/types'
import { explainExit } from '@shared/winExit'
import { type InterpoliniSettings, interpoliniArgs, parseInterpoliniLine } from '@shared/render/interpolini'

const exe = process.platform === 'win32' ? 'interpolini-cli.exe' : 'interpolini-cli'
/** The Windows build published by the project (see its README). */
const WINDOWS_ZIP = 'https://github.com/Z1xus/interpolini/releases/latest/download/interpolini-windows-x86_64.zip'

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

export async function interpoliniStatus(userDir: string): Promise<InterpoliniStatus> {
  const path = await findInterpolini(userDir)
  const canAutoInstall = process.platform === 'win32'
  if (!path) return { path: null, info: 'interpolini is not installed.', canAutoInstall }
  const info = await new Promise<string>((resolve) =>
    // --help is the documented flag; the program runs from its own folder so it finds its libraries and models.
    execFile(path, ['--help'], { timeout: 20000, cwd: dirname(path), windowsHide: true }, (err, stdout, stderr) => {
      const text = `${stdout}\n${stderr}`.trim()
      if (!err) return resolve(text.split('\n')[0].trim() || 'ready')
      // Some builds have no --version: if the program ran and printed its usage, it works.
      if (typeof (err as { code?: unknown }).code === 'number' && /interpolini|usage|options/i.test(text)) return resolve(text.split('\n')[0].trim().slice(0, 120))
      const code = (err as { code?: unknown }).code
      const why = typeof code === 'number' ? explainExit(code, null) : (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'The file is missing. Download interpolini again.' : String((err as { killed?: boolean }).killed ? 'It did not answer in time.' : err.message.split('\n')[0]).slice(0, 200)
      resolve(`It could not be started. ${why} Motion blur in the export (Frame blending with Vegas weighting) works without it.${text ? ` Its own message: ${text.slice(0, 160)}` : ''}`)
    })
  )
  return { path, info, canAutoInstall }
}

/** One-time download of the program from the project's releases (Windows). */
export async function installInterpolini(userDir: string, onProgress: (label: string, fraction: number) => void, version?: string): Promise<InterpoliniStatus> {
  if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('That version number is not valid.')
  if (process.platform !== 'win32') throw new Error('Automatic download is only available on Windows. Get interpolini from https://github.com/Z1xus/interpolini and put interpolini-cli on your PATH.')
  // An older version goes into its own folder and is remembered, so the newest copy and its models stay untouched.
  const dir = join(userDir, version ? `interpolini-${version}` : 'interpolini')
  const url = version ? `https://github.com/Z1xus/interpolini/releases/download/v${version}/interpolini-windows-x86_64.zip` : WINDOWS_ZIP
  await mkdir(dir, { recursive: true })
  const zip = join(dir, 'interpolini.zip')
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
  await new Promise<void>((resolve, reject) => execFile('tar', ['-xf', zip, '-C', dir], (err, _o, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())))
  await rm(zip, { force: true })
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
    const proc: ChildProcessWithoutNullStreams = spawn(cli, interpoliniArgs(settings, blendFps, clip), { cwd: dirname(clip) })
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
