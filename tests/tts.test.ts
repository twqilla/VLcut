import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { listCommand, listVoices, parseVoices, speak, speakCommand } from '../src/main/audio/tts'

test('speech commands for each system keep the typed text out of the command line', () => {
  const evil = "hello'; Remove-Item -Recurse C:\\ #"
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const c = speakCommand(platform, { textFile: '/tmp/in.txt', out: '/tmp/out.wav', voice: 'Zira', rate: 2 })
    expect(JSON.stringify(c), platform).not.toContain(evil)
    expect(c.args.join(' ')).not.toMatch(/Remove-Item/)
  }
  const win = speakCommand('win32', { textFile: 'C:\\t.txt', out: 'C:\\o.wav', voice: "Evil'; calc", rate: 99 })
  expect(win.env).toMatchObject({ TTS_VOICE: "Evil'; calc", TTS_RATE: '10' }) // voice only ever travels as data, and the rate is clamped
  expect(win.args.join(' ')).not.toContain('calc')
  expect(speakCommand('darwin', { textFile: 't', out: 'o.aiff', voice: 'Alex', rate: 0 }).args).toEqual(['-v', 'Alex', '-r', '175', '-o', 'o.aiff', '-f', 't'])
  expect(listCommand('darwin').args).toEqual(['-v', '?'])
})

test('voice lists are read from each system\'s output', () => {
  expect(parseVoices('win32', 'Microsoft David Desktop\r\nMicrosoft Zira Desktop\r\n')).toEqual(['Microsoft David Desktop', 'Microsoft Zira Desktop'])
  expect(parseVoices('darwin', 'Alex                en_US    # Most people recognize me\nFred                en_US    # Sing\n')).toEqual(['Alex', 'Fred'])
  expect(parseVoices('linux', 'Pty Language Age/Gender VoiceName          File          Other Languages\n 5  af             --/M      Afrikaans          gmw/af\n 5  en-us          --/M      English_(America)  gmw/en-US\n')).toEqual(['Afrikaans', 'English_(America)'])
})

test('on this computer, speaking text makes a real audio file of the right length', async () => {
  const voices = await listVoices()
  if (!voices.length) return // no speech engine installed here (Windows and macOS have one built in)
  const dir = mkdtempSync(join(tmpdir(), 'tts-'))
  const slow = await speak(dir, 'Hello there, this is a test of the speech feature.', undefined, -2)
  const fast = await speak(dir, 'Hello there, this is a test of the speech feature.', undefined, 4)
  expect(slow.kind).toBe('audio')
  expect(slow.duration).toBeGreaterThan(1.5)
  expect(fast.duration).toBeLessThan(slow.duration * 0.8)
  expect(slow.name.startsWith('Voice · Hello there')).toBe(true)
  await expect(speak(dir, '   ', undefined, 0)).rejects.toThrow(/Type the words/)
}, 60000)
