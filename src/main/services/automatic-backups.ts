import type { Database } from 'better-sqlite3'
import { createHash, randomUUID } from 'crypto'
import { constants } from 'fs'
import { copyFile, mkdir, readdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import { backupProjectDatabase } from './project-transfer'
import type { AutomaticBackup } from '../../shared/ipc-api'

export class AutomaticBackups {
  private changes = new WeakMap<Database, number>()
  constructor(private root: string, private keep = 3) {}
  private folder(source: string) { return join(this.root, createHash('sha256').update(source).digest('hex').slice(0, 24)) }

  async list(source: string): Promise<AutomaticBackup[]> {
    const folder = this.folder(source)
    let names: string[]
    try { names = await readdir(folder) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const rows = await Promise.all(names.filter(name => /^backup-.*\.twproj$/.test(name)).map(async id => {
      const info = await stat(join(folder, id))
      return { id, createdAt: info.mtime.toISOString(), size: info.size }
    }))
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  }

  async capture(db: Database, source: string): Promise<AutomaticBackup | null> {
    const changes = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    if (this.changes.get(db) === changes) return null
    const folder = this.folder(source)
    await mkdir(folder, { recursive: true })
    const id = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.twproj`
    await backupProjectDatabase(db, source, join(folder, id))
    this.changes.set(db, changes)
    const rows = await this.list(source)
    // A verified new snapshot exists before any older snapshot is pruned.
    for (const row of rows.filter(row => row.id !== id).slice(this.keep - 1)) await rm(join(folder, row.id))
    return rows.find(row => row.id === id) ?? null
  }

  async recoverCopy(source: string, id: string, destination: string): Promise<void> {
    if (!(await this.list(source)).some(row => row.id === id)) throw new Error('备份不存在，请刷新列表。')
    if (!/\.twproj$/i.test(destination)) throw new Error('恢复副本必须使用 .twproj 后缀。')
    await copyFile(join(this.folder(source), id), destination, constants.COPYFILE_EXCL)
  }
}
