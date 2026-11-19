/** Built-in overlay clips, drawn with FFmpeg formulas on first use (no bundled footage, no licences to track). */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '@shared/types'
import { OVERLAY_CATALOG } from '@shared/overlayCatalog'
import { probeMedia } from './probe'
import { toolPath } from './tools'

const S = '1280x720'
/** Colour planes from formulas in X, Y, W, H and T, worked out on a small frame (formulas run per pixel) and enlarged smoothly. */
const geq = (d: number, r: string, g: string, b: string, size = '160x90', flags = 'bicubic'): string[] => ['-f', 'lavfi', '-i', `nullsrc=s=${size}:r=30:d=${d},format=gbrp,geq=r='${r}':g='${g}':b='${b}',scale=${S}:flags=${flags},format=yuv420p`]
/** One turn per loop of 5 seconds, k whole turns, so the clip repeats without a jump. */
const turn = (k: number): string => `(2*PI*T/5*${k})`
/** A soft blob of light: centre (cx,cy) as fractions of the frame, width in fractions of the frame width. */
const blob = (cx: string, cy: string, w: number): string => `exp(-(pow((X/W-(${cx}))/${w},2)+pow((Y/H-(${cy}))/${w * 1.6},2)))`
const leak = (c: [number, number, number], c2: [number, number, number]): string[] => {
  const v = `(0.9*${blob(`0.25+0.3*sin${turn(1)}`, `0.35+0.25*cos${turn(1)}`, 0.28)}+0.7*${blob(`0.8+0.15*cos${turn(2)}`, `0.7+0.2*sin${turn(1)}`, 0.22)})*(0.88+0.12*sin${turn(3)})`
  const w = `(0.8*${blob(`0.75+0.2*sin${turn(1)}`, `0.3+0.2*sin${turn(2)}`, 0.2)})`
  return geq(5, `255*min(1,${v}*${c[0]}+${w}*${c2[0]})`, `255*min(1,${v}*${c[1]}+${w}*${c2[1]})`, `255*min(1,${v}*${c[2]}+${w}*${c2[2]})`)
}

const RECIPES: Record<string, string[]> = {
  leakWarm: leak([1, 0.55, 0.12], [1, 0.25, 0.15]),
  leakCool: leak([0.2, 0.55, 1], [0.7, 0.25, 1]),
  leakRainbow: geq(5, `255*${blob(`0.5+0.4*sin${turn(1)}`, '0.5', 0.35)}*(0.5+0.5*sin(X/W*5+${turn(1)}))`, `255*${blob(`0.5+0.4*sin${turn(1)}`, '0.5', 0.35)}*(0.5+0.5*sin(X/W*5+2.1+${turn(1)}))`, `255*${blob(`0.5+0.4*sin${turn(1)}`, '0.5', 0.35)}*(0.5+0.5*sin(X/W*5+4.2+${turn(1)}))`),
  filmBurn: geq(5, '255*min(1,pow(abs(X/W-0.5)*2,3)*(0.7+0.3*sin(' + turn(2) + '+Y/H*4)))', '135*min(1,pow(abs(X/W-0.5)*2,3)*(0.7+0.3*sin(' + turn(2) + '+Y/H*4)))', '25*min(1,pow(abs(X/W-0.5)*2,3)*(0.7+0.3*sin(' + turn(2) + '+Y/H*4)))'),
  streak: geq(5, `150*exp(-pow((Y-H/2)/(H*0.02),2))*exp(-pow((X-W*(T/5*1.5-0.25))/(W*0.28),2))`, `190*exp(-pow((Y-H/2)/(H*0.02),2))*exp(-pow((X-W*(T/5*1.5-0.25))/(W*0.28),2))`, `255*exp(-pow((Y-H/2)/(H*0.02),2))*exp(-pow((X-W*(T/5*1.5-0.25))/(W*0.28),2))`, '320x180'),
  grain: ['-f', 'lavfi', '-i', `color=c=gray:s=${S}:r=30:d=3,format=yuv420p,noise=alls=38:allf=t`],
  // Random bright pixels (a new set every frame), enlarged into specks, plus a thin scratch that jumps about.
  dust: ['-f', 'lavfi', '-i', `nullsrc=s=427x240:r=30:d=4,format=gray,geq=lum='max(255*gt(random(1),0.9965),200*lt(abs(X-W*(0.2+0.6*abs(sin(floor(T*3)*9.7)))),0.7)*gt(sin(floor(T*3)*3.3+1),0.6))',scale=${S}:flags=neighbor,format=yuv420p`],
  flash: ['-f', 'lavfi', '-i', `color=c=white:s=${S}:r=30:d=0.6,fade=t=in:st=0:d=0.04,fade=t=out:st=0.06:d=0.4`],
  flashWarm: ['-f', 'lavfi', '-i', `color=c=0xffd8a0:s=${S}:r=30:d=0.6,fade=t=in:st=0:d=0.04,fade=t=out:st=0.06:d=0.4`],
  glitchBars: geq(4, `255*gt(sin(floor(Y/10)*12.9898+floor(T*10)*78.233),0.8)*gt(sin(floor(Y/10)*3.1+floor(T*10)),0)`, `255*gt(sin(floor(Y/10)*12.9898+floor(T*10)*78.233),0.8)*gt(sin(floor(Y/10)*5.3+floor(T*10)),0.3)`, `255*gt(sin(floor(Y/10)*12.9898+floor(T*10)*78.233),0.8)`, '320x180', 'neighbor'),
  vhsNoise: ['-f', 'lavfi', '-i', `nullsrc=s=320x180:r=30:d=5,format=gray,geq=lum='235*exp(-pow((Y-mod(T*H*0.2,H))/(H*0.035),2))*(0.5+0.5*sin(X*0.6+T*40))',scale=${S}:flags=bicubic,noise=alls=45:allf=t,format=yuv420p`]
}

export const OVERLAY_IDS = Object.keys(RECIPES)

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => execFile(toolPath('ffmpeg'), args, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())))
}

export const overlayFile = (dir: string, id: string): string => join(dir, `${id}.mp4`)

/** Makes sure the named overlays exist on disk and returns them as media assets (marked so the media list hides them). */
export async function ensureOverlays(dir: string, ids: string[]): Promise<MediaAsset[]> {
  await mkdir(dir, { recursive: true })
  const assets: MediaAsset[] = []
  for (const id of ids) {
    const recipe = RECIPES[id]
    const info = OVERLAY_CATALOG.find((x) => x.id === id)
    if (!recipe || !info) continue
    const file = overlayFile(dir, id)
    if (!existsSync(file)) await run(['-y', '-v', 'error', ...recipe, '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', file])
    assets.push({ ...(await probeMedia(file)), name: `Overlay · ${info.name}`, builtinOverlay: id })
  }
  return assets
}
