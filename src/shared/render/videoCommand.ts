/**
 * The video-encoding part of an export as FFmpeg arguments, the way HandBrake's advanced box shows it:
 * the settings write a command, the person may edit it, and later setting changes update only the
 * parts they own while the person's own additions and edits stay.
 */
import type { ExportSettings } from '../types'

/** The encoder arguments the export settings stand for. */
export function generatedVideoArgs(s: ExportSettings): string[] {
  const gpu = s.encoder === 'nvenc'
  const video = s.codec === 'h265' ? ['-c:v', gpu ? 'hevc_nvenc' : 'libx265', '-tag:v', 'hvc1'] : ['-c:v', gpu ? 'h264_nvenc' : 'libx264', '-profile:v', 'high']
  const kbps = s.videoBitrateKbps ? Math.max(100, Math.min(400000, Math.round(s.videoBitrateKbps))) : 0
  const rate = kbps
    ? ['-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`, ...(gpu ? ['-rc', 'vbr'] : [])]
    : gpu ? ['-rc', 'vbr', '-cq', String(s.crf), '-b:v', '0'] : ['-crf', String(s.crf)]
  // NVENC has its own preset names (p1 fastest, p7 best); p5 is a good balance for finished files.
  const preset = gpu ? ['-preset', 'p5', '-tune', 'hq'] : ['-preset', 'fast']
  return [...video, ...rate, ...preset, '-pix_fmt', 'yuv420p', '-r', String(s.fps)]
}

/** Splits a command into arguments. Single or double quotes keep a value with spaces together. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** Writes arguments as one line, quoting a value that has spaces. */
export const formatCommand = (args: string[]): string => args.map((a) => (/\s/.test(a) || a === '' ? `"${a}"` : a)).join(' ')

export interface Param { flag: string; value?: string }

/** Groups arguments into flags with their value (a negative number after a flag is its value). */
export function toParams(args: string[]): Param[] {
  const params: Param[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const next = args[i + 1]
    if (a.startsWith('-') && !/^-\d/.test(a)) {
      if (next !== undefined && (!next.startsWith('-') || /^-\d/.test(next))) { params.push({ flag: a, value: next }); i++ } else params.push({ flag: a })
    } else params.push({ flag: a }) // a stray value: kept so the person sees it (the check below reports it)
  }
  return params
}
const flatten = (params: Param[]): string[] => params.flatMap((p) => (p.value === undefined ? [p.flag] : [p.flag, p.value]))

/**
 * Brings the person's command up to date with new settings. A flag the settings still own and the person
 * did not touch takes its new value; a flag the person changed keeps their value; flags the person added stay;
 * a flag the person deleted stays deleted.
 */
export function mergeCommand(current: string, before: string[], now: string[]): string {
  const prev = new Map(toParams(before).map((p) => [p.flag, p.value]))
  const fresh = new Map(toParams(now).map((p) => [p.flag, p.value]))
  const mine = toParams(tokenize(current))
  const kept: Param[] = []
  const seen = new Set<string>()
  for (const p of mine) {
    seen.add(p.flag)
    if (prev.has(p.flag) && p.value === prev.get(p.flag)) {
      if (fresh.has(p.flag)) kept.push({ flag: p.flag, value: fresh.get(p.flag) }) // generated and untouched: follows the settings
    } else kept.push(p) // edited or added by the person
  }
  for (const p of toParams(now)) if (!seen.has(p.flag) && !prev.has(p.flag)) kept.push(p) // a setting that just started to write a flag
  return formatCommand(flatten(kept))
}

/** For each parameter in the command: does the settings' own command write it exactly like this? */
export function classify(current: string, generated: string[]): { text: string; manual: boolean }[] {
  const gen = new Map(toParams(generated).map((p) => [p.flag, p.value]))
  return toParams(tokenize(current)).map((p) => ({ text: formatCommand(flatten([p])), manual: !gen.has(p.flag) || gen.get(p.flag) !== p.value }))
}

/** Arguments that would break the export (the frames come in on stdin and go out to a part file). */
const FORBIDDEN = new Set(['-i', '-f', '-y', '-n', '-map', '-filter_complex', '-lavfi', '-an', '-vn', '-ss', '-t', '-to', '-s', '-vframes', '-frames:v', '-frames'])

export function checkCommand(text: string): { ok: true; args: string[] } | { ok: false; error: string } {
  const args = tokenize(text)
  if (!args.length) return { ok: false, error: 'The command is empty.' }
  const params = toParams(args)
  const stray = params.find((p) => !p.flag.startsWith('-') || /^-\d/.test(p.flag))
  if (stray) return { ok: false, error: `“${stray.flag}” has no flag in front of it. Every value needs a flag such as -crf 18.` }
  const bad = params.find((p) => FORBIDDEN.has(p.flag))
  if (bad) return { ok: false, error: `${bad.flag} is set by VLcut (pictures come in, one part file goes out) and cannot be changed here.` }
  if (!params.some((p) => p.flag === '-c:v' || p.flag === '-vcodec' || p.flag === '-codec:v')) return { ok: false, error: 'Add an encoder, for example -c:v libx264.' }
  return { ok: true, args }
}
