/** The second wave of effects and transitions: blur, distortion, light, colour and texture families. */
import type { EffectSpec, NamedOption, ParamSpec } from './registry'

const p = (key: string, label: string, min: number, max: number, def: number, step = 0.01): ParamSpec => ({ key, label, min, max, step, default: def })

const pc = (key: string, label: string, def: number): ParamSpec => ({ key, label, min: 0, max: 0xffffff, step: 1, default: def, color: true })

export const MORE_EFFECTS: EffectSpec[] = [
  // Blur
  { type: 'lensBlur', name: 'Lens blur', category: 'Blur', params: [p('radius', 'Radius', 0, 40, 10, 0.5), p('highlights', 'Highlight bloom', 0, 1, 0.5)] },
  { type: 'bokehBlur', name: 'Bokeh blur', category: 'Blur', params: [p('radius', 'Softness', 0, 40, 12, 0.5), p('size', 'Bokeh size', 4, 60, 22, 1), p('threshold', 'Highlight threshold', 0.3, 0.98, 0.7), p('amount', 'Amount', 0, 1, 0.8)] },
  { type: 'backgroundBlur', name: 'Background blur', category: 'Blur', params: [p('blur', 'Blur', 0, 40, 14, 0.5), p('x', 'Focus X', 0, 1, 0.5), p('y', 'Focus Y', 0, 1, 0.5), p('size', 'Focus size', 0.1, 1, 0.4), p('feather', 'Feather', 0.02, 0.6, 0.25)] },
  { type: 'spinBlur', name: 'Spin blur', category: 'Blur', params: [p('amount', 'Amount', 0, 1, 0.4), p('x', 'Centre X', 0, 1, 0.5), p('y', 'Centre Y', 0, 1, 0.5)] },
  // Distortion
  { type: 'chromaticAberration', name: 'Chromatic aberration', category: 'Distort', params: [p('amount', 'Amount', 0, 1, 0.4)] },
  { type: 'ripple', name: 'Ripple', category: 'Distort', params: [p('amount', 'Amount', 0, 1, 0.4), p('frequency', 'Frequency', 2, 40, 12, 0.5), p('speed', 'Speed', 0, 10, 3, 0.1), p('x', 'Centre X', 0, 1, 0.5), p('y', 'Centre Y', 0, 1, 0.5)] },
  { type: 'fisheye', name: 'Fisheye', category: 'Distort', params: [p('amount', 'Amount (– pinch, + bulge)', -0.8, 2, 0.6)] },
  { type: 'displacementMap', name: 'Displacement map', category: 'Distort', params: [p('amount', 'Amount', 0, 1, 0.4), p('scale', 'Scale', 1, 20, 5, 0.5), p('pattern', 'Pattern (0 noise, 1 rings, 2 stripes)', 0, 2, 0, 1), p('speed', 'Speed', 0, 5, 0.5, 0.1)] },
  { type: 'heatDistortion', name: 'Heat distortion', category: 'Distort', params: [p('amount', 'Amount', 0, 1, 0.3), p('speed', 'Speed', 0, 10, 2.5, 0.1)] },
  { type: 'liquid', name: 'Liquid', category: 'Distort', params: [p('amount', 'Amount', 0, 1, 0.4), p('scale', 'Scale', 1, 10, 3, 0.1), p('speed', 'Speed', 0, 5, 1, 0.1)] },
  { type: 'pixelSort', name: 'Pixel sort', category: 'Distort', params: [p('threshold', 'Threshold', 0.1, 0.95, 0.45), p('vertical', 'Vertical (0 or 1)', 0, 1, 0, 1), p('amount', 'Rows affected', 0, 1, 0.6)] },
  { type: 'datamosh', name: 'Datamosh (simulated)', category: 'Distort', params: [p('amount', 'Amount', 0, 1, 0.5), p('block', 'Block size', 16, 96, 40, 1), p('speed', 'Speed', 0.5, 10, 3, 0.1)] },
  { type: 'digitalNoise', name: 'Digital noise', category: 'Distort', params: [p('amount', 'Amount', 0, 1, 0.4), p('speed', 'Speed', 1, 30, 12, 1)] },
  // Light
  { type: 'bloom', name: 'Bloom', category: 'Light', params: [p('amount', 'Amount', 0, 1, 0.6), p('threshold', 'Threshold', 0.2, 0.95, 0.6), p('radius', 'Radius', 2, 80, 26, 0.5)] },
  { type: 'lensFlare', name: 'Lens flare', category: 'Light', params: [p('amount', 'Amount', 0, 1, 0.7), p('x', 'Light X', 0, 1, 0.3), p('y', 'Light Y', 0, 1, 0.3), p('drift', 'Drift', 0, 1, 0.3), p('hue', 'Hue', 0, 360, 35, 1)] },
  { type: 'lightRays', name: 'Light rays', category: 'Light', params: [p('amount', 'Amount', 0, 1, 0.6), p('x', 'Source X', 0, 1, 0.5), p('y', 'Source Y', 0, 1, 0.2), p('threshold', 'Threshold', 0.2, 0.95, 0.55), p('length', 'Length', 0.1, 1, 0.5)] },
  { type: 'godRays', name: 'God rays', category: 'Light', params: [p('amount', 'Amount', 0, 1, 0.5), p('x', 'Source X', 0, 1, 0.75), p('y', 'Source Y', -0.3, 1, -0.05), p('beams', 'Beams', 3, 30, 12, 1), p('hue', 'Hue', 0, 360, 45, 1)] },
  { type: 'neonGlow', name: 'Neon glow', category: 'Light', params: [p('amount', 'Amount', 0, 1, 0.7), p('radius', 'Radius', 2, 60, 14, 0.5), p('saturation', 'Saturation', 0, 1, 0.5)] },
  { type: 'flashHit', name: 'Flash hit', category: 'Light', params: [p('amount', 'Strength', 0, 1, 0.9), p('at', 'At (seconds into clip)', 0, 30, 0, 0.05), p('decay', 'Decay (seconds)', 0.05, 2, 0.25, 0.05)] },
  { type: 'lightSweep', name: 'Light sweep', category: 'Light', params: [p('amount', 'Amount', 0, 1, 0.6), p('speed', 'Sweeps per second', 0.1, 3, 0.5, 0.05), p('width', 'Width', 0.03, 0.5, 0.14), p('angle', 'Angle', -80, 80, 20, 1)] },
  { type: 'anamorphicFlare', name: 'Anamorphic flare', category: 'Light', params: [p('amount', 'Amount', 0, 1, 0.6), p('threshold', 'Threshold', 0.4, 0.98, 0.8), p('length', 'Length', 0.1, 1.5, 0.7), p('hue', 'Hue', 0, 360, 210, 1)] },
  { type: 'halation', name: 'Halation', category: 'Light', params: [p('amount', 'Amount', 0, 1, 0.5), p('threshold', 'Threshold', 0.3, 0.95, 0.65), p('radius', 'Radius', 4, 80, 30, 0.5), p('hue', 'Hue', 0, 360, 12, 1)] },
  // Colour
  { type: 'selectiveColor', name: 'Selective colour', category: 'Color', params: [p('hue', 'Target hue', 0, 360, 120, 1), p('range', 'Range', 5, 180, 40, 1), p('hueShift', 'Hue shift', -90, 90, 0, 1), p('saturation', 'Saturation', -1, 1, 0.5), p('lightness', 'Lightness', -1, 1, 0)] },
  { type: 'colorIsolation', name: 'Colour isolation', category: 'Color', params: [p('hue', 'Keep hue', 0, 360, 0, 1), p('range', 'Range', 5, 120, 35, 1), p('softness', 'Softness', 1, 90, 20, 1), p('amount', 'Amount', 0, 1, 1)] },
  { type: 'filmEmulation', name: 'Film emulation', category: 'Color', params: [p('stock', 'Stock (0 warm, 1 green, 2 tungsten, 3 slide)', 0, 3, 0, 1), p('strength', 'Strength', 0, 1, 0.7), p('grain', 'Grain', 0, 1, 0.3)] },
  { type: 'hdr', name: 'HDR look', category: 'Color', params: [p('amount', 'Amount', 0, 1, 0.6), p('radius', 'Detail radius', 4, 80, 30, 1), p('saturation', 'Saturation', -0.5, 1, 0.2)] },
  { type: 'colorShift', name: 'Colour shift', category: 'Color', params: [p('speed', 'Degrees per second', -720, 720, 90, 1), p('saturation', 'Saturation', -0.5, 1, 0.2)] },
  { type: 'colorWheels', name: 'Colour wheels', category: 'Color', params: [p('shadowHue', 'Shadows hue', 0, 360, 215, 1), p('shadowAmount', 'Shadows amount', 0, 1, 0.25), p('midHue', 'Midtones hue', 0, 360, 40, 1), p('midAmount', 'Midtones amount', 0, 1, 0), p('highHue', 'Highlights hue', 0, 360, 35, 1), p('highAmount', 'Highlights amount', 0, 1, 0.25)] },
  // Texture
  { type: 'dust', name: 'Dust & hairs', category: 'Texture', params: [p('amount', 'Amount', 0, 1, 0.5), p('size', 'Size', 0.5, 4, 1.5, 0.1)] },
  { type: 'scratches', name: 'Film scratches', category: 'Texture', params: [p('amount', 'Amount', 0, 1, 0.4)] },
  { type: 'paperTexture', name: 'Paper texture', category: 'Texture', params: [p('amount', 'Amount', 0, 1, 0.4), p('scale', 'Scale', 1, 8, 3, 0.1)] },
  { type: 'halftone', name: 'Halftone', category: 'Texture', params: [p('size', 'Dot spacing', 4, 40, 10, 1), p('mix', 'Mix', 0, 1, 1), p('mono', 'Black & white (0 or 1)', 0, 1, 0, 1)] },
  { type: 'filmBurn', name: 'Film burn', category: 'Texture', params: [p('amount', 'Amount', 0, 1, 0.6), p('speed', 'Speed', 0.1, 3, 0.4, 0.05)] },
  // Compositing
  { type: 'chromaKey', name: 'Chroma key (green screen)', category: 'Composite', params: [pc('color', 'Key colour', 0x00ff00), p('similarity', 'Similarity', 0, 1, 0.4), p('smoothness', 'Edge softness', 0, 1, 0.12), p('spill', 'Spill removal', 0, 1, 0.6)] },
  { type: 'lumaKey', name: 'Luma key', category: 'Composite', params: [p('threshold', 'Threshold', 0, 1, 0.25), p('softness', 'Softness', 0, 1, 0.1), p('invert', 'Keep darks (0 or 1)', 0, 1, 0, 1)] },
  { type: 'dropShadow', name: 'Drop shadow', category: 'Composite', params: [p('x', 'Offset X', -60, 60, 8, 1), p('y', 'Offset Y', -60, 60, 14, 1), p('blur', 'Blur', 0, 80, 18, 1), p('opacity', 'Opacity', 0, 1, 0.6), pc('color', 'Colour', 0x000000)] },
  { type: 'innerShadow', name: 'Inner shadow', category: 'Composite', params: [p('x', 'Offset X', -60, 60, 6, 1), p('y', 'Offset Y', -60, 60, 8, 1), p('blur', 'Blur', 0, 80, 14, 1), p('opacity', 'Opacity', 0, 1, 0.6), pc('color', 'Colour', 0x000000)] },
  { type: 'stroke', name: 'Stroke / border', category: 'Composite', params: [p('width', 'Width', 0, 60, 6, 0.5), pc('color', 'Colour', 0xffffff), p('opacity', 'Opacity', 0, 1, 1)] },
  { type: 'roundedCorners', name: 'Rounded corners', category: 'Composite', params: [p('radius', 'Radius', 0, 0.5, 0.08)] },
  { type: 'reflection', name: 'Reflection', category: 'Composite', params: [p('opacity', 'Opacity', 0, 1, 0.4), p('gap', 'Gap', 0, 0.1, 0.01), p('fade', 'Fade length', 0.1, 1, 0.6)] },
  { type: 'cornerPin', name: 'Corner pin (perspective)', category: 'Composite', params: [p('tlx', 'Top-left X', -0.5, 0.5, 0), p('tly', 'Top-left Y', -0.5, 0.5, 0), p('trx', 'Top-right X', -0.5, 0.5, 0), p('try', 'Top-right Y', -0.5, 0.5, 0), p('blx', 'Bottom-left X', -0.5, 0.5, 0), p('bly', 'Bottom-left Y', -0.5, 0.5, 0), p('brx', 'Bottom-right X', -0.5, 0.5, 0), p('bry', 'Bottom-right Y', -0.5, 0.5, 0)] },
  // Camera
  { type: 'handheld', name: 'Handheld camera', category: 'Motion', params: [p('amount', 'Amount', 0, 1, 0.4), p('speed', 'Speed', 0.5, 12, 3, 0.1)] },
  { type: 'dollyZoom', name: 'Dolly zoom', category: 'Motion', params: [p('amount', 'Amount', 0, 1, 0.5), p('direction', 'Pull out instead (0 or 1)', 0, 1, 0, 1)] },
  { type: 'parallax', name: 'Parallax (near/far glide)', category: 'Motion', params: [p('amount', 'Amount', 0, 1, 0.5), p('speed', 'Speed', 0.1, 6, 1, 0.1), p('horizon', 'Horizon', 0, 0.9, 0.35)] },
  { type: 'kenBurns', name: 'Ken Burns', category: 'Motion', params: [p('startZoom', 'Start zoom', 1, 3, 1), p('endZoom', 'End zoom', 1, 3, 1.25), p('startX', 'Start pan X', -0.4, 0.4, 0), p('endX', 'End pan X', -0.4, 0.4, 0.06), p('startY', 'Start pan Y', -0.4, 0.4, 0), p('endY', 'End pan Y', -0.4, 0.4, -0.04)] },
  { type: 'camera3d', name: '3D camera', category: 'Motion', params: [p('rotateX', 'Tilt', -75, 75, 0, 1), p('rotateY', 'Turn', -75, 75, 20, 1), p('roll', 'Roll', -180, 180, 0, 1), p('distance', 'Distance (zoom)', 0.3, 2, 0.9), p('perspective', 'Perspective', 0.2, 2, 1), p('orbit', 'Orbit (degrees per second)', -90, 90, 0, 1)] },
  { type: 'lut', name: 'LUT (.cube)', category: 'Color', params: [p('amount', 'Intensity', 0, 1, 1)] }
]

