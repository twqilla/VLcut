import * as motion from './analysis/motion'
import * as os from 'node:os'
import { buildReport, recordError } from './diagnostics'
import { beginSession, endSession, noteProject } from './session'
import * as tts from './audio/tts'
import { spectrum } from './audio/spectrum'
import { syncFiles } from './audio/sync'
import { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell } from 'electron'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, dirname, extname, join } from 'node:path'
import type { MediaAsset, Project } from '@shared/types'
import { ProjectStore } from './projects/projectStore'
import { probeMedia } from './media/probe'
import { toolStatus } from './media/tools'
import { thumbnail, waveform } from './media/waveform'
import { cancelExport, failRender, finishRender, pushFrame, renderJob, startExport, probeEncoders } from './render/exporter'
import type { BlurRequest, ExportSettings } from '@shared/types'
import { analyzeAsset } from './analysis/analyze'
import { ensureSfx } from './audio/sfx'
import { saveRecording } from './audio/recording'
import { expandDroppedPaths } from './media/expand'
import { ensureOverlays } from './media/overlays'
import { cancelSpeech, installSpeech, speechStatus, transcribe } from './subtitles/whisper'
import { describeImage, llmComplete, llmStatus, visionModel } from './agent/llm'
import { readFileSync } from 'node:fs'
import { copyFile, readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { makeProxy } from './media/proxy'
import { exportLossless } from './render/lossless'
import { losslessPlan } from '@shared/render/lossless'
import { IMPORT_FILTERS, VIDEO_EXTENSIONS as VIDEO_TYPES } from '@shared/mediaTypes'
import { chooseInterpolini, findInterpolini, installInterpolini, interpoliniStatus, loadVkFix, missingLibraries, resolveInterpolini } from './render/interpolini'
import { cfgFileName } from '@shared/render/interpolini'
import { blurRange } from './render/blurClip'
import { registerMediaProtocol } from './media/protocol'

// The renderer loads local media through media://, never through raw file paths.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])


let probeErrors: { name: string; message: string }[] = []

async function probeAll(paths: string[]): Promise<MediaAsset[]> {
  const results = await Promise.allSettled(paths.map(probeMedia))
  probeErrors = results.flatMap((r, i) => (r.status === 'rejected' ? [{ name: basename(paths[i]), message: String((r.reason as Error)?.message ?? r.reason).slice(0, 400) }] : []))
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
}

function registerIpc(store: ProjectStore): void {
  ipcMain.handle('projects:list', () => store.list())
  ipcMain.handle('projects:create', (_e, name: string) => store.create(name))
  ipcMain.handle('projects:load', async (_e, id: string) => {
    const project = await store.load(id)
    // Flag media that has moved or been deleted so the UI can offer relinking.
    // A proxy whose file was cleared from the cache is dropped here and rebuilt in the background.
    project.media = project.media.map((m) => ({ ...m, missing: !existsSync(m.path), proxyPath: m.proxyPath && existsSync(m.proxyPath) ? m.proxyPath : undefined }))
    return project
  })
  ipcMain.handle('projects:save', (_e, project: Project) => store.save(project))
  ipcMain.handle('projects:duplicate', (_e, id: string) => store.duplicate(id))
  ipcMain.handle('projects:remove', (_e, id: string) => store.remove(id))
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => store.rename(id, name))

  ipcMain.handle('projects:snapshot', (_e, project: Project, label: string) => store.snapshot(project, label))
  ipcMain.handle('projects:snapshots', (_e, id: string) => store.snapshots(id))
  ipcMain.handle('projects:loadSnapshot', (_e, id: string, file: string) => store.loadSnapshot(id, file))

  // Analyses run one at a time so a big import does not saturate the machine.
  let analysisQueue: Promise<unknown> = Promise.resolve()
  ipcMain.handle('analysis:analyze', (_e, asset: MediaAsset) => {
    const job = analysisQueue.then(() => analyzeAsset(asset))
    analysisQueue = job.catch(() => undefined)
    return job
  })

  const userData = app.getPath('userData')
  const speechDir = join(userData, 'whisper')
  // ---- Blurred clips: made once with interpolini, kept on disk, used like any other file ----
  const blurJobs = new Map<string, () => void>()
  ipcMain.handle('blur:render', async (e, request: BlurRequest) => {
    // The first copy that really starts (a broken one is skipped), so a damaged download never stops the export.
    const cli = (await resolveInterpolini(app.getPath('userData'))).path
    if (!cli) throw new Error('interpolini is not installed. Use "Download interpolini" in the Motion blur panel first.')
    let cancelled = false
    let kill: (() => void) | null = null
    blurJobs.set(request.jobId, () => {
      cancelled = true
      kill?.()
    })
    try {
      const path = await blurRange(request, join(app.getPath('userData'), 'blurred'), cli, (text) => e.sender.send('blur:progress', { jobId: request.jobId, text }), (k) => (kill = k))
      return { path }
    } catch (err) {
      throw new Error(cancelled ? 'Cancelled.' : (err as Error).message)
    } finally {
      blurJobs.delete(request.jobId)
    }
  })
  ipcMain.handle('blur:cancel', (_e, jobId: string) => blurJobs.get(jobId)?.())
  // ---- Saved interpolini configurations: plain .cfg files in the app's folder, editable in Notepad ----
  const cfgDir = join(userData, 'interpolini-configs')
  const cfgPath = (name: string): string => join(cfgDir, `${cfgFileName(String(name))}.cfg`)
  ipcMain.handle('cfg:list', async () => (await readdir(cfgDir).catch(() => [] as string[])).filter((f) => f.endsWith('.cfg')).map((f) => f.slice(0, -4)).sort((a, b) => a.localeCompare(b)))
  ipcMain.handle('cfg:save', async (_e, name: string, text: string) => { await mkdir(cfgDir, { recursive: true }); await writeFile(cfgPath(name), String(text).slice(0, 20000), 'utf8'); return cfgFileName(String(name)) })
  ipcMain.handle('cfg:read', (_e, name: string) => readFile(cfgPath(name), 'utf8'))
  ipcMain.handle('cfg:delete', (_e, name: string) => rm(cfgPath(name), { force: true }))
  ipcMain.handle('cfg:edit', async (_e, name: string) => {
    const file = cfgPath(name)
    if (!existsSync(file)) throw new Error('Save the configuration first.')
    // Notepad on Windows; the system's text editor elsewhere.
    if (process.platform === 'win32') spawn('notepad.exe', [file], { detached: true, stdio: 'ignore' }).unref()
    else await shell.openPath(file)
  })
  ipcMain.handle('interpolini:choose', async (e) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openFile'], filters: [{ name: 'interpolini-cli', extensions: ['exe'] }] })
    return result.canceled || !result.filePaths[0] ? interpoliniStatus(app.getPath('userData')) : chooseInterpolini(app.getPath('userData'), result.filePaths[0])
  })
  ipcMain.handle('interpolini:status', () => interpoliniStatus(app.getPath('userData')))
  ipcMain.handle('interpolini:install', (e, version?: string) => installInterpolini(app.getPath('userData'), (label, fraction) => e.sender.send('interpolini:progress', { label, fraction }), version))
  ipcMain.handle('speech:status', () => speechStatus(speechDir))
  ipcMain.handle('speech:cancel', () => cancelSpeech())
  ipcMain.handle('speech:install', (e, model: string) => installSpeech(speechDir, model, (label, fraction) => e.sender.send('speech:progress', { label, fraction })))
  ipcMain.handle('speech:transcribe', (e, path: string, model: string, language: string) => transcribe(path, speechDir, model, language, (fraction) => e.sender.send('speech:progress', { label: 'Recognising speech', fraction })))
  ipcMain.handle('media:proxy', (_e, asset: MediaAsset) => makeProxy(asset, join(userData, 'proxies')))
  ipcMain.handle('overlays:ensure', (_e, ids: string[]) => ensureOverlays(join(userData, 'overlays'), Array.isArray(ids) ? ids.filter((n) => typeof n === 'string') : []))
  ipcMain.handle('sfx:ensure', (_e, names?: string[]) => ensureSfx(join(userData, 'sfx'), Array.isArray(names) ? names.filter((n) => typeof n === 'string') : undefined))
  ipcMain.handle('llm:status', () => llmStatus())
  ipcMain.handle('vision:status', () => visionModel())
  ipcMain.handle('vision:describe', async (_e, path: string, time: number) => {
    const jpeg = await thumbnail(path, time, join(userData, 'cache', 'thumbnails'), 336)
    return describeImage(jpeg.slice(jpeg.indexOf(',') + 1))
  })
  ipcMain.handle('llm:complete', (_e, prompt: string) => llmComplete(prompt))

  ipcMain.handle('files:saveText', async (e, defaultName: string, text: string) => {
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, { defaultPath: join(app.getPath('documents'), defaultName) })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, text, 'utf8')
    return result.filePath
  })
  ipcMain.handle('files:openText', async (e, extensions: string[]) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openFile'], filters: [{ name: 'Files', extensions }] })
    return result.canceled ? null : readFile(result.filePaths[0], 'utf8')
  })

  const storageDirs: Record<string, { path: string; clearable: boolean }> = {
    Projects: { path: join(userData, 'projects'), clearable: false },
    'Preview copies (proxies)': { path: join(userData, 'proxies'), clearable: true },
    'Blurred clips': { path: join(userData, 'blurred'), clearable: false },
    Waveforms: { path: join(userData, 'cache', 'waveforms'), clearable: true },
    Thumbnails: { path: join(userData, 'cache', 'thumbnails'), clearable: true },
    'Speech recognition': { path: speechDir, clearable: true },
    'Sound effects': { path: join(userData, 'sfx'), clearable: true },
    'Overlays': { path: join(userData, 'overlays'), clearable: true },
    'Nested clips': { path: join(userData, 'nested'), clearable: false },
    'Voice recordings': { path: join(userData, 'recordings'), clearable: false }
  }
  const dirSize = async (dir: string): Promise<number> => {
    let total = 0
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = join(dir, entry.name)
      total += entry.isDirectory() ? await dirSize(full) : (await stat(full).catch(() => ({ size: 0 }))).size
    }
    return total
  }
  ipcMain.handle('storage:usage', async () => Promise.all(Object.entries(storageDirs).map(async ([name, d]) => ({ name, bytes: await dirSize(d.path), clearable: d.clearable }))))
  ipcMain.handle('storage:clear', async (_e, name: string) => {
    const d = storageDirs[name]
    if (d?.clearable) await rm(d.path, { recursive: true, force: true })
  })
  ipcMain.on('storage:open', () => void shell.openPath(userData))

  // ---- Clips browser: a folder of recordings that can be opened and trimmed without a project ----
  const settingsFile = join(userData, 'settings.json')
  const readSettings = async (): Promise<Record<string, string>> => {
    try {
      return JSON.parse(await readFile(settingsFile, 'utf8')) as Record<string, string>
    } catch {
      return {}
    }
  }
  const VIDEO_EXTENSIONS = new Set(VIDEO_TYPES.map((e) => `.${e}`))
  ipcMain.handle('clips:getFolder', async () => (await readSettings()).clipsFolder ?? null)
  ipcMain.handle('clips:pickFolder', async (e) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    await writeFile(settingsFile, JSON.stringify({ ...(await readSettings()), clipsFolder: result.filePaths[0] }), 'utf8')
    return result.filePaths[0]
  })
  ipcMain.handle('clips:list', async (_e, folder: string) => {
    // Includes subfolders (four levels deep, skipping hidden ones and the export parts folders).
    const found: { path: string; name: string; folder: string }[] = []
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (found.length >= 3000 || entry.name.startsWith('.')) continue
        if (entry.isDirectory()) {
          if (depth < 4 && !entry.name.endsWith('.parts')) await walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name, depth + 1)
        } else if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) found.push({ path: join(dir, entry.name), name: entry.name, folder: rel })
      }
    }
    await walk(folder, '', 0)
    const files = await Promise.all(found.map(async (f) => {
      const info = await stat(f.path)
      return { ...f, sizeBytes: info.size, modified: info.mtime.toISOString() }
    }))
    return files.sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 500)
  })
  ipcMain.handle('clips:trim', async (_e, path: string, start: number, duration: number) => {
    // Saved beside the original as "<name> trim.mp4", numbered if that exists. The original is never changed.
    const ext = extname(path).toLowerCase() === '.mov' ? '.mov' : '.mp4'
    const base = join(dirname(path), basename(path, extname(path)))
    let out = `${base} trim${ext}`
    for (let n = 2; existsSync(out); n++) out = `${base} trim ${n}${ext}`
    await exportLossless([{ path, start, duration }], out)
    return out
  })

  ipcMain.handle('audio:sync', (_e, a: string, b: string) => syncFiles(String(a), String(b)))
  ipcMain.handle('audio:spectrum', (_e, path: string) => spectrum(String(path)))

  // ---- Text to speech ----
  const LEGAL_FILES = new Set(['LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'FONT_LICENSES.txt', 'ffmpeg-version.txt'])
  ipcMain.handle('legal:read', async (_e, name: string) => {
    if (!LEGAL_FILES.has(name)) return ''
    const dir = app.isPackaged ? join(process.resourcesPath, 'legal') : join(app.getAppPath(), 'resources', 'legal')
    return readFile(join(dir, name), 'utf8').catch(() => '')
  })
  ipcMain.handle('window:toggleFullscreen', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (!w) return false; w.setFullScreen(!w.isFullScreen()); return w.isFullScreen() })
  ipcMain.handle('window:state', (e) => ({ fullscreen: BrowserWindow.fromWebContents(e.sender)?.isFullScreen() ?? false, startFullscreen: readWindowPrefs().startFullscreen }))
  ipcMain.handle('window:setStartFullscreen', async (_e, on: boolean) => { await writeFile(windowPrefsFile(), JSON.stringify({ startFullscreen: on === true })) })
  ipcMain.handle('legal:version', () => app.getVersion())
  ipcMain.handle('nest:path', async () => { const dir = join(userData, 'nested'); await mkdir(dir, { recursive: true }); return join(dir, `nested-${Date.now()}.mp4`) })
  ipcMain.handle('recording:save', (_e, data: ArrayBuffer | Uint8Array, number: number) => saveRecording(join(userData, 'recordings'), new Uint8Array(data), Number(number) || 1))
  ipcMain.handle('tts:voices', () => tts.listVoices())
  ipcMain.handle('tts:speak', (_e, text: string, voice: string | undefined, rate: number) => tts.speak(join(userData, 'speech'), String(text), voice, Number(rate) || 0))

  // ---- Diagnostics ----
  ipcMain.on('diagnostics:log', (_e, source: string, message: string) => recordError(String(source), String(message)))
  process.on('uncaughtException', (err) => recordError('main', err?.stack ?? String(err)))
  ipcMain.handle('diagnostics:collect', async (_e, settings: { theme?: string; mods?: string[] }) => {
    const tools = await toolStatus()
    const gpu = Object.fromEntries(Object.entries(app.getGPUFeatureStatus()).map(([k, v]) => [k, String(v)]))
    // interpolini: where it is, whether it starts, and which libraries next to it are missing (names only).
    const ip = await findInterpolini(app.getPath('userData')).catch(() => null)
    const interpoliniLine = ip ? `found (${ip.split(/[\\/]/).slice(-3, -1).join(' > ')}); ${(await interpoliniStatus(app.getPath('userData')).catch((e: Error) => ({ info: e.message }))).info.slice(0, 220)}; missing libraries: ${(await missingLibraries(ip)).join(', ') || 'none'}` : 'not installed'
    return buildReport({
      interpolini: interpoliniLine,
      appVersion: app.getVersion(), versions: process.versions as Record<string, string>, platform: process.platform, arch: process.arch, osRelease: os.release(), memoryGb: os.totalmem() / 1024 ** 3, cpuCount: os.cpus().length, gpu,
      ffmpeg: tools.ffmpeg ? tools.ffmpegInfo : `not working: ${tools.ffmpegInfo}`, ffprobe: tools.ffprobe ? 'ok' : 'not working',
      uncleanLastRun: startupSession.unclean, settings: { theme: String(settings?.theme ?? ''), mods: Array.isArray(settings?.mods) ? settings.mods.map(String) : [] }, home: os.homedir(), user: os.userInfo().username
    })
  })

  // ---- Crash recovery ----
  const startupSession = beginSession(userData)
  ipcMain.handle('session:state', () => startupSession)
  ipcMain.handle('session:open', (_e, project: { id: string; name: string } | null) => noteProject(userData, project && typeof project.id === 'string' ? { id: project.id, name: String(project.name ?? '') } : null))
  app.on('will-quit', () => endSession(userData))

  // ---- Motion analysis ----
  ipcMain.handle('motion:stabilize', (_e, req) => motion.stabilize(req))
  ipcMain.handle('motion:track', (_e, req) => motion.track(req))
  ipcMain.handle('motion:focus', (_e, req) => motion.focus(req))

  // ---- Custom fonts ----
  const fontsDir = join(userData, 'fonts')
  const listFonts = async (): Promise<{ name: string; path: string }[]> =>
    (await readdir(fontsDir).catch(() => [] as string[])).filter((f) => /\.(ttf|otf|woff2?)$/i.test(f)).map((f) => ({ name: basename(f, extname(f)).replace(/[-_]+/g, ' '), path: join(fontsDir, f) }))
  ipcMain.handle('fonts:list', listFonts)
  ipcMain.handle('fonts:import', async (e) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }] })
    if (!result.canceled) {
      await mkdir(fontsDir, { recursive: true })
      for (const file of result.filePaths) await copyFile(file, join(fontsDir, basename(file)))
    }
    return listFonts()
  })

  const stylesDir = join(userData, 'styles')
  const styleFile = (id: string): string => join(stylesDir, `${id.replace(/[^\w-]/g, '')}.json`)
  ipcMain.handle('styles:list', async () => {
    try {
      const files = (await readdir(stylesDir)).filter((f) => f.endsWith('.json'))
      return await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(stylesDir, f), 'utf8')) as unknown))
    } catch {
      return []
    }
  })
  ipcMain.handle('styles:save', async (_e, style: { id: string }) => {
    await mkdir(stylesDir, { recursive: true })
    await writeFile(styleFile(style.id), JSON.stringify(style, null, 2), 'utf8')
  })
  ipcMain.handle('styles:remove', (_e, id: string) => rm(styleFile(id), { force: true }))

  ipcMain.handle('projects:prepFor', (_e, id: string) => store.prepFor(id))

  // ---- Split view: the main project on the left half of the screen, its clip-prep workspace on the right ----
  const prepWindows = new Map<number, BrowserWindow>() // main window id -> prep window
  ipcMain.handle('split:open', (e, prepProjectId: string) => {
    const mainWin = BrowserWindow.fromWebContents(e.sender)!
    const area = screen.getDisplayMatching(mainWin.getBounds()).workArea
    const half = Math.floor(area.width / 2)
    let prep = prepWindows.get(mainWin.id)
    if (!prep || prep.isDestroyed()) {
      prep = new BrowserWindow({ backgroundColor: '#060912', autoHideMenuBar: true, minWidth: 480, minHeight: 400, webPreferences: { preload: PRELOAD, sandbox: false } })
      prepWindows.set(mainWin.id, prep)
      const mainId = mainWin.id
      prep.on('closed', () => prepWindows.delete(mainId))
      loadRenderer(prep, `project=${encodeURIComponent(prepProjectId)}&prep=1`)
    }
    if (mainWin.isMaximized()) mainWin.unmaximize()
    mainWin.setMinimumSize(480, 400)
    mainWin.setBounds({ x: area.x, y: area.y, width: half, height: area.height })
    prep.setBounds({ x: area.x + half, y: area.y, width: area.width - half, height: area.height })
    prep.show()
  })
  /** The other half of a split view: main window to its prep window, or prep window to its main window. */
  const partnerOf = (from: BrowserWindow | null): BrowserWindow | undefined => {
    if (!from) return undefined
    let target = prepWindows.get(from.id)
    if (!target) {
      const mainId = [...prepWindows.entries()].find(([, w]) => w === from)?.[0]
      target = mainId === undefined ? undefined : BrowserWindow.fromId(mainId) ?? undefined
    }
    return target && !target.isDestroyed() ? target : undefined
  }
  /** Converts a point in one window's page to the partner window's page, if it lies over that window. */
  const overPartner = (from: BrowserWindow | null, clientX: number, clientY: number): { partner: BrowserWindow; at: { x: number; y: number } } | null => {
    const partner = partnerOf(from)
    if (!from || !partner) return null
    const a = from.getContentBounds()
    const b = partner.getContentBounds()
    const at = { x: a.x + clientX - b.x, y: a.y + clientY - b.y }
    return at.x >= 0 && at.y >= 0 && at.x < b.width && at.y < b.height ? { partner, at } : null
  }
  ipcMain.handle('split:send', (e, items: unknown) => {
    const target = partnerOf(BrowserWindow.fromWebContents(e.sender))
    if (!target) return false
    target.webContents.send('split:receive', items)
    return true
  })
  ipcMain.handle('split:dropAt', (e, items: unknown, clientX: number, clientY: number) => {
    const hit = overPartner(BrowserWindow.fromWebContents(e.sender), clientX, clientY)
    if (!hit) return false
    hit.partner.webContents.send('split:hover', null)
    hit.partner.webContents.send('split:receive', items, hit.at)
    return true
  })
  ipcMain.on('split:hover', (e, clientX: number | null, clientY: number | null) => {
    const from = BrowserWindow.fromWebContents(e.sender)
    const partner = partnerOf(from)
    if (!partner) return
    const hit = clientX === null || clientY === null ? null : overPartner(from, clientX, clientY)
    partner.webContents.send('split:hover', hit ? hit.at : null)
  })

  ipcMain.handle('media:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: IMPORT_FILTERS, defaultPath: app.getPath('videos') })
    return result.canceled ? [] : probeAll(result.filePaths)
  })
  ipcMain.handle('media:probe', async (_e, paths: string[]) => probeAll(await expandDroppedPaths((Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string'))))
  ipcMain.handle('media:takeErrors', () => {
    const errors = probeErrors
    probeErrors = []
    return errors
  })
  ipcMain.handle('media:waveform', (_e, path: string) => waveform(path, join(app.getPath('userData'), 'cache', 'waveforms')))
  ipcMain.handle('media:thumbnail', (_e, path: string, time: number) => thumbnail(path, time, join(app.getPath('userData'), 'cache', 'thumbnails')))
  ipcMain.handle('system:tools', () => toolStatus())
  ipcMain.on('system:showInFolder', (_e, path: string) => shell.showItemInFolder(path))

  ipcMain.handle('export:pickPath', async (e, defaultName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const result = await dialog.showSaveDialog(win, {
      defaultPath: join(app.getPath('videos'), defaultName),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }, { name: 'QuickTime movie', extensions: ['mov'] }]
    })
    return result.canceled || !result.filePath ? null : result.filePath
  })
  // Which video encoders really work here (NVENC needs an NVIDIA card and driver): each is tried on a tiny test picture.
  let encoderProbe: Promise<Record<string, { ok: boolean; reason: string }>> | null = null
  ipcMain.handle('export:encoders', () => (encoderProbe ??= probeEncoders()))
  ipcMain.handle('export:start', async (e, project: Project, settings: ExportSettings) => startExport(e.sender, project, settings, PRELOAD, loadRenderer, await findInterpolini(join(app.getPath('userData')))))
  ipcMain.handle('export:lossless', async (_e, project: Project, outputPath: string) => {
    const plan = losslessPlan(project)
    if (!plan.ok) throw new Error(`Cannot export without re-encoding: ${plan.reason}.`)
    const started = Date.now()
    await exportLossless(plan.segments, outputPath, plan.dropAudio)
    return (Date.now() - started) / 1000
  })
  ipcMain.handle('export:cancel', (_e, jobId: string) => cancelExport(jobId))
  ipcMain.handle('render:job', (_e, jobId: string) => renderJob(jobId))
  ipcMain.handle('render:frame', (_e, jobId: string, frame: number, pixels: ArrayBuffer) => pushFrame(jobId, frame, pixels))
  ipcMain.handle('render:finish', (_e, jobId: string) => finishRender(jobId))
  ipcMain.handle('render:fail', (_e, jobId: string, message: string) => failRender(jobId, message))
}

const PRELOAD = join(__dirname, '../preload/index.js')

function loadRenderer(win: BrowserWindow, query = ''): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query ? `?${query}` : ''}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), query ? { search: query } : undefined)
}

