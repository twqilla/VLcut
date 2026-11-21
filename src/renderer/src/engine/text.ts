/** Draws a text clip: layout, font pairing, word-timed captions and animations. */
import type { Clip, TextProps } from '@shared/types'
import type { FrameSource } from './compositor'

/** Finds an imported image by file name, for {name} icons inside text. */
export type IconResolver = (name: string) => FrameSource | null

/** Names written as {logo.png} in a text clip or caption. */
export function iconNames(text: TextProps): string[] {
  const all = [text.content, ...(text.words ?? []).map((w) => w.text)].join(' ')
  return [...[...all.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]), ...(text.fillKind === 'image' && text.fillImage ? [text.fillImage] : [])]
}
import { type Ctx, clamp01, easeOut, easeOutBack, easeOutBounce, easeOutElastic, rand } from './util'

interface Token {
  text: string
  accent: boolean
  /** Position among all visible tokens, for staggered animation. */
  index: number
  /** Seconds into the clip when this token starts animating in. */
  appear: number
  active: boolean
  /** Image name when the token is an inline icon. */
  icon?: string
  font: string
  /** Width on screen, including a scattered word's own size. */
  width: number
  /** Width of the text as drawn before that size is applied. */
  textWidth: number
  x: number
  line: number
  /** Characters before this token, for the typewriter animation. */
  charsBefore: number
}

const IN_DURATION = 0.35
const OUT_DURATION = 0.2
/** Animations that reveal word-timed captions one word at a time as they are spoken. */
const REVEAL = new Set(['fade', 'pop', 'slideUp', 'words', 'blurIn', 'drop', 'slideLeft', 'slideRight', 'slideDown', 'bounce', 'elastic', 'scaleUp', 'scaleDown', 'maskReveal', 'flip3D', 'kinetic', 'splitText', 'letters', 'stagger', 'rotating', 'morph'])
/** Animations that move each letter on its own. */
const PER_LETTER = new Set(['letters', 'stagger', 'rotating', 'morph'])
/** Seconds between the start of one word's animation and the next, for text without word timings. */
const STAGGER: Record<string, number> = { words: 0.09, kinetic: 0.1, bounce: 0.08, elastic: 0.07, scaleUp: 0.05, scaleDown: 0.05, flip3D: 0.08, maskReveal: 0.08 }
const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@*+?'

function fontFor(text: TextProps, accent: boolean, px: number): string {
  const family = accent ? text.accentFontFamily : text.fontFamily
  const italic = accent ? text.accentItalic : text.italic
  // Display faces only ship one weight; asking for 400 lets the browser use it without faux bold.
  const weight = accent ? 400 : text.weight
  return `${italic ? 'italic ' : ''}${weight} ${px}px "${family}", "Inter", sans-serif`
}

/** Splits content into lines of words; *asterisks* mark accent words. */
function parseContent(content: string): { text: string; accent: boolean }[][] {
  return content.split('\n').map((line) => {
    const out: { text: string; accent: boolean }[] = []
    for (const m of line.matchAll(/\*([^*]+)\*|([^\s*]+)/g)) {
      if (m[1] !== undefined) for (const w of m[1].split(/\s+/).filter(Boolean)) out.push({ text: w, accent: true })
      else out.push({ text: m[2], accent: false })
    }
    return out
  })
}

/** The words of a timed caption that are on screen at `localT`. */
function timedPage(text: TextProps, localT: number): { text: string; accent: boolean; appear: number; active: boolean }[] {
  const words = text.words!
  const per = text.wordsPerPage > 0 ? text.wordsPerPage : words.length
  let current = 0
  for (let i = 0; i < words.length; i++) if (words[i].start <= localT) current = i
  const pageStart = Math.floor(current / per) * per
  const reveal = REVEAL.has(text.animation)
  return words.slice(pageStart, pageStart + per).map((w, i) => ({
    text: w.text,
    accent: false,
    appear: reveal ? w.start : words[pageStart].start,
    active: pageStart + i === current && localT >= w.start && localT <= Math.max(w.end, words[pageStart + i + 1]?.start ?? w.end)
  }))
}

