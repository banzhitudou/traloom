import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { openDatabase, getDb, getCurrentDbPath, initSchema, closeDatabase } from '../src/main/db'
import { validateExistingProject } from '../src/main/services/project-validation'

const root = mkdtempSync(join(tmpdir(), 'traloom-project-open-'))
try {
  const file = join(root, 'legacy.twproj')
  const legacy = new Database(file)
  legacy.exec(readFileSync('src/main/db/schema.sql', 'utf8'))
  legacy.exec("INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status) VALUES(1,0,'paragraph','Original','Translation','done')")
  legacy.close()
  validateExistingProject(file)
  const active = openDatabase(file)
  initSchema()
  const invalid = join(root, 'invalid.twproj')
  writeFileSync(invalid, 'not a database')
  assert.throws(() => openDatabase(invalid))
  assert.equal(getDb(), active)
  assert.equal(getCurrentDbPath(), file)
  assert.equal(readFileSync(invalid, 'utf8'), 'not a database')
  assert.equal(active.prepare('SELECT zh_text FROM paragraph WHERE id=1').get()!.zh_text, 'Translation')
  closeDatabase()
  const moved = join(root, 'moved.twproj')
  renameSync(file, moved)
  assert.equal(openDatabase(moved).prepare('SELECT COUNT(*) AS n FROM paragraph').get()!.n, 1)
  console.log('Legacy project remains readable and movable; invalid open preserves the active project and input file.')
} finally { closeDatabase(); rmSync(root, { recursive: true, force: true }) }
