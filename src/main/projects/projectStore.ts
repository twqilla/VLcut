import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Project, ProjectSummary } from '@shared/types'
import { makeTrack, normalizeProject } from '@shared/timeline/model'

const MAX_BACKUPS = 10
/** Minimum time between two backups of the same project. */
const BACKUP_INTERVAL_MS = 5 * 60 * 1000

/**
 * Stores each project as `<root>/<id>/project.json`, with rolling backups in
 * `<root>/<id>/backups/`. Plain JSON so users can read, copy and version their
 * own project files.
 */
export class ProjectStore {
  constructor(private readonly root: string) {}

  private dir(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid project id: ${id}`)
    return join(this.root, id)
  }

  private file(id: string): string {
    return join(this.dir(id), 'project.json')
  }

  async list(): Promise<ProjectSummary[]> {
    await fs.mkdir(this.root, { recursive: true })
    const entries = await fs.readdir(this.root, { withFileTypes: true })
    const summaries: ProjectSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const p = await this.load(entry.name)
        summaries.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, mediaCount: p.media.length, prepFor: p.prepFor })
      } catch {
        // Unreadable folder: skip it rather than failing the whole list.
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async create(name: string): Promise<Project> {
    const now = new Date().toISOString()
    const project: Project = {
      formatVersion: 1,
      id: randomUUID(),
      name: name.trim() || 'Untitled project',
      createdAt: now,
      updatedAt: now,
      settings: { width: 1920, height: 1080, fps: 30 },
      media: [],
      tracks: [makeTrack('text', 'Text 1'), makeTrack('video', 'Video 1'), makeTrack('audio', 'Audio 1')]
    }
    await this.write(project)
    return project
  }

  /**
   * Loads a project. If the main file is corrupt (for example after a crash
   * mid-write), falls back to the newest readable backup.
   */
  async load(id: string): Promise<Project> {
    try {
      return await this.read(this.file(id))
    } catch (err) {
      for (const backup of (await this.backups(id)).reverse()) {
        try {
          return await this.read(join(this.dir(id), 'backups', backup))
        } catch {
          // Try the next older backup.
        }
      }
      throw err
    }
  }

  async save(project: Project): Promise<Project> {
    const saved = { ...project, updatedAt: new Date().toISOString() }
    await this.backupIfDue(project.id)
    await this.write(saved)
    return saved
  }

  async duplicate(id: string): Promise<Project> {
    const source = await this.load(id)
    const now = new Date().toISOString()
    const copy: Project = { ...source, id: randomUUID(), name: `${source.name} copy`, createdAt: now, updatedAt: now }
    await this.write(copy)
    return copy
  }

  async rename(id: string, name: string): Promise<void> {
    const project = await this.load(id)
    await this.write({ ...project, name: name.trim() || project.name, updatedAt: new Date().toISOString() })
  }

  /** Saves a named restore point, e.g. before the assistant changes the project. */
  async snapshot(project: Project, label: string): Promise<void> {
    const dir = join(this.dir(project.id), 'snapshots')
    await fs.mkdir(dir, { recursive: true })
    const safe = label.replace(/[^\w -]/g, '').trim().slice(0, 60) || 'Snapshot'
    await fs.writeFile(join(dir, `${Date.now()}--${safe}.json`), JSON.stringify(project), 'utf8')
    const files = (await fs.readdir(dir)).sort()
    for (const old of files.slice(0, Math.max(0, files.length - 30))) await fs.rm(join(dir, old), { force: true })
  }

  async snapshots(id: string): Promise<{ file: string; label: string; at: string }[]> {
    try {
      const files = (await fs.readdir(join(this.dir(id), 'snapshots'))).filter((f) => f.endsWith('.json')).sort().reverse()
      return files.map((file) => {
        const [stamp, label = 'Snapshot'] = file.replace(/\.json$/, '').split('--')
        return { file, label, at: new Date(Number(stamp)).toISOString() }
      })
    } catch {
      return []
    }
  }

  async loadSnapshot(id: string, file: string): Promise<Project> {
    if (!/^[\w -]+\.json$/.test(file)) throw new Error('Invalid snapshot name')
    return this.read(join(this.dir(id), 'snapshots', file))
  }

  /** Returns the clip-prep workspace for a project, creating it on first use. */
  async prepFor(id: string): Promise<Project> {
    const main = await this.load(id)
    if (main.prepProjectId) {
      try {
        return await this.load(main.prepProjectId)
      } catch {
        // It was deleted; make a new one below.
      }
    }
    const prep = await this.create(`${main.name} · clip prep`)
    const withTracks: Project = { ...prep, prepFor: id, settings: main.settings, tracks: [makeTrack('video', 'Video 3'), makeTrack('video', 'Video 2'), makeTrack('video', 'Video 1'), makeTrack('audio', 'Audio 1'), makeTrack('audio', 'Audio 2')] }
    await this.write(withTracks)
    await this.write({ ...main, prepProjectId: prep.id })
    return withTracks
  }

  async remove(id: string): Promise<void> {
    // A project's clip-prep workspace goes with it.
    const prepId = await this.load(id).then((p) => p.prepProjectId, () => undefined)
    if (prepId) await fs.rm(this.dir(prepId), { recursive: true, force: true })
    await fs.rm(this.dir(id), { recursive: true, force: true })
  }

  private async read(path: string): Promise<Project> {
    const project = JSON.parse(await fs.readFile(path, 'utf8')) as Project
    if (project.formatVersion !== 1 || !project.id) throw new Error(`Unsupported project file: ${path}`)
    return normalizeProject(project)
  }

  /** Writes to a temp file then renames, so a crash never leaves a half-written project. */
  private async write(project: Project): Promise<void> {
    await fs.mkdir(this.dir(project.id), { recursive: true })
    const tmp = `${this.file(project.id)}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf8')
    await fs.rename(tmp, this.file(project.id))
  }

  private async backups(id: string): Promise<string[]> {
    try {
      return (await fs.readdir(join(this.dir(id), 'backups'))).filter((f) => f.endsWith('.json')).sort()
    } catch {
      return []
    }
  }

  private async backupIfDue(id: string): Promise<void> {
    const existing = await this.backups(id)
    const newest = existing.at(-1)
    if (newest && Date.now() - Number(newest.replace('.json', '')) < BACKUP_INTERVAL_MS) return
    const backupDir = join(this.dir(id), 'backups')
    try {
      await fs.mkdir(backupDir, { recursive: true })
      await fs.copyFile(this.file(id), join(backupDir, `${Date.now()}.json`))
    } catch {
      return // Nothing saved yet to back up.
    }
    for (const old of existing.slice(0, Math.max(0, existing.length + 1 - MAX_BACKUPS))) {
      await fs.rm(join(backupDir, old), { force: true })
    }
  }
}
