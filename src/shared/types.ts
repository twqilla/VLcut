/** Data model shared by the main process and the renderer. */

import type { InterpoliniSettings } from './render/interpolini'

export type MediaKind = 'video' | 'audio' | 'image'

export interface TimeRange {
  start: number
  end: number
}

/** One continuous camera shot inside a video file, with measured qualities (all 0-1). */
export interface Shot extends TimeRange {
  /** How much the picture changes from frame to frame. */
  motion: number
  brightness: number
  saturation: number
  /** Fraction of the shot that has sound above the silence threshold. */
  speech: number
  /** Perceptual hash of the middle frame, for spotting duplicate takes. */
  hash: string
  /** One-sentence description of what is in the picture, from an optional local vision model. */
  description?: string
  /** Detected camera movement: push-in, pull-out, pan-left, pan-right, tilt-up, tilt-down. */
  camera?: string
  /** Heuristic "how usable is this shot" rating. */
  score: number
  tags: string[]
  /** Index of an earlier shot in the same project that looks the same, if any. */
  duplicateOf?: { assetId: string; shot: number }
}

/** Everything the app has measured about a media file. Cached in the project. */
export interface Analysis {
  version: 1
  silences: TimeRange[]
  shots: Shot[]
  beats: number[]
  /** Times of detected snare hits, in seconds from the start of the file (empty when there is no percussion). */
  snares?: number[]
  bpm: number | null
  /** Integrated loudness in LUFS. */
  loudness: number | null
  /** Recognised speech with word timings (seconds in the source file). */
  transcript?: Word[]
  language?: string
}

/** Where a motion-blurred copy came from and how it was made. */
export interface BlurredFrom {
  /** The unblurred file's id in the project. */
  assetId: string
  /** Time in the original file at which the copy starts (the copy only covers the part that was used). */
  start: number
  end: number
  settings: InterpoliniSettings
  /** Frame rate the copy was blended down to. */
  blendFps: number
}

export interface BlurRequest {
  jobId: string
  /** The file to blur (the original, never an already blurred copy). */
  asset: MediaAsset
  start: number
  end: number
  blendFps: number
  settings: InterpoliniSettings
}

export interface MediaAsset {
  id: string
  /** Absolute path to the original file. Projects reference media, never copy it. */
  path: string
  name: string
  kind: MediaKind
  /** Seconds. 0 for still images. */
  duration: number
  width?: number
  height?: number
  fps?: number
  hasAudio: boolean
  videoCodec?: string
  audioCodec?: string
  sizeBytes: number
  analysis?: Analysis
  /** An H.264 copy used for preview and export when the app cannot decode the original. */
  proxyPath?: string
  /** Source time at which the proxy starts (render copies only cover the footage that is used). */
  proxyOffset?: number
  /** Name of a built-in sound effect this asset was generated from. */
  builtinSfx?: string
  /** Set for the built-in overlay clips (light leaks, grain, flashes); the media list hides them. */
  builtinOverlay?: string
  /** Set on a nested clip's rendered file: the original clips, kept so Unnest can restore them. */
  nested?: { t0: number; duration: number; tracks: { id: string; name: string; kind: TrackKind; clips: Clip[] }[]; media: MediaAsset[] }
  /** Set on a motion-blurred copy of (part of) another file; lets a clip go back to the original. */
  blurredFrom?: BlurredFrom
  /** True when the file could not be found the last time the project was opened. */
  missing?: boolean
}

export type TrackKind = 'video' | 'audio' | 'text'

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold' | 'bezier'

/** Clip properties that can be animated with keyframes. */
export type AnimProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume'

export interface Keyframe {
  /** Seconds from the start of the clip. */
  t: number
  value: number
  /** How the value travels from this keyframe to the next one. */
  easing: Easing
  /** Control points (x1, y1, x2, y2) of a cubic Bézier curve, used when `easing` is 'bezier'. y may leave 0..1 to overshoot. */
  bezier?: [number, number, number, number]
}

export interface Transform {
  /** Offset from the frame centre, as a fraction of frame width / height. */
  x: number
  y: number
  /** 1 = fitted inside the frame. */
  scale: number
  /** Degrees, clockwise. */
  rotation: number
}

