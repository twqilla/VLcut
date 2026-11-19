import type { Clip, Mask, MediaAsset, Project, ShapeProps, TextProps, Track, TrackKind, VizProps } from '../types'

export const MIN_CLIP_DURATION = 1 / 60
export const IMAGE_DEFAULT_DURATION = 5
export const TEXT_DEFAULT_DURATION = 3

export const newId = (): string => globalThis.crypto.randomUUID()

export const DEFAULT_TEXT: TextProps = {
  content: 'Your text',
  fontFamily: 'Inter',
  fontSize: 0.08,
  weight: 700,
  italic: false,
  color: '#ffffff',
  align: 'center',
  uppercase: false,
  letterSpacing: 0,
  lineHeight: 1.15,
  outlineColor: '#000000',
  outlineWidth: 0,
  shadow: 0.4,
  boxColor: '',
  boxPadding: 0.25,
  boxRadius: 0.2,
  layout: 'flat',
  curve: 0,
  tilt: 0,
  animation: 'none',
  highlightColor: '#e8a33d',
  activeWordBox: '',
  accentFontFamily: 'Instrument Serif',
  accentItalic: true,
  accentColor: '',
  wordsPerPage: 0
}

export const DEFAULT_SHAPE: ShapeProps = { kind: 'rect', count: 4, width: 0.4, height: 0.25, fill: '#e8a33d', stroke: '', strokeWidth: 0.008, radius: 0.15, animation: 'grow' }
export const DEFAULT_MASK: Mask = { shape: 'ellipse', x: 0, y: 0, width: 0.6, height: 0.6, feather: 0.1, invert: false }

export function shapeClip(start: number, shape: Partial<ShapeProps> = {}, duration = TEXT_DEFAULT_DURATION): Clip {
  return makeClip({ assetId: null, start, duration, shape: { ...DEFAULT_SHAPE, ...shape } })
}

export function makeClip(partial: Partial<Clip> & Pick<Clip, 'assetId' | 'start' | 'duration'>): Clip {
  return {
    id: newId(),
    sourceIn: 0,
    speed: 1,
    reversed: false,
    volume: 1,
    opacity: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    fadeIn: 0,
    fadeOut: 0,
    effects: [],
    keyframes: {},
    ...partial
  }
}

export function clipFromAsset(asset: MediaAsset, start: number): Clip {
  return makeClip({ assetId: asset.id, start, duration: asset.kind === 'image' ? IMAGE_DEFAULT_DURATION : Math.max(asset.duration, MIN_CLIP_DURATION) })
}

export function textClip(start: number, text: Partial<TextProps> = {}, duration = TEXT_DEFAULT_DURATION): Clip {
  return makeClip({ assetId: null, start, duration, text: { ...DEFAULT_TEXT, ...text } })
}

export const DEFAULT_VIZ: VizProps = { style: 'bars', color: '#00ffd0', color2: '#3b82ff', bands: 40, gain: 1.2, thickness: 0.012, width: 0.8, height: 0.3 }

export function vizClip(start: number, viz: Partial<VizProps> = {}, duration = 10): Clip {
  const clip = makeClip({ assetId: null, start, duration, viz: { ...DEFAULT_VIZ, ...viz } })
  return { ...clip, transform: { ...clip.transform, y: 0.28 } }
}

export function makeTrack(kind: TrackKind, name: string): Track {
  return { id: newId(), kind, name, clips: [], muted: false, hidden: false, locked: false, height: kind === 'video' ? 56 : 44 }
}

/** Which track kind a media asset belongs on. */
export function trackKindFor(asset: MediaAsset): TrackKind {
  return asset.kind === 'audio' ? 'audio' : 'video'
}

/** Fills in fields added after a project file was written, so older files keep opening. */
export function normalizeProject(project: Project): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...makeTrack(t.kind, t.name),
      ...t,
      clips: t.clips.map((c) => {
        const clip = { ...makeClip({ assetId: c.assetId ?? null, start: c.start, duration: c.duration }), ...c }
        if (clip.text) clip.text = { ...DEFAULT_TEXT, ...clip.text }
        if (clip.shape) clip.shape = { ...DEFAULT_SHAPE, ...clip.shape }
        if (clip.viz) clip.viz = { ...DEFAULT_VIZ, ...clip.viz }
        return clip
      })
    }))
  }
}
