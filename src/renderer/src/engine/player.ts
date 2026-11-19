/** The preview transport: owns the clock, keeps media in sync and draws the canvas. */
import { create } from 'zustand'
import type { Project } from '@shared/types'
import { projectDuration } from '@shared/timeline/ops'
import { QualityGovernor, useQuality } from './quality'
import { Compositor } from './compositor'
import { MediaPool } from './mediaPool'
import { ensureFonts } from './fonts'

interface PlaybackState {
  time: number
  playing: boolean
}

/** Playhead state for the UI. Kept apart from the project store so 60 updates a second stay cheap. */
export const usePlayback = create<PlaybackState>(() => ({ time: 0, playing: false }))

/** Preview tools that change what a click on the picture does. */
export const usePreviewTool = create<{ drawingMask: boolean; editingMask: boolean; pickingTrack: boolean; trackPick: { clipId: string; x: number; y: number; t: number; screenX: number; screenY: number } | null }>(() => ({ drawingMask: false, editingMask: false, pickingTrack: false, trackPick: null }))

class Player {
  private compositor = new Compositor()
  private governor = new QualityGovernor()
  private pool = new MediaPool()
  private canvas: HTMLCanvasElement | null = null
  private getProject: () => Project | null = () => null
  private raf = 0
  private clockStart = 0
  private timeStart = 0

  constructor() {
    this.pool.onFrameReady = () => this.invalidate()
    void ensureFonts().then(() => this.invalidate())
  }

  bind(getProject: () => Project | null): void {
    this.getProject = getProject
  }

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas
    this.invalidate()
  }

  get time(): number {
    return usePlayback.getState().time
  }

  play(): void {
    const project = this.getProject()
    if (!project || usePlayback.getState().playing) return
    const duration = projectDuration(project)
    if (duration <= 0) return
    const from = this.time >= duration - 1e-3 ? 0 : this.time
    this.timeStart = from
    this.clockStart = performance.now()
    usePlayback.setState({ playing: true, time: from })
    this.invalidate()
  }

  pause(): void {
    if (!usePlayback.getState().playing) return
    usePlayback.setState({ playing: false })
    this.invalidate()
  }

  toggle(): void {
    if (usePlayback.getState().playing) this.pause()
    else this.play()
  }

  seek(time: number): void {
    const project = this.getProject()
    const t = Math.max(0, Math.min(time, project ? projectDuration(project) : 0))
    this.timeStart = t
    this.clockStart = performance.now()
    usePlayback.setState({ time: t })
    this.invalidate()
  }

  /** Steps by whole frames while paused. */
  step(frames: number): void {
    const project = this.getProject()
    if (!project) return
    this.pause()
    const fps = project.settings.fps
    this.seek((Math.round(this.time * fps) + frames) / fps)
  }

  /** Draws a variation of the project (e.g. with a style applied) at the playhead, using the frames already decoded. */
  renderVariant(project: Project, canvas: HTMLCanvasElement): void {
    this.compositor.render(canvas.getContext('2d')!, project, this.time, this.pool)
  }

  /** Asks the compositor to remember where these clips are drawn, for the selection handles. */
  watch(ids: string[]): void {
    this.compositor.watch = new Set(ids)
    for (const id of [...this.compositor.rects.keys()]) if (!this.compositor.watch.has(id)) this.compositor.rects.delete(id)
    this.invalidate()
  }

  /** Where a watched clip was drawn on the last frame, in preview pixels. */
  rectFor(id: string): { cx: number; cy: number; w: number; h: number; rotation: number } | undefined {
    return this.compositor.rects.get(id)
  }

  /** Requests a redraw on the next animation frame. */
  invalidate(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.tick()
    })
  }

  private tick(): void {
    const project = this.getProject()
    if (!project) {
      this.pool.dispose()
      usePlayback.setState({ playing: false, time: 0 })
      return
    }
    let { time, playing } = usePlayback.getState()
    if (playing) {
      const duration = projectDuration(project)
      time = this.timeStart + (performance.now() - this.clockStart) / 1000
      if (time >= duration) {
        time = duration
        playing = false
      }
      usePlayback.setState({ time, playing })
    }
    this.pool.sync(project, time, playing)
    if (this.canvas) {
      const ctx = this.canvas.getContext('2d')!
      const began = performance.now()
      this.compositor.render(ctx, project, time, this.pool)
      // While playing, a frame that takes longer than its slot means the preview cannot keep up.
      if (playing && this.governor.sample(performance.now() - began, 1000 / project.settings.fps) === 'lower') useQuality.getState().lower()
    } else if (!playing) this.governor.reset()
    if (playing) this.invalidate()
  }
}

export const player = new Player()
