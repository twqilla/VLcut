/** A plain-text report of the app's environment and recent errors, for pasting into a bug report. Never contains project content. */

const MAX_ERRORS = 40
const errors: { at: string; source: string; message: string }[] = []

export function recordError(source: string, message: string): void {
  errors.push({ at: new Date().toISOString(), source: String(source).slice(0, 20), message: String(message).slice(0, 600) })
  if (errors.length > MAX_ERRORS) errors.shift()
}

/** Removes the person's home folder and user name from a line of text, so a report is safe to share. */
export function redact(text: string, home: string, user: string): string {
  let out = text
  const variants = [home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')].filter((h) => h.length > 3)
  for (const h of variants) out = out.split(h).join('~')
  if (user.length > 2) out = out.replace(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '<user>')
  // Whole paths (absolute, or starting with the ~ that replaced the home folder) keep only their last two parts.
  const shorten = (path: string): string => {
    const parts = path.split(/[\\/]/).filter((p) => p && p !== '~')
    const last = parts[parts.length - 1] ?? ''
    // Program files (the app's own scripts) keep their name, which helps find bugs; anything else could be personal, so only its type is kept.
    if (/(^|[\\/])(out|app\.asar|resources)([\\/]|$)/.test(path) || /\.(js|mjs|cjs|map)$/.test(last)) return `…/${last}`
    const ext = /\.[A-Za-z0-9]{1,5}$/.exec(last)?.[0] ?? ''
    return `…/<file>${ext}`
  }
  return out.replace(/(?:[A-Za-z]:[\\/]|~[\\/]|\/)[^\s"'()<>|]*/g, (m) => shorten(m))
}

export interface DiagnosticsInput {
  appVersion: string
  versions: Record<string, string>
  platform: string
  arch: string
  osRelease: string
  memoryGb: number
  cpuCount: number
  gpu: Record<string, string>
  ffmpeg: string
  ffprobe: string
  uncleanLastRun: boolean
  settings: { theme: string; mods: string[] }
  home: string
  user: string
}

export function buildReport(i: DiagnosticsInput): string {
  const lines = [
    `VLcut ${i.appVersion}`,
    `System: ${i.platform} ${i.arch} (${i.osRelease}), ${i.cpuCount} CPU threads, ${i.memoryGb.toFixed(1)} GB memory`,
    `Electron ${i.versions.electron ?? '?'}, Chrome ${i.versions.chrome ?? '?'}, Node ${i.versions.node ?? '?'}`,
    `Graphics: ${Object.entries(i.gpu).map(([k, v]) => `${k}=${v}`).join(', ') || 'unknown'}`,
    `FFmpeg: ${i.ffmpeg}`,
    `FFprobe: ${i.ffprobe}`,
    `Previous run ended badly: ${i.uncleanLastRun ? 'yes' : 'no'}`,
    `Interface: theme ${i.settings.theme}, styles ${i.settings.mods.join('+') || 'none'}`,
    '',
    `Recent errors (${errors.length}):`,
    ...(errors.length ? errors.map((e) => `[${e.at}] ${e.source}: ${e.message}`) : ['none'])
  ]
  return redact(lines.join('\n'), i.home, i.user)
}

export function resetErrors(): void {
  errors.length = 0
}
