/** Owns the <video>, <audio> and <img> elements that feed the compositor and the speakers. */
import type { Clip, MediaAsset, Project } from '@shared/types'
import { activeClips, sourceTime } from '@shared/timeline/ops'
import type { Spectrum } from '@shared/analysis/spectrum'
import { iconNames } from './text'
import { type AudioEffect, audioPreviewNodes } from '@shared/effects/audio'
import { type Chain, buildChain, loadWorklets, workletsReady } from './audioFx'
import { fadeAt, propAt } from '@shared/timeline/keyframes'
import { mediaUrl } from '../format'
import { type FrameSource, type Sources, clampedSourceTime } from './compositor'

type MediaEl = HTMLVideoElement | HTMLAudioElement

/** Seconds ahead of the playhead to start loading a clip, and how long to keep it after. */
const PRELOAD = 2
const KEEP = 6

export class MediaPool implements Sources {
  private media = new Map<string, MediaEl>()
  private images = new Map<string, HTMLImageElement>()
  /** Sound goes through Web Audio gain nodes so volume can go above 100% in the preview too. */
  private audio: AudioContext | null = null
  private sources = new Map<string, MediaElementAudioSourceNode>()
  private chains = new Map<string, { sig: string; chain: Chain }>()
  private gains = new Map<string, GainNode>()
  /** How much of the next source frame to mix in, per clip with frame blending. */
  private blends = new Map<string, number>()
  /** Called when a seek finishes or a file loads, so a paused preview can redraw. */
  onFrameReady: () => void = () => {}
  /** When true, sound is silenced (used by the exporter, which mixes audio with FFmpeg). */
  silent = false

  private spectra = new Map<string, { ready?: Spectrum; promise: Promise<void> }>()

  private loadSpectrum(path: string): Promise<void> {
    let entry = this.spectra.get(path)
    if (!entry) {
      const created: { ready?: Spectrum; promise: Promise<void> } = { promise: Promise.resolve() }
      created.promise = window.api.audio.spectrum(path).then((s) => { created.ready = s; this.onFrameReady() }).catch(() => undefined)
      this.spectra.set(path, (entry = created))
    }
    return entry.promise
  }

  /** Audio clips whose sound is playing at `time`: the sound the visualiser listens to. */
  private soundAt(project: Project, time: number): { clip: Clip; asset: MediaAsset }[] {
    const out: { clip: Clip; asset: MediaAsset }[] = []
    for (const { clip, track } of activeClips(project, time)) {
      const asset = clip.assetId ? project.media.find((m) => m.id === clip.assetId) : undefined
      if (asset && !asset.missing && !track.muted && !clip.muted && !clip.freeze && (asset.kind === 'audio' || asset.hasAudio)) out.push({ clip, asset })
    }
    // Music and voice-overs (audio tracks) come before the sound of video clips.
    return out.sort((a, b) => Number(b.asset.kind === 'audio') - Number(a.asset.kind === 'audio'))
  }

  getSpectrum(project: Project, time: number): ArrayLike<number> | null {
    const hit = this.soundAt(project, time)[0]
    if (!hit) return null
    void this.loadSpectrum(hit.asset.path)
    const s = this.spectra.get(hit.asset.path)?.ready
    if (!s) return null
    const frame = Math.max(0, Math.min(Math.floor(s.data.length / s.bands) - 1, Math.floor(sourceTime(hit.clip, time) * s.fps)))
    return Array.from(s.data.subarray(frame * s.bands, (frame + 1) * s.bands), (v) => v / 255)
  }

  getBlend(clip: Clip, asset: MediaAsset): { frame: FrameSource; mix: number } | null {
    const mix = this.blends.get(clip.id) ?? 0
    const el = this.media.get(`${clip.id}#b`)
    if (!mix || asset.kind !== 'video' || !(el instanceof HTMLVideoElement) || el.readyState < 2 || el.videoWidth === 0) return null
    return { frame: { image: el, width: el.videoWidth, height: el.videoHeight }, mix }
  }

  get(clip: Clip, asset: MediaAsset): FrameSource | null {
    if (asset.missing) return null
    if (asset.kind === 'image') {
      const img = this.image(asset)
      return img.complete && img.naturalWidth > 0 ? { image: img, width: img.naturalWidth, height: img.naturalHeight } : null
    }
    const el = this.media.get(clip.id)
    if (!(el instanceof HTMLVideoElement) || el.readyState < 2 || el.videoWidth === 0) return null
    return { image: el, width: el.videoWidth, height: el.videoHeight }
  }

  /** Finds an imported image by file name, with or without its extension. */
  private iconAsset(project: Project, name: string): MediaAsset | undefined {
    const n = name.trim().toLowerCase()
    return project.media.find((m) => m.kind === 'image' && !m.missing && (m.name.toLowerCase() === n || m.name.toLowerCase().replace(/\.[^.]+$/, '') === n))
  }