export function drawText(ctx: Ctx, clip: Clip, localT: number, W: number, H: number, resolveIcon?: IconResolver): void {
  const text = clip.text!
  const px = Math.max(1, text.fontSize * H)
  const maxWidth = W * 0.9
  const upper = (s: string): string => (text.uppercase ? s.toUpperCase() : s)
  ctx.save()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.letterSpacing = `${text.letterSpacing * px}px`

  // 1. Tokens.
  const sx = Math.max(0.2, text.stretchX ?? 1)
  const sourceLines = text.words?.length
    ? [timedPage(text, localT)]
    : (text.vertical ? [...text.content.replace(/[\s*]+/g, '')].map((ch) => [{ text: ch, accent: false }]) : parseContent(text.content)).map((line) => line.map((w) => ({ ...w, appear: 0, active: false })))
  const tokens: Token[] = []
  const space = px * 0.28
  let line = 0
  let chars = 0
  const lineWidths: number[] = []
  for (const words of sourceLines) {
    let x = 0
    for (const w of words) {
      const font = fontFor(text, w.accent, px)
      ctx.font = font
      const iconName = /^\{([^{}]+)\}$/.exec(w.text)?.[1]
      const icon = iconName ? resolveIcon?.(iconName) : null
      // Scattered words get their own size; the layout makes room for it so neighbours never overlap.
      const wordScale = text.layout === 'scatter' ? 0.8 + rand(tokens.length, 34) * 0.6 : 1
      const width = (icon ? (px * 0.95 * icon.width) / icon.height : ctx.measureText(upper(w.text)).width) * wordScale * sx
      if (x > 0 && x + width > maxWidth) {
        lineWidths[line] = x - space
        line++
        x = 0
      }
      tokens.push({ ...w, text: upper(w.text), icon: icon ? iconName : undefined, index: tokens.length, font, width, textWidth: width / (wordScale * sx), x, line, charsBefore: chars })
      chars += w.text.length
      x += width + space
    }
    lineWidths[line] = Math.max(0, x - space)
    line++
  }
  const lineCount = line
  if (!tokens.length) return ctx.restore()

  // 2. Layout around the origin.
  const lineH = px * text.lineHeight
  const blockW = Math.max(...lineWidths)
  const lineX = (l: number): number => (text.align === 'left' ? -blockW / 2 : text.align === 'right' ? blockW / 2 - lineWidths[l] : -lineWidths[l] / 2)
  const lineY = (l: number): number => (l - (lineCount - 1) / 2) * lineH

  // Pseudo-3D lean: skew and squash the whole block, as if it were tipped back.
  if (text.tilt) ctx.transform(1, 0, -text.tilt * 0.4, 1 - Math.abs(text.tilt) * 0.22, 0, 0)
  const arc = text.layout === 'arc' && Math.abs(text.curve) > 0.01 ? text.curve * Math.PI * 0.9 : 0
  const radius = arc ? Math.max(blockW, px) / arc : 0

  // 3. Leaving the screen: whole-block fade, slide, shrink or blur over the last moments of the clip.
  const anim = text.animation
  const outMode = text.animationOut ?? (anim === 'none' ? 'none' : 'fade')
  const outQ = outMode === 'none' ? 0 : clamp01((localT - (clip.duration - OUT_DURATION)) / OUT_DURATION)
  const outShift = easeOut(outQ)
  let outAlpha = 1
  let outDx = 0
  let outDy = 0
  let outScale = 1
  let outBlur = 0
  switch (outMode) {
    case 'fade':
      outAlpha = 1 - outQ
      break
    case 'slideUp':
      outAlpha = 1 - outQ
      outDy = -outShift * px * 0.6
      break
    case 'slideDown':
      outAlpha = 1 - outQ
      outDy = outShift * px * 0.6
      break
    case 'slideLeft':
      outAlpha = 1 - outQ
      outDx = -outShift * px * 2.5
      break
    case 'slideRight':
      outAlpha = 1 - outQ
      outDx = outShift * px * 2.5
      break
    case 'scaleDown':
      outAlpha = 1 - outQ
      outScale = 1 - outShift * 0.7
      break
    case 'scaleUp':
      outAlpha = 1 - outQ
      outScale = 1 + outShift * 0.8
      break
    case 'blurOut':
      outAlpha = 1 - outQ
      outBlur = outQ * px * 0.25
      break
  }
  const untimedStagger = text.words?.length ? 0 : STAGGER[anim] ?? 0

  // 4. Background box per line.
  if (text.boxColor) {
    const pad = text.boxPadding * px
    ctx.globalAlpha = (anim === 'none' ? 1 : clamp01(localT / 0.15)) * outAlpha
    ctx.fillStyle = text.boxColor
    for (let l = 0; l < lineCount; l++) {
      if (lineWidths[l] <= 0) continue
      ctx.beginPath()
      ctx.roundRect(lineX(l) - pad + outDx, lineY(l) - lineH / 2 - pad * 0.35 + outDy, lineWidths[l] + pad * 2, lineH + pad * 0.7, text.boxRadius * px)
      ctx.fill()
    }
  }

  const totalChars = tokens.length ? tokens[tokens.length - 1].charsBefore + tokens[tokens.length - 1].text.length : 0
  const typeRate = text.typeSeconds && text.typeSeconds > 0 ? totalChars / text.typeSeconds : 26
  const typedChars = anim === 'typewriter' ? Math.floor(localT * typeRate) : Infinity
  // The cursor blinks twice a second once typing has paused or finished, and stays solid while letters appear.
  const cursorOn = anim === 'typewriter' && text.typeCursor !== false && (typedChars < totalChars || Math.floor(localT * 2) % 2 === 0)
  const perLetter = PER_LETTER.has(anim)

  // 5. Tokens.
  for (const tok of tokens) {
    const q = anim === 'none' ? 1 : clamp01((localT - tok.appear - tok.index * untimedStagger) / IN_DURATION)
    let alpha = outAlpha
    let dy = outDy
    let dx = outDx
    let scale = outScale
    let blur = outBlur
    let spacing = text.letterSpacing * px
    let flipY = 1
    let reveal = 1
    let split = 0
    switch (anim) {
      case 'fade':
        alpha *= q
        break
      case 'pop':
        alpha *= clamp01(q * 3)
        scale *= q <= 0 ? 0 : easeOutBack(q)
        break
      case 'slideUp':
      case 'words':
        alpha *= q
        dy += (1 - easeOut(q)) * px * 0.6
        break
      case 'drop':
        alpha *= clamp01(q * 2)
        dy -= (1 - easeOut(q)) * px * 1.2
        break
      case 'blurIn':
        alpha *= q
        blur += (1 - q) * px * 0.25
        break
      case 'tracking':
        alpha *= q
        spacing += (1 - easeOut(q)) * px * 0.35
        break
      case 'glitch':
        if (q < 1) {
          const seed = Math.floor(localT * 30)
          dx += (rand(seed, tok.index) - 0.5) * px * 0.5 * (1 - q)
          alpha *= rand(seed, tok.index + 99) > 0.3 ? 1 : 0.2
        }
        break
      case 'wave':
        dy += Math.sin(localT * 4 + tok.index * 0.7) * px * 0.08
        break
      case 'slideLeft':
        alpha *= q
        dx += (1 - easeOut(q)) * px * 3
        break
      case 'slideRight':
        alpha *= q
        dx -= (1 - easeOut(q)) * px * 3
        break
      case 'slideDown':
        alpha *= q
        dy -= (1 - easeOut(q)) * px * 0.6
        break
      case 'bounce':
        alpha *= clamp01(q * 4)
        dy -= (1 - easeOutBounce(q)) * px * 1.4
        break
      case 'elastic':
        alpha *= clamp01(q * 4)
        scale *= easeOutElastic(q)
        break
      case 'scaleUp':
        alpha *= q
        scale *= 0.3 + 0.7 * easeOut(q)
        break
      case 'scaleDown':
        alpha *= q
        scale *= 1.9 - 0.9 * easeOut(q)
        break
      case 'maskReveal':
        reveal = q
        break
      case 'flip3D':
        alpha *= clamp01(q * 3)
        flipY = Math.max(0.001, easeOut(q))
        break
      case 'kinetic':
        alpha *= clamp01(q * 3)
        dx += (tok.index % 2 ? 1 : -1) * (1 - easeOut(q)) * px * 2.2
        scale *= 1 + (1 - q) * 0.35
        break
      case 'shake': {
        const seed = Math.floor(localT * 30)
        alpha *= clamp01(localT / 0.15)
        dx += (rand(seed, tok.index) - 0.5) * px * 0.07
        dy += (rand(seed, tok.index + 50) - 0.5) * px * 0.07
        break
      }
      case 'splitText':
        alpha *= clamp01(q * 3)
        split = 1 - easeOut(q)
        break
    }
    if (alpha <= 0) continue
    let shown = tok.text
    if (anim === 'typewriter') {
      const n = typedChars - tok.charsBefore
      if (n <= 0) continue
      shown = tok.text.slice(0, n)
    }
    if (tok.active && anim === 'pop') scale *= 1.08

    let cx = lineX(tok.line) + tok.x + tok.width / 2 + dx
    let cy = lineY(tok.line) + dy
    let rotation = 0
    if (arc) {
      // Bend the baseline into a circle segment; each word turns to follow it.
      const angle = cx / radius
      cy += radius - radius * Math.cos(angle)
      cx = radius * Math.sin(angle)
      rotation = angle
    } else if (text.layout === 'scatter') {
      // Words sit at their own size, angle and offset, the same every time for a given position.
      cy += (rand(tok.index, 32) - 0.5) * px * 0.6
      rotation = (rand(tok.index, 33) - 0.5) * 0.24
      scale *= 0.8 + rand(tok.index, 34) * 0.6
    }
    if (text.tilt) scale *= 1 - text.tilt * 0.14 * (tok.line - (lineCount - 1) / 2)
    ctx.save()
    ctx.translate(cx, cy)
    if (rotation) ctx.rotate(rotation)
    ctx.scale(scale * sx, scale * flipY)
    ctx.globalAlpha = alpha
    ctx.font = tok.font
    ctx.letterSpacing = `${spacing}px`
    if (blur > 0.2) ctx.filter = `blur(${blur}px)`

    if (tok.active && text.activeWordBox) {
      const pad = px * 0.14
      ctx.fillStyle = text.activeWordBox
      ctx.beginPath()
      ctx.roundRect(-tok.textWidth / 2 - pad, -lineH / 2 + px * 0.02, tok.textWidth + pad * 2, lineH - px * 0.04, px * 0.12)
      ctx.fill()
    }
    if (tok.icon) {
      const img = resolveIcon?.(tok.icon)
      if (img) {
        const h = px * 0.95
        const w = (h * img.width) / img.height
        ctx.drawImage(img.image, -w / 2, -h / 2, w, h)
      }
      ctx.restore()
      continue
    }
    const color = tok.active && !text.activeWordBox ? text.highlightColor : tok.accent && text.accentColor ? text.accentColor : text.color
    const tw = tok.textWidth
    const paint = (c: Ctx, str: string, x: number, boxX: number): void => paintRun(c, str, x, boxX, tw, px, text, color, resolveIcon)
    if (reveal < 1) {
      ctx.beginPath()
      ctx.rect(-tw / 2 - px * 0.2, -lineH, (tw + px * 0.4) * reveal, lineH * 2)
      ctx.clip()
    }
    if (perLetter) {
      let prefix = ''
      ;[...shown].forEach((ch, k) => {
        const gi = tok.charsBefore + k
        const lq = clamp01((localT - tok.appear - gi * 0.045) / 0.28)
        const x0 = ctx.measureText(prefix).width
        const cw = ctx.measureText(ch).width
        prefix += ch
        let la = 1
        let ldy = 0
        let lrot = 0
        let ls = 1
        let disp = ch
        if (anim === 'letters') la = lq
        else if (anim === 'stagger') {
          la = lq
          ldy = (1 - easeOut(lq)) * px * 0.5
        } else if (anim === 'rotating') {
          la = lq
          lrot = (1 - easeOut(lq)) * -1.4
          ls = 0.5 + 0.5 * easeOut(lq)
        } else if (anim === 'morph') {
          if (localT < tok.appear + gi * 0.045 - 0.3) la = 0
          else if (lq < 1 && ch !== ' ') disp = SCRAMBLE[Math.floor(rand(Math.floor(localT * 24), gi) * SCRAMBLE.length)]
        }
        if (la <= 0.001) return
        ctx.save()
        ctx.translate(-tw / 2 + x0 + cw / 2, ldy)
        if (lrot) ctx.rotate(lrot)
        ctx.scale(ls, ls)
        ctx.globalAlpha = alpha * la
        paint(ctx, disp, -cw / 2, -(x0 + cw / 2))
        ctx.restore()
      })
    } else if (split > 0.001) {
      for (const dir of [-1, 1]) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(-W, dir < 0 ? -H : 0, W * 2, H)
        ctx.clip()
        ctx.translate(dir * split * px * 0.9, 0)
        paint(ctx, shown, -tw / 2, -tw / 2)
        ctx.restore()
      }
    } else if (text.distort && text.distort !== 'none' && (text.distortAmount ?? 0) > 0) {
      drawDistorted(ctx, tok.font, spacing, tw, px, text, localT, (c) => paint(c, shown, -tw / 2, -tw / 2))
    } else {
      paint(ctx, shown, -tw / 2, -tw / 2)
    }
    if (cursorOn && shown.length > 0 && typedChars - tok.charsBefore <= tok.text.length) {
      // The cursor sits after the last letter typed so far (a block, like a terminal).
      ctx.font = tok.font
      ctx.letterSpacing = `${spacing}px`
      const cw = Math.max(px * 0.09, px * 0.4)
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.fillRect(-tw / 2 + ctx.measureText(shown).width + px * 0.05, -px * 0.42, cw * 0.55, px * 0.84)
    }
    ctx.restore()
  }
  ctx.restore()
}