/** Fractions (0-1) removed from each edge of the source picture. */
export interface Crop {
  left: number
  top: number
  right: number
  bottom: number
}

export interface EffectInstance {
  id: string
  /** Key into the effect registry (`src/shared/effects`). */
  type: string
  enabled: boolean
  params: Record<string, number>
  /** Set on effects added by an editing style, so re-styling replaces only those. */
  origin?: 'style'
  /** Id of the project asset the effect uses, e.g. the colour table of a LUT effect. */
  ref?: string
}

export interface Transition {
  /** Key into the transition registry. */
  type: string
  duration: number
  origin?: 'style'
  /** How gently the transition starts, 0 (abrupt) to 1 (very soft). Unset keeps the transition's own curve. */
  easeIn?: number
  /** How gently it lands, 0 (abrupt) to 1 (very soft). */
  easeOut?: number
  /** Scales blur, shake and smear of the transition, 0.2 to 2 (1 = as designed). */
  strength?: number
}

/** One timed word of a caption. Times are seconds from the start of the clip. */
export interface Word {
  text: string
  start: number
  end: number
}

export interface TextProps {
  content: string
  fontFamily: string
  /** Fraction of the frame height. */
  fontSize: number
  weight: number
  italic: boolean
  color: string
  align: 'left' | 'center' | 'right'
  uppercase: boolean
  letterSpacing: number
  lineHeight: number
  outlineColor: string
  /** Fraction of the font size. */
  outlineWidth: number
  shadow: number
  /** Empty string = no box. */
  boxColor: string
  boxPadding: number
  boxRadius: number
  /** How words are arranged: on straight lines, along an arc, or scattered at different sizes and angles. */
  layout: 'flat' | 'arc' | 'scatter'
  /** Arc bend, -1 to 1 (positive curves downward at the ends). */
  curve: number
  /** Pseudo-3D lean, -1 to 1. */
  tilt: number
  /** Key into the text animation registry. */
  animation: string
  /** Word timings; present on captions generated from speech. */
  words?: Word[]
  /** Colour of the word being spoken, for word-timed captions. */
  highlightColor: string
  /** Box drawn behind the word being spoken. Empty string = none. */
  activeWordBox: string
  /** Words wrapped in *asterisks* use this font, style and colour (font pairing). */
  accentFontFamily: string
  accentItalic: boolean
  accentColor: string
  /** Max words on screen at once for word-timed captions (0 = all). */
  wordsPerPage: number
  /** Outline only: the letters are not filled. */
  hollow?: boolean
  /** How the letters are filled. Gradient and the metals blend towards `fillColor2`; image uses an imported picture by name. */
  fillKind?: 'solid' | 'gradient' | 'metal' | 'chrome' | 'gold' | 'image'
  fillColor2?: string
  /** Gradient direction in degrees (0 = left to right, 90 = top to bottom). */
  fillAngle?: number
  fillImage?: string
  /** Neon glow around the letters. */
  glowColor?: string
  glowAmount?: number
  /** 3D extrusion: depth as a fraction of the font size, with its direction in degrees and colour. */
  extrudeDepth?: number
  extrudeAngle?: number
  extrudeColor?: string
  /** Horizontal stretch of the letters (1 = normal). */
  stretchX?: number
  /** One letter per line, reading downward. */
  vertical?: boolean
  /** Bends the letters themselves: waving, bulging or slanting. */
  distort?: 'none' | 'wave' | 'bulge' | 'skew'
  distortAmount?: number
  /** How the text leaves at the end of the clip (default: fade). */
  animationOut?: string
}

/** Limits a clip to a shape; everything outside it becomes transparent. */
export interface Mask {
  shape: 'ellipse' | 'rect' | 'polygon'
  /** Corners of a hand-drawn mask, as fractions of the frame measured from its centre. */
  points?: [number, number][]
  /** Rotoscoping: the polygon's corners at chosen moments (seconds from the clip start); between them the corners glide. Every key has as many corners as `points`. */
  keys?: { t: number; points: [number, number][] }[]
  /** When set, the mask travels to this offset and size over the length of the clip. */
  moveTo?: { x: number; y: number; scale: number }
  /** Centre offset and size as fractions of the frame. */
  x: number
  y: number
  width: number
  height: number
  /** Edge softness, 0-1. */
  feather: number
  invert: boolean
}

