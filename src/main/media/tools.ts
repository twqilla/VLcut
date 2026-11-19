import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolStatus } from '@shared/types'

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name)

/**
 * Finds an FFmpeg tool: first a copy bundled with the installed app
 * (`resources/bin`), then whatever is on the PATH.
 */
export function toolPath(name: 'ffmpeg' | 'ffprobe'): string {
  const bundled = join(process.resourcesPath ?? '', 'bin', exe(name))
  return existsSync(bundled) ? bundled : exe(name)
}

/** Runs `<tool> -version`; returns its first line, or the reason it could not run. */
function check(path: string): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) =>
    execFile(path, ['-version'], { timeout: 15000 }, (err, stdout, stderr) =>
      resolve(err ? { ok: false, text: `${err.message}${stderr ? ` ${stderr.trim().slice(0, 200)}` : ''}` } : { ok: true, text: stdout.split('\n')[0].trim() })
    )
  )
}

export async function toolStatus(): Promise<ToolStatus> {
  const [ffmpeg, ffprobe] = [toolPath('ffmpeg'), toolPath('ffprobe')]
  const [a, b] = await Promise.all([check(ffmpeg), check(ffprobe)])
  return {
    ffmpeg: a.ok ? ffmpeg : null,
    ffprobe: b.ok ? ffprobe : null,
    ffmpegInfo: a.text,
    ffprobeInfo: b.text,
    resourcesPath: process.resourcesPath ?? ''
  }
}
