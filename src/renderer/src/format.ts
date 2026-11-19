export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** URL the renderer uses to load a local media file through the media:// protocol. */
export function mediaUrl(path: string): string {
  return `media://local/${encodeURIComponent(path)}`
}

/** mm:ss:ff timecode. */
export function formatTimecode(seconds: number, fps: number): string {
  const frames = Math.round(Math.max(0, seconds) * fps)
  const ff = frames % Math.round(fps)
  const total = Math.floor(frames / Math.round(fps))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:${String(ff).padStart(2, '0')}`
}
