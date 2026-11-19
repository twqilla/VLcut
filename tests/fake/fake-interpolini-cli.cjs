#!/usr/bin/env node
/**
 * A stand-in for interpolini-cli used by the tests. It follows the contract of the real program as documented
 * in its source (crates/cli/src/main.rs): `-g -j -s section.key=value ... <clip>`, one JSON line per event on
 * stdout (start, progress, done with the output path, or failed), `--version`. It does NOT interpolate with RIFE
 * or SVP: it smooths neighbouring frames with FFmpeg so a test can see that a blurred file came back.
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('interpolini 0.0.0 (test stand-in)'); process.exit(0) }
if (process.env.FAKE_INTERPOLINI_LOG) fs.appendFileSync(process.env.FAKE_INTERPOLINI_LOG, JSON.stringify(args) + '\n')

const settings = {}
let clip = ''
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-s') { const [name, ...rest] = args[++i].split('='); settings[name] = rest.join('=') }
  else if (!args[i].startsWith('-')) clip = args[i]
}
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\n')
if (!clip || !fs.existsSync(clip)) { emit({ event: 'failed', clip, error: `no such clip: ${clip}` }); process.exit(1) }
emit({ event: 'start', clip })
emit({ event: 'info', message: 'h264  |  320x180  |  30.00 fps  |  30 frames' })
if (process.env.FAKE_INTERPOLINI_FAIL) { emit({ event: 'failed', clip, error: process.env.FAKE_INTERPOLINI_FAIL }); process.exit(1) }

const blendFps = Number(settings['blending.fps'] || 60)
// Like the real program: '<name> - interpolini.mp4' beside the clip.
const out = path.join(path.dirname(clip), path.basename(clip, path.extname(clip)) + ' - interpolini.mp4')
emit({ event: 'progress', frame: 1, frames: 2, fps: 12.5 })
// FAKE_INTERPOLINI_PASSTHROUGH keeps every frame untouched, so a test can check exactly which frames came back.
const filter = process.env.FAKE_INTERPOLINI_PASSTHROUGH ? `fps=${blendFps}` : `tmix=frames=5,fps=${blendFps}`
const run = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', clip, '-vf', filter, '-an', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', out], { encoding: 'utf8' })
if (run.status !== 0) { emit({ event: 'failed', clip, error: run.stderr.trim() }); process.exit(1) }
emit({ event: 'progress', frame: 2, frames: 2, fps: 12.5 })
// The real program prints the path in the form the clip was given in; FAKE_INTERPOLINI_RELATIVE mimics a bare file name.
emit({ event: 'done', clip, output: process.env.FAKE_INTERPOLINI_RELATIVE ? path.basename(out) : out, seconds: 0.5 })
