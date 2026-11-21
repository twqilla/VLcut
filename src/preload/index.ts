import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, ExportProgress, SentClip } from '@shared/types'

const api: Api = {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (name) => ipcRenderer.invoke('projects:create', name),
    load: (id) => ipcRenderer.invoke('projects:load', id),
    save: (project) => ipcRenderer.invoke('projects:save', project),
    duplicate: (id) => ipcRenderer.invoke('projects:duplicate', id),
    remove: (id) => ipcRenderer.invoke('projects:remove', id),
    rename: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
    snapshot: (project, label) => ipcRenderer.invoke('projects:snapshot', project, label),
    snapshots: (id) => ipcRenderer.invoke('projects:snapshots', id),
    prepFor: (id) => ipcRenderer.invoke('projects:prepFor', id),
    loadSnapshot: (id, file) => ipcRenderer.invoke('projects:loadSnapshot', id, file)
  },
  analysis: { analyze: (asset) => ipcRenderer.invoke('analysis:analyze', asset) },
  blur: {
    render: (request) => ipcRenderer.invoke('blur:render', request),
    cancel: (jobId) => ipcRenderer.invoke('blur:cancel', jobId),
    onProgress: (listener) => {
      const handler = (_e: unknown, p: { jobId: string; text: string }): void => listener(p)
      ipcRenderer.on('blur:progress', handler)
      return () => ipcRenderer.removeListener('blur:progress', handler)
    }
  },
  interpolini: {
    cfg: { list: () => ipcRenderer.invoke('cfg:list'), save: (name: string, text: string) => ipcRenderer.invoke('cfg:save', name, text), read: (name: string) => ipcRenderer.invoke('cfg:read', name), remove: (name: string) => ipcRenderer.invoke('cfg:delete', name), edit: (name: string) => ipcRenderer.invoke('cfg:edit', name) },
    status: () => ipcRenderer.invoke('interpolini:status'),
    install: () => ipcRenderer.invoke('interpolini:install'),
    choose: () => ipcRenderer.invoke('interpolini:choose'),
    onProgress: (listener) => {
      const handler = (_e: unknown, p: { label: string; fraction: number }): void => listener(p)
      ipcRenderer.on('interpolini:progress', handler)
      return () => ipcRenderer.removeListener('interpolini:progress', handler)
    }
  },
  speech: {
    status: () => ipcRenderer.invoke('speech:status'),
    install: (model) => ipcRenderer.invoke('speech:install', model),
    cancel: () => ipcRenderer.invoke('speech:cancel'),
    transcribe: (path, model, language) => ipcRenderer.invoke('speech:transcribe', path, model, language),
    onProgress: (listener) => {
      const handler = (_e: unknown, p: { label: string; fraction: number }): void => listener(p)
      ipcRenderer.on('speech:progress', handler)
      return () => ipcRenderer.removeListener('speech:progress', handler)
    }
  },
  storage: {
    usage: () => ipcRenderer.invoke('storage:usage'),
    clear: (name) => ipcRenderer.invoke('storage:clear', name),
    openFolder: () => ipcRenderer.send('storage:open')
  },
  split: {
    open: (prepProjectId) => ipcRenderer.invoke('split:open', prepProjectId),
    send: (items) => ipcRenderer.invoke('split:send', items),
    dropAt: (items, clientX, clientY) => ipcRenderer.invoke('split:dropAt', items, clientX, clientY),
    hover: (clientX, clientY) => ipcRenderer.send('split:hover', clientX, clientY ?? null),
    onHover: (listener) => {
      const handler = (_e: unknown, at: { x: number; y: number } | null): void => listener(at)
      ipcRenderer.on('split:hover', handler)
      return () => ipcRenderer.removeListener('split:hover', handler)
    },
    onReceive: (listener) => {
      const handler = (_e: unknown, items: SentClip[], at?: { x: number; y: number }): void => listener(items, at)
      ipcRenderer.on('split:receive', handler)
      return () => ipcRenderer.removeListener('split:receive', handler)
    }
  },
  clips: {
    getFolder: () => ipcRenderer.invoke('clips:getFolder'),
    pickFolder: () => ipcRenderer.invoke('clips:pickFolder'),
    list: (folder) => ipcRenderer.invoke('clips:list', folder),
    trim: (path, start, duration) => ipcRenderer.invoke('clips:trim', path, start, duration)
  },
  diagnostics: { collect: (settings) => ipcRenderer.invoke('diagnostics:collect', settings), log: (source, message) => ipcRenderer.send('diagnostics:log', source, message) },
  session: { state: () => ipcRenderer.invoke('session:state'), open: (project) => ipcRenderer.invoke('session:open', project) },
  audio: { sync: (a, b) => ipcRenderer.invoke('audio:sync', a, b), spectrum: (path) => ipcRenderer.invoke('audio:spectrum', path) },
  window: { toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'), state: () => ipcRenderer.invoke('window:state'), setStartFullscreen: (on: boolean) => ipcRenderer.invoke('window:setStartFullscreen', on) },
  legal: { read: (name: string) => ipcRenderer.invoke('legal:read', name), version: () => ipcRenderer.invoke('legal:version') },
  nest: { path: () => ipcRenderer.invoke('nest:path') },
  recording: { save: (data: ArrayBuffer, number: number) => ipcRenderer.invoke('recording:save', data, number) },
  tts: { voices: () => ipcRenderer.invoke('tts:voices'), speak: (text, voice, rate) => ipcRenderer.invoke('tts:speak', text, voice, rate) },
  motion: { stabilize: (req) => ipcRenderer.invoke('motion:stabilize', req), track: (req) => ipcRenderer.invoke('motion:track', req), focus: (req) => ipcRenderer.invoke('motion:focus', req) },
  fonts: { import: () => ipcRenderer.invoke('fonts:import'), list: () => ipcRenderer.invoke('fonts:list') },
  overlays: { ensure: (ids: string[]) => ipcRenderer.invoke('overlays:ensure', ids) },
  sfx: { ensure: (names?: string[]) => ipcRenderer.invoke('sfx:ensure', names) },
  files: {
    saveText: (defaultName, text) => ipcRenderer.invoke('files:saveText', defaultName, text),
    openText: (extensions) => ipcRenderer.invoke('files:openText', extensions)
  },
  styles: {
    list: () => ipcRenderer.invoke('styles:list'),
    save: (style) => ipcRenderer.invoke('styles:save', style),
    remove: (id) => ipcRenderer.invoke('styles:remove', id)
  },
  vision: {
    status: () => ipcRenderer.invoke('vision:status'),
    describe: (path, time) => ipcRenderer.invoke('vision:describe', path, time)
  },
  llm: {
    status: () => ipcRenderer.invoke('llm:status'),
    complete: (prompt) => ipcRenderer.invoke('llm:complete', prompt)
  },
  media: {
    pick: () => ipcRenderer.invoke('media:pick'),
    probe: (paths) => ipcRenderer.invoke('media:probe', paths),
    takeErrors: () => ipcRenderer.invoke('media:takeErrors'),
    proxy: (asset) => ipcRenderer.invoke('media:proxy', asset),
    thumbnail: (path, time) => ipcRenderer.invoke('media:thumbnail', path, time),
    waveform: (path) => ipcRenderer.invoke('media:waveform', path),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  system: {
    tools: () => ipcRenderer.invoke('system:tools'),
    showInFolder: (path) => ipcRenderer.send('system:showInFolder', path)
  },
  exporter: {
    encoders: () => ipcRenderer.invoke('export:encoders'),
    pickPath: (defaultName) => ipcRenderer.invoke('export:pickPath', defaultName),
    start: (project, settings) => ipcRenderer.invoke('export:start', project, settings),
    cancel: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
    lossless: (project, outputPath) => ipcRenderer.invoke('export:lossless', project, outputPath),
    onProgress: (listener) => {
      const handler = (_e: unknown, progress: ExportProgress): void => listener(progress)
      ipcRenderer.on('export:progress', handler)
      return () => ipcRenderer.removeListener('export:progress', handler)
    }
  },
  render: {
    job: (jobId) => ipcRenderer.invoke('render:job', jobId),
    frame: (jobId, frame, pixels) => ipcRenderer.invoke('render:frame', jobId, frame, pixels),
    finish: (jobId) => ipcRenderer.invoke('render:finish', jobId),
    fail: (jobId, message) => ipcRenderer.invoke('render:fail', jobId, message)
  }
}

contextBridge.exposeInMainWorld('api', api)
