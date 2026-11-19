import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { OVERLAY_CATALOG } from '../src/shared/overlayCatalog'

const root = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('the licence and notice files exist and say what the app really ships', () => {
  for (const f of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'docs/PRIVACY.md', 'docs/licenses/Monocraft-OFL.txt', 'resources/legal/FONT_LICENSES.txt', 'resources/legal/LICENSE.txt', 'resources/legal/THIRD_PARTY_NOTICES.md', 'resources/legal/PRIVACY.md']) expect(existsSync(join(root, f)), f).toBe(true)
  expect(readFileSync(join(root, 'LICENSE'), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE')
  expect(pkg.license).toBe('GPL-3.0-or-later')
  const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  // Every shipped package is listed, so adding a dependency without regenerating the notices fails here.
  for (const name of Object.keys(pkg.dependencies)) expect(notices, name).toContain(`| ${name} |`)
  for (const part of ['FFmpeg', 'Electron', 'whisper.cpp', 'interpolini', 'Monocraft', 'x264', 'x265']) expect(notices, part).toContain(part)
  const fonts = readFileSync(join(root, 'resources/legal/FONT_LICENSES.txt'), 'utf8')
  for (const name of Object.keys(pkg.dependencies).filter((n) => n.startsWith('@fontsource/'))) expect(fonts, name).toContain(name.replace('@fontsource/', ''))
})

test('every shipped dependency has a permissive licence the GPL can include', () => {
  const ok = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'OFL-1.1'])
  for (const name of Object.keys(pkg.dependencies)) {
    const j = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'))
    expect(ok.has(j.license), `${name}: ${j.license}`).toBe(true)
  }
})

test('the installer is set up to carry the legal files, and the build publishes the source', () => {
  expect(JSON.stringify(pkg.build.extraResources)).toContain('resources/legal')
  const wf = readFileSync(join(root, '.github/workflows/windows.yml'), 'utf8')
  expect(wf).toContain('gen-notices.mjs')
  expect(wf).toContain('git archive')
  expect(wf).toContain('ffmpeg-version.txt')
})

test('no third-party trademark is used as the name of a built-in look, template or tile', () => {
  const sources = ['src/shared/color/looks.ts', 'src/shared/motionTemplates.ts', 'src/renderer/src/components/Sidebar.tsx', 'src/shared/overlayCatalog.ts']
  const names = sources.flatMap((f) => [...readFileSync(join(root, f), 'utf8').matchAll(/(?:L\('[\w]+', '|name: '|s\('[\w]+', '|o\('[\w]+', ')([^']+)'/g)].map((m) => m[1]))
  for (const n of names) expect(n, n).not.toMatch(/kodak|fuji|minecraft|netflix|disney|marvel|pixar|instagram|tiktok|youtube/i)
  expect(OVERLAY_CATALOG.length).toBeGreaterThan(0)
})