  icon(project: Project, name: string): FrameSource | null {
    const asset = this.iconAsset(project, name)
    if (!asset) return null
    const img = this.image(asset)
    return img.complete && img.naturalWidth > 0 ? { image: img, width: img.naturalWidth, height: img.naturalHeight } : null
  }

  private image(asset: MediaAsset): HTMLImageElement {
    let img = this.images.get(asset.id)
    if (!img) {
      img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => this.onFrameReady()
      img.src = mediaUrl(asset.path)
      this.images.set(asset.id, img)
    }
    return img
  }

  /** The video element for a clip; `suffix` '#b' is a second one used to hold the next frame for blending. */
  private element(clip: Clip, asset: MediaAsset, suffix = ''): MediaEl {
    const key = clip.id + suffix
    const url = mediaUrl(asset.proxyPath ?? asset.path)
    let el = this.media.get(key)
    // The clip may have been pointed at another file (a blurred copy, a relinked file): start over with the new one.
    if (el && el.dataset.src !== url) {
      this.release(key)
      el = undefined
    }
    if (!el) {
      el = asset.kind === 'video' ? document.createElement('video') : document.createElement('audio')
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      el.src = url
      el.dataset.src = url
      el.addEventListener('seeked', () => this.onFrameReady())
      el.addEventListener('loadeddata', () => this.onFrameReady())
      this.media.set(key, el)
    }
    return el
  }

  private gainFor(clipId: string, el: MediaEl): GainNode | null {
    if (this.silent) return null
    const existing = this.gains.get(clipId)
    if (existing) return existing
    try {
      if (!this.audio) { this.audio = new AudioContext(); void loadWorklets(this.audio) }
      const gain = this.audio.createGain()
      const source = this.audio.createMediaElementSource(el)
      source.connect(gain).connect(this.audio.destination)
      this.sources.set(clipId, source)
      this.gains.set(clipId, gain)
      return gain
    } catch {
      return null // fall back to the element's own volume (100% maximum)
    }
  }

  /** Puts the clip's audio effects between its source and its volume control, rebuilding only when they change. */
  private syncFx(clipId: string, gain: GainNode, effects: AudioEffect[] | undefined): void {
    const nodes = audioPreviewNodes(effects)
    const sig = JSON.stringify(nodes)
    const current = this.chains.get(clipId)
    if ((current?.sig ?? '[]') === sig) return
    const source = this.sources.get(clipId)
    if (!source || !this.audio) return
    // The pitch shifter loads in the background; wait for it rather than remembering a chain without it.
    if (nodes.some((n) => n.kind === 'pitch') && !workletsReady(this.audio)) return
    source.disconnect()
    current?.chain.dispose()
    this.chains.delete(clipId)
    if (!nodes.length) return void source.connect(gain)
    const chain = buildChain(this.audio, nodes)
    source.connect(chain.input)
    chain.output.connect(gain)
    this.chains.set(clipId, { sig, chain })
  }

  private release(clipId: string): void {
    this.chains.get(clipId)?.chain.dispose()
    this.chains.delete(clipId)
    this.sources.delete(clipId)
    this.gains.get(clipId)?.disconnect()
    this.gains.delete(clipId)
    const el = this.media.get(clipId)
    if (!el) return
    el.pause()
    el.removeAttribute('src')
    el.load()
    this.media.delete(clipId)
  }