// ---------------------------------------------------------------- painting a run of letters

type FillStyle = string | CanvasGradient | CanvasPattern

function fillFor(c: Ctx, text: TextProps, color: string, x0: number, width: number, px: number, resolveIcon?: IconResolver): FillStyle {
  const kind = text.fillKind ?? 'solid'
  const top = -px * 0.5
  const vertical = (stops: [number, string][]): CanvasGradient => {
    const g = c.createLinearGradient(0, top, 0, px * 0.5)
    for (const [at, col] of stops) g.addColorStop(at, col)
    return g
  }
  switch (kind) {
    case 'gradient': {
      const a = ((text.fillAngle ?? 0) * Math.PI) / 180
      const [hw, hh] = [width / 2, px / 2]
      const len = Math.abs(Math.cos(a)) * hw + Math.abs(Math.sin(a)) * hh
      const [cx, cy] = [x0 + hw, 0]
      const g = c.createLinearGradient(cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len)
      g.addColorStop(0, color)
      g.addColorStop(1, text.fillColor2 || '#ffffff')
      return g
    }
    case 'metal':
      return vertical([[0, '#fafafa'], [0.42, '#8d929b'], [0.5, '#3c4048'], [0.56, '#b9bec6'], [1, '#e8ebef']])
    case 'chrome':
      return vertical([[0, '#eef6ff'], [0.44, '#6b9fe6'], [0.5, '#0e131c'], [0.53, '#c9a97c'], [1, '#fff3d6']])
    case 'gold':
      return vertical([[0, '#fff3ae'], [0.4, '#d6a41a'], [0.5, '#7a5808'], [0.56, '#eac650'], [1, '#fff0b3']])
    case 'image': {
      const img = text.fillImage ? resolveIcon?.(text.fillImage) : null
      if (!img) return color
      const pat = c.createPattern(img.image as CanvasImageSource, 'repeat')
      if (!pat) return color
      const k = Math.max(width / img.width, px / img.height)
      pat.setTransform(new DOMMatrix().translate(x0, top).scale(k))
      return pat
    }
    default:
      return color
  }
}

