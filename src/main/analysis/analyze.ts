/** Measures a media file with FFmpeg: silences, scene cuts, motion, colour, loudness, beats. */
import { spawn } from 'node:child_process'
import type { Analysis, MediaAsset, TimeRange } from '@shared/types'
import { detectBeats } from '@shared/analysis/beats'
import { BAND_FILTER, SNARE_RATE, detectSnares, splitBands } from '@shared/analysis/snares'
import { type FrameStat, buildShots, dHash } from '@shared/analysis/shots'
import { describeCamera, estimateCameraMotion } from '@shared/analysis/camera'
import { toolPath } from '../media/tools'

interface RunResult {
  stdout: Buffer
  stderr: string
}

function ffmpeg(args: string[], collectStdout = false): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(toolPath('ffmpeg'), ['-hide_banner', '-nostdin', ...args])
    const out: Buffer[] = []
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => collectStdout && out.push(d))
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve({ stdout: Buffer.concat(out), stderr }) : reject(new Error(stderr.slice(-600) || `ffmpeg exited with code ${code}`))))
  })
}

export function parseSilences(log: string, duration: number): TimeRange[] {
  const ranges: TimeRange[] = []
  let start: number | null = null
  for (const m of log.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') start = Math.max(0, Number(m[2]))
    else if (start !== null) {
      ranges.push({ start, end: Number(m[2]) })
      start = null
    }
  }
  if (start !== null && duration > start) ranges.push({ start, end: duration })
  return ranges
}

export function parseFrameStats(text: string): FrameStat[] {
  const stats: FrameStat[] = []
  let cur: Partial<FrameStat> | null = null
  for (const line of text.split('\n')) {
    const frame = /pts_time:([\d.]+)/.exec(line)
    if (frame) {
      if (cur?.t !== undefined) stats.push({ yavg: 0, satavg: 0, ydif: 0, ...cur } as FrameStat)
      cur = { t: Number(frame[1]) }
      continue
    }
    const kv = /lavfi\.signalstats\.(YAVG|SATAVG|YDIF)=([\d.]+)/.exec(line)
    if (kv && cur) cur[kv[1].toLowerCase() as 'yavg' | 'satavg' | 'ydif'] = Number(kv[2])
  }
  if (cur?.t !== undefined) stats.push({ yavg: 0, satavg: 0, ydif: 0, ...cur } as FrameStat)
  return stats
}

async function audioPass(path: string, duration: number): Promise<Pick<Analysis, 'silences' | 'loudness' | 'beats' | 'bpm' | 'snares'>> {
  const [detect, pcm, bands] = await Promise.all([
    ffmpeg(['-i', path, '-vn', '-af', 'silencedetect=noise=-34dB:d=0.3,ebur128', '-f', 'null', '-']),
    // Beat tracking needs little detail; cap at 10 minutes to bound memory.
    ffmpeg(['-v', 'error', '-t', '600', '-i', path, '-vn', '-ac', '1', '-ar', '11025', '-f', 'f32le', '-'], true),
    // The same audio split into kick, snare and hi-hat bands (three channels) for snare detection.
    ffmpeg(['-v', 'error', '-t', '600', '-i', path, '-vn', '-filter_complex', `[0:a]aformat=channel_layouts=mono,aresample=${SNARE_RATE},asplit=3[a][b][c];[a]${BAND_FILTER};[k][s][h]amerge=inputs=3,aformat=sample_fmts=flt[m]`, '-map', '[m]', '-f', 'f32le', '-'], true).catch(() => null)
  ])
  const loud = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(detect.stderr)
  const samples = new Float32Array(pcm.stdout.buffer, pcm.stdout.byteOffset, Math.floor(pcm.stdout.byteLength / 4))
  const { bpm, beats } = detectBeats(samples, 11025)
  let snares: number[] = []
  if (bands && bands.stdout.byteLength >= 12) {
    const [k, s, h] = splitBands(new Float32Array(bands.stdout.buffer.slice(bands.stdout.byteOffset, bands.stdout.byteOffset + Math.floor(bands.stdout.byteLength / 12) * 12)))
    snares = detectSnares(k, s, h)
  }
  return { silences: parseSilences(detect.stderr, duration), loudness: loud ? Number(loud[1]) : null, beats, bpm, snares }
}

const MOTION_W = 128
const MOTION_H = 72
const MOTION_FPS = 6

async function videoPass(path: string): Promise<{ cuts: number[]; stats: FrameStat[]; hashes: { t: number; hash: string }[]; small: Buffer }> {
  const [scene, stat, thumbs, small] = await Promise.all([
    ffmpeg(['-i', path, '-an', '-vf', "scale=320:-2,select='gt(scene,0.32)',showinfo", '-f', 'null', '-']),
    ffmpeg(['-v', 'error', '-i', path, '-an', '-vf', 'fps=4,scale=160:-2,signalstats,metadata=print:file=-', '-f', 'null', '-'], true),
    ffmpeg(['-v', 'error', '-i', path, '-an', '-vf', 'fps=2,scale=9:8', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], true),
    // Tiny frames for camera-movement estimation; capped at 10 minutes to bound memory.
    ffmpeg(['-v', 'error', '-t', '600', '-i', path, '-an', '-vf', `fps=${MOTION_FPS},scale=${MOTION_W}:${MOTION_H}`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], true)
  ])
  const cuts = [...scene.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]))
  const hashes: { t: number; hash: string }[] = []
  for (let i = 0; (i + 1) * 72 <= thumbs.stdout.length; i++) hashes.push({ t: i / 2, hash: dHash(thumbs.stdout.subarray(i * 72, (i + 1) * 72)) })
  return { cuts, stats: parseFrameStats(stat.stdout.toString()), hashes, small: small.stdout }
}

export async function analyzeAsset(asset: MediaAsset): Promise<Analysis> {
  const hasAudio = asset.hasAudio || asset.kind === 'audio'
  const [audio, video] = await Promise.all([
    hasAudio ? audioPass(asset.path, asset.duration) : Promise.resolve({ silences: [], loudness: null, beats: [], bpm: null, snares: [] as number[] }),
    asset.kind === 'video' ? videoPass(asset.path) : Promise.resolve(null)
  ])
  const shots = video ? buildShots(asset.duration, video.cuts, video.stats, video.hashes, audio.silences, hasAudio) : []
  if (video) {
    const size = MOTION_W * MOTION_H
    for (const shot of shots) {
      // Leave out the frames right at the cuts.
      const from = Math.ceil((shot.start + 0.2) * MOTION_FPS)
      const to = Math.floor((shot.end - 0.2) * MOTION_FPS)
      const frames: Uint8Array[] = []
      for (let i = from; i <= to && (i + 1) * size <= video.small.length; i++) frames.push(video.small.subarray(i * size, (i + 1) * size))
      const camera = frames.length > 3 ? describeCamera(estimateCameraMotion(frames, MOTION_W, MOTION_H)) : undefined
      if (camera) {
        shot.camera = camera
        shot.tags.push(camera)
      }
    }
  }
  return { version: 1, ...audio, shots, transcript: asset.analysis?.transcript, language: asset.analysis?.language }
}