/** Window choices that must be known before the window opens, kept in a tiny file in the app's data folder. */
const windowPrefsFile = (): string => join(app.getPath('userData'), 'window.json')
function readWindowPrefs(): { startFullscreen: boolean } {
  try { return { startFullscreen: JSON.parse(readFileSync(windowPrefsFile(), 'utf8')).startFullscreen === true } } catch { return { startFullscreen: false } }
}

function createWindow(): void {
  const prefs = readWindowPrefs()
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#060912',
    show: false,
    autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: { preload: PRELOAD, sandbox: false }
  })
  // The editor fills the screen: maximised by default, true full screen when asked for (F11 or the button).
  win.once('ready-to-show', () => { if (prefs.startFullscreen) win.setFullScreen(true); else win.maximize(); win.show() })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { event.preventDefault(); win.setFullScreen(!win.isFullScreen()) }
  })
  // Only what the editor needs: the microphone (audio only, for voice-over recording), full screen and copying. Everything else stays denied.
  const allowed = (permission: string, details?: { mediaTypes?: string[] }): boolean =>
    permission === 'fullscreen' || permission === 'clipboard-sanitized-write' || (permission === 'media' && Boolean(details?.mediaTypes?.length) && details!.mediaTypes!.every((t) => t === 'audio'))
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowed(permission, details as { mediaTypes?: string[] })))
  win.webContents.session.setPermissionCheckHandler((_wc, permission, _origin, details) => allowed(permission, { mediaTypes: [(details as { mediaType?: string }).mediaType ?? ''].filter(Boolean) }) || permission === 'media')
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => {
    // Closing the editor also closes any hidden render windows.
    for (const other of BrowserWindow.getAllWindows()) other.close()
  })
  loadRenderer(win)
}

/** The window icon: the installed copy next to the app, or the one in the source tree while developing. */
function appIcon(): string | undefined {
  const candidates = [join(process.resourcesPath ?? '', 'icon.png'), join(__dirname, '../../resources/icon.png')]
  return candidates.find((c) => existsSync(c))
}


void app.whenReady().then(() => {
  registerMediaProtocol()
  registerIpc(new ProjectStore(join(app.getPath('userData'), 'projects')))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