/** Draws one run of letters at (x, 0) with every treatment: extrusion, glow, shadow, outline and fill. */
function paintRun(c: Ctx, str: string, x: number, boxX: number, boxW: number, px: number, text: TextProps, color: string, resolveIcon?: IconResolver): void {
  const depth = (text.extrudeDepth ?? 0) * px
  if (depth > 0.5) {
    const a = ((text.extrudeAngle ?? 45) * Math.PI) / 180
    const steps = Math.min(48, Math.ceil(depth / 1.5))
    c.save()
    c.fillStyle = text.extrudeColor || '#222222'
    c.strokeStyle = c.fillStyle
    c.lineJoin = 'round'
    c.lineWidth = text.outlineWidth * px * 2
    for (let i = steps; i >= 1; i--) {
      const off = (depth * i) / steps
      c.fillText(str, x + Math.cos(a) * off, Math.sin(a) * off)
      if (text.outlineWidth > 0) c.strokeText(str, x + Math.cos(a) * off, Math.sin(a) * off)
    }
    c.restore()
  }
  const glow = text.glowAmount ?? 0
  if (glow > 0) {
    c.save()
    c.shadowColor = text.glowColor || color
    c.fillStyle = text.glowColor || color
    for (const k of [1, 0.45]) {
      c.shadowBlur = px * 0.45 * glow * k
      c.fillText(str, x, 0)
    }
    c.restore()
  }
  if (text.shadow > 0) {
    c.shadowColor = `rgba(0,0,0,${clamp01(text.shadow)})`
    c.shadowBlur = px * 0.18
    c.shadowOffsetY = px * 0.04
  }
  const outline = text.hollow ? Math.max(text.outlineWidth, 0.03) : text.outlineWidth
  if (outline > 0) {
    c.lineJoin = 'round'
    c.lineWidth = outline * px * 2
    c.strokeStyle = text.hollow ? color : text.outlineColor
    c.strokeText(str, x, 0)
    c.shadowColor = 'transparent'
  }
  if (!text.hollow) {
    c.fillStyle = fillFor(c, text, color, boxX, boxW, px, resolveIcon)
    c.fillText(str, x, 0)
  }
  c.shadowColor = 'transparent'
}