/** The "clean" transitions: motion-blur whips, beat shakes, punches. Each starts with a timing curve that suits it (start ease, end ease). */
export const CLEAN_TRANSITIONS: (NamedOption & { ease: [number, number] })[] = [
  { type: 'whipLeft', name: 'Motion blur whip ←', ease: [0.7, 0.7] },
  { type: 'whipRight', name: 'Motion blur whip →', ease: [0.7, 0.7] },
  { type: 'whipUp', name: 'Motion blur whip ↑', ease: [0.7, 0.7] },
  { type: 'whipDown', name: 'Motion blur whip ↓', ease: [0.7, 0.7] },
  { type: 'rgbWhip', name: 'RGB whip', ease: [0.65, 0.65] },
  { type: 'beatShake', name: 'Beat shake', ease: [0, 0.85] },
  { type: 'beatPunch', name: 'Beat punch', ease: [0, 0.8] },
  { type: 'flashShake', name: 'Flash shake', ease: [0.1, 0.8] },
  { type: 'slamZoom', name: 'Slam zoom', ease: [0.85, 0.25] },
  { type: 'zoomBlurIn', name: 'Zoom blur in', ease: [0.6, 0.6] },
  { type: 'zoomBlurOut', name: 'Zoom blur out', ease: [0.6, 0.6] },
  { type: 'spinBlur', name: 'Spin blur', ease: [0.65, 0.65] },
  { type: 'glide', name: 'Glide', ease: [0.5, 0.5] },
  { type: 'shakeSlide', name: 'Shake slide', ease: [0.4, 0.8] }
]

