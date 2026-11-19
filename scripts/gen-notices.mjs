// Writes THIRD_PARTY_NOTICES.md from the packages the app actually ships (package.json "dependencies") plus the programs it bundles or downloads.
// Run: node scripts/gen-notices.mjs   (the Windows build does this too, so the list always matches the installer)
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function licenceFile(dir) {
  for (const n of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE', 'OFL.txt']) if (existsSync(join(dir, n))) return readFileSync(join(dir, n), 'utf8')
  return ''
}
const copyright = (text) => text.split(/\r?\n/).map((l) => l.trim()).find((l) => /^copyright\s*(\(c\)|©)?\s*\d{4}/i.test(l)) ?? 'see the licence text'

const rows = []
for (const name of Object.keys(pkg.dependencies)) {
  const dir = join(root, 'node_modules', name)
  if (!existsSync(join(dir, 'package.json'))) throw new Error(`${name} is not installed; run npm ci first`)
  const j = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const lic = typeof j.license === 'string' ? j.license : j.license?.type ?? ''
  if (!lic) throw new Error(`${name} has no licence field`)
  const url = (typeof j.repository === 'string' ? j.repository : j.repository?.url ?? j.homepage ?? '').replace(/^git\+/, '').replace(/\.git$/, '')
  rows.push({ name, version: j.version, lic, url, copy: copyright(licenceFile(dir)) })
}
const allowed = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'OFL-1.1'])
const bad = rows.filter((r) => !allowed.has(r.lic))
if (bad.length) throw new Error(`Licence needs a human look before shipping: ${bad.map((r) => `${r.name} (${r.lic})`).join(', ')}`)

const fonts = rows.filter((r) => r.name.startsWith('@fontsource/'))
const libs = rows.filter((r) => !r.name.startsWith('@fontsource/'))
const table = (list) => ['| Package | Version | Licence | Copyright |', '|---|---|---|---|', ...list.map((r) => `| ${r.name} | ${r.version} | ${r.lic} | ${r.copy.replace(/\|/g, '/')} |`)].join('\n')

const out = `# Third-party notices

VLcut is free software under the GNU General Public License v3.0 or later (see LICENSE). It is built from, and ships with,
the following. Each package's own licence text is in its folder inside the installer's app archive and in its source repository.

## Programs bundled with or downloaded by the app

| Component | Licence | Where it comes from |
|---|---|---|
| **FFmpeg and FFprobe** (the video engine), a GPL build including x264 and x265 | GPL-2.0-or-later / GPL-3.0 (see FFmpeg's own notice below) | Bundled in the Windows installer. Built by BtbN, https://github.com/BtbN/FFmpeg-Builds ("master-latest-win64-gpl"). The exact version is in \`ffmpeg-version.txt\` next to this file. Source: https://ffmpeg.org/download.html and https://github.com/FFmpeg/FFmpeg ; x264: https://code.videolan.org/videolan/x264 ; x265: https://bitbucket.org/multicoreware/x265_git |
| **Electron** and **Chromium** (the application shell) | MIT (Electron); BSD-style and others (Chromium, listed in \`LICENSES.chromium.html\` in the installation folder) | Bundled |
| **whisper.cpp** (speech recognition), https://github.com/ggml-org/whisper.cpp | MIT | Downloaded once, when you ask for captions |
| **Whisper speech models** (OpenAI Whisper, converted to ggml), https://huggingface.co/ggerganov/whisper.cpp | MIT | Downloaded once, when you ask for captions |
| **interpolini** (motion blur interpolation), https://github.com/Z1xus/interpolini | GPL-3.0 | Downloaded only if you turn on that motion blur mode; run as a separate program |
| **Monocraft** font, https://github.com/IdreesInc/Monocraft | SIL Open Font License 1.1 (text in \`licenses/Monocraft-OFL.txt\`) | Bundled. Not affiliated with or endorsed by Mojang or Microsoft |
| **Ollama** (optional local language model) | MIT | Not bundled. Used only if you installed it yourself and switch the assistant to it |

### Written offer of source code (FFmpeg, x264, x265, interpolini)
The FFmpeg program in the installer is an unmodified build from https://github.com/BtbN/FFmpeg-Builds (its exact version is in
\`ffmpeg-version.txt\`). For at least three years after you received this program, anyone may ask for the complete corresponding source
code of that build, and of the other GPL programs named above, from the people who gave you this program; it is also available at the
addresses in the table. The source of VLcut itself is \`VLcut-source.zip\`, published with every release.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project. FFmpeg is licensed under the GNU Lesser/General Public
License; this build is the GPL variant. x264 and x265 are licensed under GPL-2.0-or-later.

## Fonts (SIL Open Font License 1.1 unless noted)

The fonts offered in the text tools come from the Fontsource project (https://fontsource.org), which packages open-source
fonts from Google Fonts and others. Each is licensed under the SIL Open Font License 1.1 (or Apache-2.0 where marked), which allows
use, including commercially, bundling and embedding, but not selling the font files by themselves. The text of each licence is
included with each font package.

${table(fonts)}

## Code libraries

${table(libs)}

## Trademarks

Names such as TikTok, YouTube, Instagram, Discord, X, Ollama, Minecraft, Kodak and Fuji are trademarks of their
owners. VLcut uses them only to say what a preset is meant for or where something comes from, and is not affiliated with or
endorsed by any of them. Its colour looks, sounds, overlays and templates are generated by the program itself and contain no
material copied from anyone.
`
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), out)

// Everything the installer must carry along: the licence texts the licences themselves ask to be included.
const legal = join(root, 'resources', 'legal')
mkdirSync(legal, { recursive: true })
copyFileSync(join(root, 'LICENSE'), join(legal, 'LICENSE.txt'))
copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(legal, 'THIRD_PARTY_NOTICES.md'))
copyFileSync(join(root, 'docs', 'PRIVACY.md'), join(legal, 'PRIVACY.md'))
copyFileSync(join(root, 'docs', 'licenses', 'Monocraft-OFL.txt'), join(legal, 'Monocraft-OFL.txt'))
// One copy of each distinct font licence text, with the fonts it covers (many fonts share the same OFL wording).
const groups = new Map()
for (const r of fonts) {
  const text = licenceFile(join(root, 'node_modules', r.name)).trim()
  if (!text) throw new Error(`${r.name} ships no licence text`)
  const h = createHash('sha256').update(text.replace(/\s+/g, ' ')).digest('hex')
  if (!groups.has(h)) groups.set(h, { text, names: [] })
  groups.get(h).names.push(r.name.replace('@fontsource/', ''))
}
writeFileSync(join(legal, 'FONT_LICENSES.txt'), [...groups.values()].map((g) => `==== Fonts covered by this licence: ${g.names.join(', ')} ====\n\n${g.text}\n`).join('\n\n'))
console.log(`Wrote resources/legal (${groups.size} distinct font licence texts)`)
console.log(`Wrote THIRD_PARTY_NOTICES.md: ${libs.length} libraries, ${fonts.length} font packages`)
