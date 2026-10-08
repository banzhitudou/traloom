import type { Database } from 'better-sqlite3'
import { createHash } from 'crypto'

export function storeResource(db: Database, path: string, content: Buffer): void {
  db.prepare('INSERT INTO project_resource(path,content,sha256) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET content=excluded.content,sha256=excluded.sha256').run(path, content, createHash('sha256').update(content).digest('hex'))
}

export function readResource(db: Database, path: string): Buffer | null {
  const row = db.prepare('SELECT content,sha256 FROM project_resource WHERE path=?').get(path) as { content: Buffer; sha256: string } | undefined
  if (!row) return null
  if (createHash('sha256').update(row.content).digest('hex') !== row.sha256) throw new Error('工程资源校验失败。')
  return row.content
}
