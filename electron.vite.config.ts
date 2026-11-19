import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  // Nothing is inlined as a data: URL, so the audio worklet stays a real file the content-security policy allows.
  renderer: { plugins: [react()], resolve: { alias }, build: { assetsInlineLimit: 0 } }
})
