import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MediaAsset, MediaKind } from '@shared/types'
import { toolPath } from './tools'

import { IMAGE_EXTENSIONS as IMAGE_TYPES } from '@shared/mediaTypes'

const IMAGE_EXTENSIONS = new Set(IMAGE_TYPES.map((e) => `.${e}`))

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  disposition?: { attached_pic?: number }
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

function ffprobe(path: string): Promise<FfprobeOutput> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]
  return new Promise((resolve, reject) => {
    execFile(toolPath('ffprobe'), args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message))
      try {
        resolve(JSON.parse(stdout) as FfprobeOutput)
      } catch (parseError) {
        reject(parseError as Error)
      }
    })
  })
}

/** Parses ffprobe's "30000/1001" style rates. */
export function parseRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined
  const [num, den = '1'] = rate.split('/')
  const value = Number(num) / Number(den)
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : undefined
}

/** Reads a file's metadata with ffprobe. Throws if it is not usable media. */
export async function probeMedia(path: string): Promise<MediaAsset> {
  const [info, fileStat] = await Promise.all([ffprobe(path), stat(path)])
  const streams = info.streams ?? []
  // Cover art embedded in an MP3 shows up as a video stream; it is not one.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.find((s) => s.codec_type === 'audio')
  if (!video && !audio) throw new Error('No video or audio found in this file')

  let kind: MediaKind = video ? 'video' : 'audio'
  if (video && IMAGE_EXTENSIONS.has(extname(path).toLowerCase()) && !audio) kind = 'image'

  return {
    id: randomUUID(),
    path,
    name: basename(path),
    kind,
    duration: kind === 'image' ? 0 : Number(info.format?.duration ?? 0) || 0,
    width: video?.width,
    height: video?.height,
    fps: kind === 'video' ? parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate) : undefined,
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    sizeBytes: fileStat.size
  }
}
