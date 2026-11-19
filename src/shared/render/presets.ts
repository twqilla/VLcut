/** One-click export settings for the places people publish to. */
import type { ExportSettings } from '../types'

export interface ExportPreset {
  id: string
  name: string
  group: 'Video sites' | 'Social' | 'Sharing' | 'Archive'
  /** Short side of the frame in pixels, and the shape the site expects (width / height). */
  short: number
  aspect: number | null
  codec: ExportSettings['codec']
  crf: number
  audioKbps: number
  normalize: boolean
  /** Highest frame rate the site keeps; footage above it is exported at this rate. */
  maxFps?: number
  note: string
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'youtube-1080', name: 'YouTube 1080p', group: 'Video sites', short: 1080, aspect: 16 / 9, codec: 'h264', crf: 18, audioKbps: 192, normalize: true, maxFps: 60, note: 'Widescreen, high quality, loudness set for YouTube.' },
  { id: 'youtube-4k', name: 'YouTube 4K', group: 'Video sites', short: 2160, aspect: 16 / 9, codec: 'h264', crf: 17, audioKbps: 256, normalize: true, maxFps: 60, note: 'Ultra HD. Slow to render and large.' },
  { id: 'tiktok', name: 'TikTok / Reels / Shorts', group: 'Social', short: 1080, aspect: 9 / 16, codec: 'h264', crf: 20, audioKbps: 192, normalize: true, maxFps: 60, note: 'Vertical 1080 × 1920.' },
  { id: 'instagram-square', name: 'Instagram square', group: 'Social', short: 1080, aspect: 1, codec: 'h264', crf: 20, audioKbps: 192, normalize: true, maxFps: 30, note: '1080 × 1080.' },
  { id: 'instagram-portrait', name: 'Instagram portrait 4:5', group: 'Social', short: 1080, aspect: 4 / 5, codec: 'h264', crf: 20, audioKbps: 192, normalize: true, maxFps: 30, note: '1080 × 1350.' },
  { id: 'x', name: 'X / Twitter', group: 'Social', short: 720, aspect: 16 / 9, codec: 'h264', crf: 23, audioKbps: 128, normalize: true, maxFps: 60, note: '720p, moderate size.' },
  { id: 'discord', name: 'Small file for chat', group: 'Sharing', short: 720, aspect: null, codec: 'h264', crf: 29, audioKbps: 96, normalize: false, maxFps: 30, note: 'Small enough for most chat apps.' },
  { id: 'web-480', name: 'Quick preview 480p', group: 'Sharing', short: 480, aspect: null, codec: 'h264', crf: 28, audioKbps: 96, normalize: false, maxFps: 30, note: 'Fast to render and to send for feedback.' },
  { id: 'master', name: 'Archive master (H.265)', group: 'Archive', short: 2160, aspect: null, codec: 'h265', crf: 16, audioKbps: 320, normalize: false, note: 'Best quality, smaller than H.264 at the same quality.' }
]

const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2)

/** Export settings for a preset, given the project's shape and frame rate. Other fields keep their current values. */
export function applyPreset(preset: ExportPreset, project: { width: number; height: number; fps: number }, base: ExportSettings): ExportSettings {
  const aspect = preset.aspect ?? project.width / project.height
  const [width, height] = aspect >= 1 ? [even(preset.short * aspect), even(preset.short)] : [even(preset.short), even(preset.short / aspect)]
  return {
    ...base,
    width,
    height,
    fps: preset.maxFps ? Math.min(project.fps, preset.maxFps) : project.fps,
    codec: preset.codec,
    crf: preset.crf,
    videoBitrateKbps: undefined,
    audioBitrateKbps: preset.audioKbps,
    normalizeAudio: preset.normalize
  }
}

/** True when the preset's shape differs from the project's, so the picture will sit inside the frame with bars. */
export function shapeMismatch(preset: ExportPreset, project: { width: number; height: number }): boolean {
  return preset.aspect !== null && Math.abs(preset.aspect - project.width / project.height) > 0.02
}

/** `film.mp4` + a preset becomes `film - YouTube 1080p.mp4`, safe on every file system. */
export function presetFileName(basePath: string, preset: ExportPreset): string {
  const m = /^(.*?)([^\\/]*?)(\.[A-Za-z0-9]+)?$/.exec(basePath)!
  const [dir, stem] = [m[1], m[2] || 'export']
  const safe = preset.name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()
  return `${dir}${stem} - ${safe}.mp4`
}
