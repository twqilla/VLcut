import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp'
}

/**
 * Serves local files at media://local/<url-encoded absolute path>.
 * Supports byte ranges (needed for seeking) and sends a CORS header so frames
 * drawn to a canvas can be read back for export.
 */
export function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1))
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const headers = new Headers({
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    })
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
    let start = 0
    let end = size - 1
    let status = 200
    if (range) {
      if (range[1] === '') start = Math.max(0, size - Number(range[2]))
      else {
        start = Number(range[1])
        if (range[2] !== '') end = Math.min(end, Number(range[2]))
      }
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      status = 206
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    }
    headers.set('Content-Length', String(end - start + 1))
    if (size === 0) return new Response(null, { status: 200, headers })
    const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
    return new Response(stream, { status, headers })
  })
}