/** A live picture of the sound: bars, a wave or a ring that moves with the music. */
export interface VizProps {
  style: 'bars' | 'mirror' | 'wave' | 'circle' | 'dots'
  color: string
  color2: string
  /** How many bars or points (8-96). */
  bands: number
  /** Sensitivity: 0.3-3. */
  gain: number
  /** Bar or line thickness as a fraction of the frame height. */
  thickness: number
  /** Size of the drawing as fractions of the frame. */
  width: number
  height: number
}

/** A drawn graphic: a box, circle or line that can animate in. */
export interface ShapeProps {
  kind: 'rect' | 'ellipse' | 'line' | 'curve' | 'tiles'
  /** Number of tiles for the tile row. */
  count: number
  /** Size as fractions of the frame. */
  width: number
  height: number
  fill: string
  stroke: string
  /** Fraction of the frame height. */
  strokeWidth: number
  /** Corner rounding for boxes, 0-1. */
  radius: number
  animation: 'none' | 'fade' | 'grow' | 'draw'
}

export interface Clip {
  id: string
  /** Null for text clips. */
  assetId: string | null
  /** Position on the timeline, seconds. */
  start: number
  /** Length on the timeline, seconds. */
  duration: number
  /** Offset into the source media, seconds. */
  sourceIn: number
  speed: number
  reversed: boolean
  volume: number
  opacity: number
  transform: Transform
  crop: Crop
  /** Seconds of fade for both picture and sound. */
  fadeIn: number
  fadeOut: number
  effects: EffectInstance[]
  keyframes: Partial<Record<AnimProp, Keyframe[]>>
  transitionIn?: Transition
  text?: TextProps
  shape?: ShapeProps
  /** Audio visualiser (a clip with no media that draws the spectrum of the sound playing at that moment). */
  viz?: VizProps
  mask?: Mask
  /** What created the clip, when it was not placed by hand. */
  origin?: 'style' | 'caption'
  /** The clip's own sound is removed (its picture stays). */
  muted?: boolean
  /** Mixes neighbouring source frames, so slow motion and low frame rates look smooth (applied in the export). */
  frameBlend?: boolean
  /** Clean up background noise in the export (and analysis); not audible in the live preview. */
  denoise?: boolean
  /** How the clip's picture combines with what is beneath it. */
  blend?: BlendMode
  /** Cuts the clip out through another clip's shape or brightness (that clip is then used only as the matte, not shown). */
  matte?: { clipId: string; mode: 'alpha' | 'luma'; invert: boolean }
  /** Sound effects applied to the clip's audio, in order. */
  audioFx?: import('./effects/audio').AudioEffect[]
  /** The clip shows one still frame (the one at its source-in point) for its whole length, with no sound. */
  freeze?: boolean
  /** Set when keyframes came from the app's own camera tools, so they can be taken off again in one step. */
  autoMotion?: 'reframe' | 'tracked'
  /** Set when the clip has been stabilised: what to restore if the stabilisation is removed. */
  stab?: { zoom: number; x: number; y: number }
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'softLight' | 'hardLight' | 'colorDodge' | 'colorBurn' | 'darken' | 'lighten' | 'difference' | 'exclusion' | 'add' | 'hue' | 'saturation' | 'color' | 'luminosity'

export interface Track {
  id: string
  kind: TrackKind
  name: string
  clips: Clip[]
  muted: boolean
  hidden: boolean
  locked: boolean
  /** Row height in the timeline, pixels. */
  height: number
}

export interface ProjectSettings {
  width: number
  height: number
  fps: number
  /** Scale footage up with sharp, blocky pixels (nearest-neighbour) instead of smoothing. */
  pixelScaling?: boolean
}

export interface Project {
  /** The clip-prep workspace that belongs to this project (a second project shown beside it in split view). */
  prepProjectId?: string
  /** Set on a clip-prep workspace: the id of the project it feeds. */
  prepFor?: string
  /** Bumped whenever the on-disk format changes, so old files can be migrated. */
  formatVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  settings: ProjectSettings
  media: MediaAsset[]
  tracks: Track[]
  /** Colour lookup tables imported from .cube files, used by LUT effects. */
  luts?: import('./color/cube').Lut[]
}

export interface ProjectSummary {
  prepFor?: string
  id: string
  name: string
  updatedAt: string
  mediaCount: number
}

export interface ToolStatus {
  ffmpeg: string | null
  ffprobe: string | null
  /** Version line when the tool runs, otherwise why it could not run. */
  ffmpegInfo: string
  ffprobeInfo: string
  resourcesPath: string
}

export interface SpeechStatus {
  /** Path of the whisper.cpp program, or null if it is not installed. */
  binary: string | null
  /** Installed model names (tiny, base, small). */
  models: string[]
  /** Whether the app can download the program itself (Windows) or the user must install it. */
  canAutoInstall: boolean
}

export interface Snapshot {
  file: string
  label: string
  at: string
}

/** A trimmed clip travelling from the clip-prep window to the main project, with the media it uses. */
export interface SentClip {
  clip: Clip
  asset: MediaAsset | null
  trackKind: TrackKind
}

/** A video file in the user's clips folder. */
export interface ClipFile {
  path: string
  name: string
  /** Subfolder inside the clips folder ('' for the folder itself). */
  folder: string
  sizeBytes: number
  modified: string
}

/**
 * Motion blur on export. 'interpolini' runs the interpolini program (RIFE or SVP interpolation on the
 * graphics card, then its weighted blend) over the footage. 'quick' only blends moments of the timeline
 * (this editor's own, much simpler method).
 */
export interface MotionBlurSettings {
  mode: 'off' | 'quick' | 'interpolini'
  /** Quick mode: how long the virtual shutter stays open, as a fraction of the frame interval. */
  amount: number
  /** Quick mode: moments blended per frame. */
  samples: number
  /** Quick mode: how strongly the middle of the exposure counts compared with its ends. */
  weighting: 'equal' | 'gaussian' | 'triangle'
  /** Settings passed to interpolini when mode is 'interpolini'. */
  interpolini: InterpoliniSettings
}

/** Whether interpolini can be run on this computer. */
export interface InterpoliniStatus {
  /** Path of interpolini-cli, or null if it was not found. */
  path: string | null
  /** The program's own version line, or why it could not be started. */
  info: string
  /** Whether the app can download it itself (Windows). */
  canAutoInstall: boolean
}

export interface ExportSettings {
  outputPath: string
  width: number
  height: number
  fps: number
  codec: 'h264' | 'h265'
  /** Constant quality (CRF): lower is better and larger. Ignored when `videoBitrateKbps` is set. */
  crf: number
  videoBitrateKbps?: number
  audioBitrateKbps: number
  normalizeAudio: boolean
  motionBlur: MotionBlurSettings
  /** Scale footage up with sharp, blocky pixels (nearest-neighbour) instead of smoothing. */
  pixelScaling: boolean
}

export interface ExportProgress {
  jobId: string
  state: 'preparing' | 'rendering' | 'finishing' | 'done' | 'error' | 'cancelled'
  frame: number
  totalFrames: number
  elapsedMs: number
  /** Estimated time remaining, when known. */
  etaMs?: number
  message?: string
  outputPath: string
}

/** What the hidden render window needs to draw a job. */
export interface RenderJob {
  jobId: string
  project: Project
  width: number
  height: number
  fps: number
  totalFrames: number
  motionBlur: MotionBlurSettings
  /** The export is encoded in parts of this many frames. */
  partFrames: number
  /** Parts finished by an earlier, interrupted run; their frames are skipped. */
  doneParts: number[]
}

/** The API the preload script exposes to the renderer as `window.api`. */
/** Request to analyse a stretch of source footage for motion. */
export interface MotionRequest {
  path: string
  /** Seconds into the source file. */
  sourceStart: number
  sourceDuration: number
  /** Stabilisation: how many seconds of camera path are averaged (higher = steadier, less natural). */
  smoothSeconds?: number
}

export interface TrackRequest extends MotionRequest {
  /** Where to start following, as a fraction of the picture. */
  point: { x: number; y: number }
}

/** One value per analysed frame, `fps` frames per source second; coordinates are fractions of the picture. */
export interface MotionResult {
  fps: number
  points: { x: number; y: number }[]
}

export interface TrackResult extends MotionResult {
  /** Index of the first frame where the match was lost, if it was. */
  lostAt?: number
}

export interface Api {
  projects: {
    list(): Promise<ProjectSummary[]>
    create(name: string): Promise<Project>
    load(id: string): Promise<Project>
    save(project: Project): Promise<Project>
    duplicate(id: string): Promise<Project>
    remove(id: string): Promise<void>
    rename(id: string, name: string): Promise<void>
    /** Writes a named restore point to disk right now. */
    snapshot(project: Project, label: string): Promise<void>
    snapshots(id: string): Promise<Snapshot[]>
    loadSnapshot(id: string, file: string): Promise<Project>
    /** The project's clip-prep workspace, created on first use. */
    prepFor(id: string): Promise<Project>
  }
  analysis: {
    analyze(asset: MediaAsset): Promise<Analysis>
  }
  blur: {
    /** Blurs part of a file with interpolini and returns the path of the finished copy (kept on disk, reused if asked again). */
    render(request: BlurRequest): Promise<{ path: string }>
    cancel(jobId: string): Promise<void>
    onProgress(listener: (p: { jobId: string; text: string }) => void): () => void
  }
  interpolini: {
    status(): Promise<InterpoliniStatus>
    /** Downloads interpolini (Windows). Needs internet once. */
    install(): Promise<InterpoliniStatus>
    onProgress(listener: (p: { label: string; fraction: number }) => void): () => void
  }
  speech: {
    status(): Promise<SpeechStatus>
    install(model: string): Promise<SpeechStatus>
    /** Stops recognition or a download that is running. */
    cancel(): Promise<void>
    transcribe(path: string, model: string, language: string): Promise<{ words: Word[]; language?: string }>
    onProgress(listener: (p: { label: string; fraction: number }) => void): () => void
  }
  storage: {
    usage(): Promise<{ name: string; bytes: number; clearable: boolean }[]>
    /** Deletes a cache. Everything in it is rebuilt automatically when needed. */
    clear(name: string): Promise<void>
    openFolder(): void
  }
  split: {
    /** Opens (or focuses) the clip-prep window beside this one, each taking half the screen. */
    open(prepProjectId: string): Promise<void>
    /** From the prep window: hands clips to the main project's window. Resolves false if that window is gone. */
    send(items: SentClip[]): Promise<boolean>
    /**
     * Drag and drop between the windows: drops clips at a point given in the sending window's
     * coordinates (it may lie outside that window). Resolves false when the point is not over the other window.
     */
    dropAt(items: SentClip[], clientX: number, clientY: number): Promise<boolean>
    /** While dragging outside the window: tells the other window where the pointer is (null when the drag ends). */
    hover(clientX: number | null, clientY?: number): void
    onHover(listener: (at: { x: number; y: number } | null) => void): () => void
    /** `at` is set when the clips were dropped at a point in this window. */
    onReceive(listener: (items: SentClip[], at?: { x: number; y: number }) => void): () => void
  }
  clips: {
    getFolder(): Promise<string | null>
    pickFolder(): Promise<string | null>
    list(folder: string): Promise<ClipFile[]>
    /** Saves the chosen part beside the original without re-encoding, and returns the new file's path. */
    trim(path: string, start: number, duration: number): Promise<string>
  }
  diagnostics: {
    /** A report of versions, graphics, tools and recent errors, with names and folders removed. */
    collect(settings: { theme: string; mods: string[] }): Promise<string>
    /** Records an error from the interface for the report. */
    log(source: string, message: string): void
  }
  session: {
    /** How the previous run ended: `unclean` means it crashed or was killed, with the project that was open. */
    state(): Promise<{ unclean: boolean; lastProject?: { id: string; name: string } }>
    /** Tells the app which project is open (null when none), for crash recovery. */
    open(project: { id: string; name: string } | null): Promise<void>
  }
  audio: {
    /** How far the second file's recording is offset from the first (see syncOffset), with a confidence in standard deviations. */
    sync(a: string, b: string): Promise<{ lag: number; confidence: number }>
    /** Loudness of 48 frequency bands, 30 times a second, for the visualiser. */
    spectrum(path: string): Promise<{ bands: number; fps: number; data: Uint8Array }>
  }
  tts: {
    /** Names of the text-to-speech voices installed on this computer. */
    voices(): Promise<string[]>
    /** Speaks the text into an audio file (rate -10..10) and returns it as a library item. */
    speak(text: string, voice: string | undefined, rate: number): Promise<MediaAsset>
  }
  motion: {
    stabilize(req: MotionRequest): Promise<MotionResult>
    track(req: TrackRequest): Promise<TrackResult>
    focus(req: MotionRequest): Promise<MotionResult>
  }
  fonts: {
    /** Copies font files into the app and returns all custom fonts. */
    import(): Promise<{ name: string; path: string }[]>
    list(): Promise<{ name: string; path: string }[]>
  }
  window: {
    /** Switches the window to or from full screen (F11 does the same). Returns whether it is full screen now. */
    toggleFullscreen(): Promise<boolean>
    state(): Promise<{ fullscreen: boolean; startFullscreen: boolean }>
    /** Whether the app opens in true full screen (it always opens maximised). */
    setStartFullscreen(on: boolean): Promise<void>
  }
  legal: {
    /** One of the licence and notice files that ship with the app ('' if missing or not one of them). */
    read(name: 'LICENSE.txt' | 'THIRD_PARTY_NOTICES.md' | 'PRIVACY.md' | 'FONT_LICENSES.txt' | 'ffmpeg-version.txt'): Promise<string>
    version(): Promise<string>
  }
  nest: {
    /** A new file path in the app's data folder for a nested clip to be rendered to. */
    path(): Promise<string>
  }
  recording: {
    /** Saves WebM audio recorded from the microphone as a WAV file and returns it as a media asset. */
    save(data: ArrayBuffer, number: number): Promise<MediaAsset>
  }
  overlays: {
    /** Built-in overlay clips (light leaks, grain, flashes) as media assets, drawn on first use. */
    ensure(ids: string[]): Promise<MediaAsset[]>
  }
  sfx: {
    /** Built-in sound effects as media assets, generated on first use. */
    ensure(names?: string[]): Promise<MediaAsset[]>
  }
  files: {
    saveText(defaultName: string, text: string): Promise<string | null>
    openText(extensions: string[]): Promise<string | null>
  }
  styles: {
    list(): Promise<unknown[]>
    save(style: unknown): Promise<void>
    remove(id: string): Promise<void>
  }
  vision: {
    /** The installed local vision model, or null if none is running. */
    status(): Promise<string | null>
    /** Describes the frame at `time` in one sentence. */
    describe(path: string, time: number): Promise<string>
  }
  llm: {
    status(): Promise<{ available: boolean; model: string | null }>
    complete(prompt: string): Promise<string>
  }
  media: {
    /** Opens the system file picker and probes the chosen files. */
    pick(): Promise<MediaAsset[]>
    /** Why files from the last pick or drop could not be read (cleared when read). */
    takeErrors(): Promise<{ name: string; message: string }[]>
    /** Probes files dropped onto the window. */
    probe(paths: string[]): Promise<MediaAsset[]>
    /** Creates an H.264 stand-in for a file the app cannot decode, and returns its path. */
    proxy(asset: MediaAsset): Promise<string>
    /** A small JPEG data URL of the frame at `time` seconds. */
    thumbnail(path: string, time: number): Promise<string>
    /** One loudness peak (0-255) per 1/50 s of the file's audio. */
    waveform(path: string): Promise<Uint8Array>
    pathForFile(file: File): string
  }
  system: {
    tools(): Promise<ToolStatus>
    showInFolder(path: string): void
  }
  exporter: {
    /** Asks where to save. Returns null if the user cancels. */
    pickPath(defaultName: string): Promise<string | null>
    start(project: Project, settings: ExportSettings): Promise<string>
    cancel(jobId: string): Promise<void>
    /** Copies the original streams without re-encoding. Resolves with the seconds it took. */
    lossless(project: Project, outputPath: string): Promise<number>
    onProgress(listener: (progress: ExportProgress) => void): () => void
  }
  /** Used only by the hidden render window. */
  render: {
    job(jobId: string): Promise<RenderJob>
    /** Sends one RGBA frame. Resolves false if the job was cancelled. */
    frame(jobId: string, frame: number, pixels: ArrayBuffer): Promise<boolean>
    finish(jobId: string): Promise<void>
    fail(jobId: string, message: string): Promise<void>
  }
}
