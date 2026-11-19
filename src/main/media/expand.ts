/** Turns dropped paths into files: a dropped folder becomes the media files inside it (up to a limit, a few folders deep). */
import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/mediaTypes'

const MEDIA = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS].map((e) => `.${e}`))
export const MAX_DROPPED_FILES = 500
const MAX_DEPTH = 4

export async function expandDroppedPaths(paths: string[]): Promise<string[]> {
  const out: string[] = []
  const walk = async (path: string, depth: number): Promise<void> => {
    if (out.length >= MAX_DROPPED_FILES) return
    const info = await stat(path).catch(() => null)
    if (!info) return
    if (info.isDirectory()) {
      if (depth > MAX_DEPTH) return
      const names = (await readdir(path).catch(() => [])).filter((n) => !n.startsWith('.')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      for (const name of names) await walk(join(path, name), depth + 1)
    } else if (depth === 0 || MEDIA.has(extname(path).toLowerCase())) {
      out.push(path) // a file dropped directly is always tried (so an unreadable one gets reported); inside folders only media files are taken
    }
  }
  for (const p of paths) await walk(p, 0)
  return out
}
