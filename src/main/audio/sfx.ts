/** Built-in sound effects, synthesised with FFmpeg on first use (no bundled audio files, no licences to track). */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '@shared/types'
import { probeMedia } from '../media/probe'
import { toolPath } from '../media/tools'

const noise = (d: number, colour: string, amount: number, ...filters: string[]): string[] => ['-f', 'lavfi', '-i', `anoisesrc=d=${d}:c=${colour}:a=${amount}:r=48000`, '-af', filters.join(',')]

/** id → FFmpeg arguments that produce the sound (before the output path). */
const RECIPES: Record<string, string[]> = {
  whoosh: noise(0.6, 'pink', 0.9, 'bandpass=f=1400:width_type=o:w=2.2', 'afade=t=in:d=0.28:curve=qsin', 'afade=t=out:st=0.3:d=0.3', 'volume=2.2'),
  impact: ['-f', 'lavfi', '-i', 'sine=f=52:d=0.8', '-f', 'lavfi', '-i', 'anoisesrc=d=0.8:c=brown:a=0.8', '-filter_complex', "[0:a]volume='exp(-5*t)':eval=frame[a];[1:a]lowpass=f=900,volume='0.7*exp(-22*t)':eval=frame[b];[a][b]amix=inputs=2:normalize=0,volume=1.6"],
  swell: ['-f', 'lavfi', '-i', 'sine=f=98:d=2', '-f', 'lavfi', '-i', 'sine=f=147:d=2', '-f', 'lavfi', '-i', 'anoisesrc=d=2:c=pink:a=0.25', '-filter_complex', '[0:a][1:a][2:a]amix=inputs=3:normalize=0,lowpass=f=1800,afade=t=in:d=1.2:curve=qsin,afade=t=out:st=1.2:d=0.8,volume=2'],
  tick: ['-f', 'lavfi', '-i', 'sine=f=1900:d=0.09', '-af', "volume='exp(-70*t)':eval=frame,highpass=f=800,volume=1.6"],
  glitch: ['-f', 'lavfi', '-i', 'anoisesrc=d=0.35:c=white:a=0.6', '-af', 'acrusher=bits=4:samples=30:mix=1:mode=log,tremolo=f=28:d=1,highpass=f=500,afade=t=out:st=0.25:d=0.1,volume=0.9'],
  tape: ['-f', 'lavfi', '-i', 'anoisesrc=d=0.5:c=brown:a=0.9', '-af', 'highpass=f=300,vibrato=f=9:d=0.6,afade=t=in:d=0.05,afade=t=out:st=0.25:d=0.25,volume=1.6'],
}

export const SFX_NAMES = Object.keys(RECIPES)

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => execFile(toolPath('ffmpeg'), args, (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve())))
}

/** Makes sure the named built-in sounds exist on disk (the core set when no names are given) and returns them as media assets. */
/** The sounds the editing styles and the assistant use by default. */
export const CORE_SFX = ['whoosh', 'impact', 'tick', 'swell', 'tape', 'glitch']

export async function ensureSfx(dir: string, names: string[] = CORE_SFX): Promise<MediaAsset[]> {
  await mkdir(dir, { recursive: true })
  const assets: MediaAsset[] = []
  for (const name of names) {
    const recipe = RECIPES[name]
    if (!recipe) continue
    const file = sfxFile(dir, name)
    if (!existsSync(file)) await run(['-y', '-v', 'error', ...recipe, '-ar', '48000', '-ac', '2', file])
    assets.push({ ...(await probeMedia(file)), name: `SFX · ${name}`, builtinSfx: name })
  }
  return assets
}

export const sfxFile = (dir: string, name: string): string => join(dir, `${name}.wav`)