/** The curve a clean transition starts with, when its clip has not set one. */
export function transitionEase(type: string): [number, number] | undefined {
  return CLEAN_TRANSITIONS.find((t) => t.type === type)?.ease
}

export const MORE_TRANSITIONS: NamedOption[] = [
  ...CLEAN_TRANSITIONS.map(({ type, name }) => ({ type, name })),
  { type: 'cut', name: 'Hard cut (no blend)' },
  { type: 'smoothFade', name: 'Smooth fade' },
  { type: 'dipWhite', name: 'Dip to white' },
  { type: 'swipe', name: 'Swipe' },
  { type: 'pan', name: 'Camera pan' },
  { type: 'cameraShake', name: 'Camera shake cut' },
  { type: 'roll', name: 'Roll' },
  { type: 'tilt', name: 'Tilt' },
  { type: 'rgbSplitTransition', name: 'RGB split' },
  { type: 'liquidTransition', name: 'Liquid' },
  { type: 'warp', name: 'Warp' },
  { type: 'morph', name: 'Morph dissolve' },
  { type: 'blinds', name: 'Blinds reveal' },
  { type: 'shatter', name: 'Shatter' },
  { type: 'pixelateTransition', name: 'Pixelate' },
  { type: 'stretch', name: 'Stretch' },
  { type: 'spinZoom', name: 'Spin zoom' }
]
