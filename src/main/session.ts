/** Remembers which project was open, so a crash or power cut can offer to reopen it. */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface OpenProject { id: string; name: string }
export interface SessionState {
  /** The previous run ended without a clean shutdown. */
  unclean: boolean
  lastProject?: OpenProject
}

const file = (dir: string): string => join(dir, 'session.json')

function write(dir: string, data: { running: boolean; project?: OpenProject | null }): void {
  try {
    mkdirSync(dirname(file(dir)), { recursive: true })
    writeFileSync(file(dir), JSON.stringify(data))
  } catch {
    // Recovery is a convenience; never let it stop the app.
  }
}

/** Call once at startup. Reports how the last run ended, then marks this run as running. */
export function beginSession(dir: string): SessionState {
  let state: SessionState = { unclean: false }
  try {
    if (existsSync(file(dir))) {
      const old = JSON.parse(readFileSync(file(dir), 'utf8')) as { running?: boolean; project?: OpenProject | null }
      if (old.running) state = { unclean: true, lastProject: old.project && typeof old.project.id === 'string' ? { id: old.project.id, name: String(old.project.name ?? '') } : undefined }
    }
  } catch {
    // An unreadable marker is treated as a clean start.
  }
  write(dir, { running: true, project: null })
  return state
}

export function noteProject(dir: string, project: OpenProject | null): void {
  write(dir, { running: true, project })
}

/** Call on a normal quit. */
export function endSession(dir: string): void {
  try {
    unlinkSync(file(dir))
  } catch {
    // Already gone.
  }
}
