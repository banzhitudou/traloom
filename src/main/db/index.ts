/**
 * SQLite 连接与生命周期管理。
 * 主进程独占单连接（better-sqlite3 同步 API，不可跨进程共享）。
 * 来源：《技术方案文档》第 4 节。
 */
import Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Database as DatabaseType } from 'better-sqlite3'
import { initializeRevisionHistory, configureRevisionFunctions } from '../services/revision-history'

let db: DatabaseType | null = null
let currentDbPath: string | null = null

/**
 * 创建/打开一个 .twproj 数据库文件。
 * @param dbPath 数据库文件路径（xxx.twproj）
 */
export function openDatabase(dbPath: string): DatabaseType {
  if (db) {
    db.close()
  }
  db = new Database(dbPath)
  currentDbPath = dbPath
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('recursive_triggers = ON')
  configureRevisionFunctions(db)
  return db
}

export function getCurrentDbPath(): string | null {
  return currentDbPath
}

/**
 * 初始化表结构（建表）。
 * 幂等：表已存在则跳过。
 */
export function initSchema(): void {
  if (!db) throw new Error('数据库未打开，先调用 openDatabase')
  const schemaPath = [
    join(__dirname, 'schema.sql'),
    join(process.cwd(), 'src/main/db/schema.sql')
  ].find((p) => existsSync(p))
  if (!schemaPath) throw new Error('找不到数据库 schema.sql')
  const schema = readFileSync(schemaPath, 'utf-8')
  db.exec(schema)

  const paragraphColumns = db.pragma('table_info(paragraph)') as { name: string }[]
  if (!paragraphColumns.some((column) => column.name === 'sort_order')) {
    db.exec('ALTER TABLE paragraph ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_paragraph_page_order ON paragraph(page_idx, sort_order, id)')
  db.prepare('UPDATE paragraph SET sort_order = id WHERE sort_order <= 0').run()
  initializeRevisionHistory(db)
}

/** 获取当前数据库连接（未打开则抛错） */
export function getDb(): DatabaseType {
  if (!db) throw new Error('数据库未打开')
  return db
}

/** 当前是否有打开的数据库 */
export function hasDb(): boolean {
  return db !== null
}

/** 关闭数据库 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    currentDbPath = null
  }
}