  /** Brings every element in line with the playhead. Call on each frame and after edits. */
  sync(project: Project, time: number, playing: boolean): void {
    const assets = new Map(project.media.map((m) => [m.id, m]))
    const fps = project.settings.fps
    const active = new Map(activeClips(project, time).map((a) => [a.clip.id, a]))
    const wanted = new Set<string>()

    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const asset = clip.assetId ? assets.get(clip.assetId) : undefined
        if (!asset || asset.missing || asset.kind === 'image') {
          if (asset?.kind === 'image' && active.has(clip.id)) this.image(asset)
          continue
        }
        const isActive = active.has(clip.id)
        const near = time > clip.start - PRELOAD && time < clip.start + clip.duration + KEEP
        if (!isActive && !near) continue
        wanted.add(clip.id)
        const el = this.element(clip, asset)
        const target = clampedSourceTime(clip, asset, isActive ? time : clip.start, fps) - (asset.proxyOffset ?? 0)

        if (!isActive) {
          if (!el.paused) el.pause()
          // Park upcoming clips on their first frame so the cut is instant.
          if (time < clip.start && Math.abs(el.currentTime - target) > 0.05 && !el.seeking) el.currentTime = target
          continue
        }

        const local = Math.min(time - clip.start, clip.duration)
        const audible = !this.silent && !track.muted && !clip.muted && !clip.freeze && (asset.hasAudio || asset.kind === 'audio')
        el.muted = !audible
        const level = Math.max(0, propAt(clip, 'volume', local) * fadeAt(clip, local))
        const gain = audible ? this.gainFor(clip.id, el) : null
        if (gain) {
          this.syncFx(clip.id, gain, clip.audioFx)
          el.volume = 1
          gain.gain.value = level
          if (playing && this.audio?.state === 'suspended') void this.audio.resume()
        } else el.volume = Math.min(1, level)
        const canPlay = playing && !clip.reversed && !clip.freeze && active.get(clip.id)!.role === 'main'
        if (canPlay) {
          el.playbackRate = Math.max(0.0625, Math.min(16, clip.speed))
          if (el.paused) {
            if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target
            void el.play().catch(() => {})
          } else if (Math.abs(el.currentTime - target) > Math.max(0.25, 0.2 * clip.speed) && !el.seeking) {
            el.currentTime = target // drifted too far from the timeline clock
          }
        } else {
          if (!el.paused) el.pause()
          if (Math.abs(el.currentTime - target) > 0.4 / fps && !el.seeking) el.currentTime = target
        }
      }
    }
    for (const id of [...this.media.keys()]) if (!wanted.has(id.replace(/#b$/, ''))) this.release(id)
  }

  /** Seeks every contributing element to exactly `time` and resolves when all frames are decoded. */
  async prepareExact(project: Project, time: number): Promise<void> {
    const assets = new Map(project.media.map((m) => [m.id, m]))
    const waits: Promise<void>[] = []
    for (const { clip, track } of activeClips(project, time)) {
      if (clip.viz && !track.hidden) for (const s of this.soundAt(project, time)) waits.push(this.loadSpectrum(s.asset.path))
      // Icons inside text must be loaded before the frame is drawn.
      if (clip.text && !track.hidden) {
        for (const name of iconNames(clip.text)) {
          const iconAsset = this.iconAsset(project, name)
          const img = iconAsset && this.image(iconAsset)
          if (img && !img.complete) waits.push(new Promise((r) => { img.addEventListener('load', () => r(), { once: true }); img.addEventListener('error', () => r(), { once: true }) }))
        }
      }
      const asset = clip.assetId ? assets.get(clip.assetId) : undefined
      if (!asset || asset.missing || track.kind === 'audio' || track.hidden) continue
      if (asset.kind === 'image') {
        const img = this.image(asset)
        if (!img.complete) waits.push(new Promise((r) => img.addEventListener('load', () => r(), { once: true })))
        continue
      }
      if (asset.kind !== 'video') continue
      const el = this.element(clip, asset) as HTMLVideoElement
      el.muted = true
      const target = Math.max(0, clampedSourceTime(clip, asset, time, project.settings.fps) - (asset.proxyOffset ?? 0))
      if (clip.frameBlend) {
        // Frame blending: find the two source frames this moment falls between and how far along it is.
        const srcFps = asset.fps ?? project.settings.fps
        const exact = (target + (asset.proxyOffset ?? 0)) * srcFps
        const first = Math.floor(exact + 1e-6)
        const mix = exact - first < 0.02 ? 0 : exact - first
        const at = (frame: number): number => Math.max(0, (frame + 0.5) / srcFps - (asset.proxyOffset ?? 0)) // the middle of a frame is unambiguous to seek to
        waits.push(seekExact(el, at(first)))
        if (mix > 0 && (first + 1) / srcFps < asset.duration) waits.push(seekExact(this.element(clip, asset, '#b') as HTMLVideoElement, at(first + 1)))
        this.blends.set(clip.id, mix > 0 && (first + 1) / srcFps < asset.duration ? mix : 0)
      } else {
        this.blends.delete(clip.id)
        waits.push(seekExact(el, target))
      }
    }
    await Promise.all(waits)
    // Drop elements for clips we have passed, to keep memory flat on long exports.
    const keep = new Set(project.tracks.flatMap((t) => t.clips.filter((c) => time < c.start + c.duration + 1 && time > c.start - 1).map((c) => c.id)))
    for (const id of [...this.media.keys()]) if (!keep.has(id.replace(/#b$/, ''))) this.release(id)
  }

  dispose(): void {
    for (const id of [...this.media.keys()]) this.release(id)
    this.images.clear()
  }
}

function seekExact(el: HTMLVideoElement, target: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (): void => reject(new Error(`Could not decode ${decodeURIComponent(el.src)}`))
    const seek = (): void => {
      if (Math.abs(el.currentTime - target) < 1e-4 && !el.seeking && el.readyState >= 2) return resolve()
      el.addEventListener('seeked', () => resolve(), { once: true })
      el.currentTime = target
    }
    el.addEventListener('error', fail, { once: true })
    if (el.readyState >= 1) seek()
    else el.addEventListener('loadedmetadata', seek, { once: true })
  })
}