let scratch: HTMLCanvasElement | undefined

/** Paints the run into a scratch canvas and redraws it in thin vertical strips that are shifted or scaled, bending the letters. */
function drawDistorted(ctx: Ctx, font: string, spacing: number, tw: number, px: number, text: TextProps, localT: number, paint: (c: Ctx) => void): void {
  const w = Math.ceil(tw + px * 0.8)
  const h = Math.ceil(px * 2.4)
  scratch ??= document.createElement('canvas')
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w
    scratch.height = h
  }
  const s = scratch.getContext('2d')!
  s.setTransform(1, 0, 0, 1, 0, 0)
  s.clearRect(0, 0, w, h)
  s.translate(w / 2, h / 2)
  s.font = font
  s.letterSpacing = `${spacing}px`
  s.textBaseline = 'middle'
  s.textAlign = 'left'
  paint(s)
  const amount = text.distortAmount ?? 0
  const strip = 2
  for (let sx = 0; sx < w; sx += strip) {
    const u = sx / w
    let dy = 0
    let k = 1
    if (text.distort === 'wave') dy = Math.sin(u * Math.PI * 3 + localT * 3) * amount * px * 0.18
    else if (text.distort === 'bulge') k = 1 + amount * 0.7 * Math.cos((u - 0.5) * Math.PI)
    else if (text.distort === 'skew') dy = (u - 0.5) * amount * px * 0.9
    ctx.drawImage(scratch, sx, 0, strip, h, sx - w / 2, -(h * k) / 2 + dy, strip + 0.5, h * k)
  }
}
