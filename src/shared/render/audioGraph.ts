/**
 * Builds the FFmpeg inputs and filter graph that mix a project's sound.
 * Picture is rendered frame by frame in the app; sound is mixed here by FFmpeg.
 */
import type { Clip, Keyframe, Project } from '../types'
import { ease } from '../timeline/keyframes'
import { projectDuration } from '../timeline/ops'
import { audioEffectFilters } from '../effects/audio'

export interface AudioGraph {
  /** Arguments placed before the output, one `-ss/-t/-i` group per clip. */
  inputArgs: string[]
  filter: string
  /** Label of the final mixed stream, e.g. "[aout]". */
  output: string
}

export interface AudioMixOptions {
  /** Even out overall loudness to a broadcast-style target (EBU R128, -14 LUFS). */
  normalize?: boolean
}

const n = (v: number): string => (Math.round(v * 100000) / 100000).toString()

/** atempo accepts 0.5-100 per instance; chain instances for slower speeds. */
function tempoChain(speed: number): string[] {
  const parts: string[] = []
  let s = speed
  while (s < 0.5) {
    parts.push('atempo=0.5')
    s /= 0.5
  }
  if (Math.abs(s - 1) > 1e-6) parts.push(`atempo=${n(s)}`)
  return parts
}

/** A piecewise-linear FFmpeg expression of `t` following the keyframes (eased segments are subdivided). */
export function keyframeExpr(keyframes: Keyframe[]): string {
  const points: [number, number][] = []
  keyframes.forEach((k, i) => {
    points.push([k.t, k.value])
    const next = keyframes[i + 1]
    if (!next) return
    if (k.easing === 'hold') return void points.push([next.t - 1e-4, k.value])
    if (k.easing !== 'linear') for (let s = 1; s < 6; s++) points.push([k.t + ((next.t - k.t) * s) / 6, k.value + (next.value - k.value) * ease(k.easing, s / 6, k.bezier)])
  })
  let expr = n(points[points.length - 1][1])
  for (let i = points.length - 2; i >= 0; i--) {
    const [t0, v0] = points[i]
    const [t1, v1] = points[i + 1]
    const seg = t1 - t0 < 1e-6 ? n(v1) : `${n(v0)}+(${n(v1 - v0)})*(t-${n(t0)})/${n(t1 - t0)}`
    expr = `if(lt(t,${n(t1)}),${seg},${expr})`
  }
  return `if(lt(t,${n(points[0][0])}),${n(points[0][1])},${expr})`
}

function clipChain(clip: Clip, index: number): string {
  const f: string[] = ['aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo']
  if (clip.denoise) f.push('afftdn=nr=12:nf=-40')
  if (clip.reversed) f.push('areverse')
  f.push(...tempoChain(clip.speed), 'asetpts=PTS-STARTPTS')
  f.push(...audioEffectFilters(clip.audioFx))
  const kf = clip.keyframes.volume
  if (kf?.length) f.push(`volume='${keyframeExpr(kf)}':eval=frame`)
  else if (Math.abs(clip.volume - 1) > 1e-6) f.push(`volume=${n(clip.volume)}`)
  if (clip.fadeIn > 0) f.push(`afade=t=in:st=0:d=${n(clip.fadeIn)}`)
  if (clip.fadeOut > 0) f.push(`afade=t=out:st=${n(Math.max(0, clip.duration - clip.fadeOut))}:d=${n(clip.fadeOut)}`)
  f.push(`atrim=0:${n(clip.duration)}`, `adelay=${Math.round(clip.start * 1000)}:all=1`)
  return `[${index}:a]${f.join(',')}[a${index}]`
}

/**
 * @param firstInput Index of the first audio input (inputs before it belong to the caller, e.g. the video pipe).
 * @returns null when the project has no audible clips.
 */
export function buildAudioGraph(project: Project, firstInput = 0, options: AudioMixOptions = {}): AudioGraph | null {
  const assets = new Map(project.media.map((m) => [m.id, m]))
  const inputArgs: string[] = []
  const chains: string[] = []
  const labels: string[] = []
  let index = firstInput
  for (const track of project.tracks) {
    if (track.muted || track.kind === 'text') continue
    for (const clip of track.clips) {
      const asset = clip.assetId ? assets.get(clip.assetId) : undefined
      if (!asset || asset.missing || !(asset.hasAudio || asset.kind === 'audio') || asset.kind === 'image') continue
      if (clip.muted || clip.freeze || (clip.volume <= 0 && !clip.keyframes.volume?.length)) continue
      inputArgs.push('-ss', n(clip.sourceIn), '-t', n(clip.duration * clip.speed), '-i', asset.path)
      chains.push(clipChain(clip, index))
      labels.push(`[a${index}]`)
      index++
    }
  }
  if (!labels.length) return null
  const total = n(projectDuration(project))
  const post = [`apad`, `atrim=0:${total}`]
  if (options.normalize) post.unshift('loudnorm=I=-14:TP=-1.5:LRA=11')
  // normalize=0 keeps each clip at its own level instead of dividing by the number of inputs.
  const mix = labels.length === 1 ? `${labels[0]}${post.join(',')}[aout]` : `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,alimiter=limit=0.97,${post.join(',')}[aout]`
  return { inputArgs, filter: [...chains, mix].join(';'), output: '[aout]' }
}
