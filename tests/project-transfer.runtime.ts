import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, linkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { initializeRevisionHistory } from '../src/main/services/revision-history'
import { backupProjectDatabase, createPortableProject, validateProjectPdf } from '../src/main/services/project-transfer'
import { resolveProjectPath } from '../src/main/services/project-paths'
import { readResource } from '../src/main/services/project-resources'

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'project-transfer-'))
  const source = join(root, 'original')
  mkdirSync(source)
  const file = join(source, 'project.twproj')
  const pdf = join(source, 'source.pdf')
  writeFileSync(pdf, '%PDF-1.4\nSynthetic transfer fixture\n%%EOF')
  writeFileSync(join(source, 'draft.md'), 'Synthetic draft')
  const db = new Database(file)
  db.exec(readFileSync('src/main/db/schema.sql', 'utf8'))
  db.pragma('journal_mode=WAL')
  db.exec(`INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order) VALUES(1,0,'paragraph','A small garden.','一座小花园。','done',1);
    INSERT INTO paragraph_note VALUES(1,'编辑备注');
    INSERT INTO glossary VALUES(1,'术语','garden','花园','');
    INSERT INTO project_meta VALUES('book_title','Test book'),('project_note','项目备注'),('pdf_path','source.pdf'),('draft_md_path','draft.md'),('json_path','missing.json');`)
  initializeRevisionHistory(db)
  const tables = ['paragraph', 'paragraph_note', 'glossary', 'revision_event', 'revision_environment', 'revision_identity']
  const content = (connection: Database.Database) => Object.fromEntries(tables.map(table => [table, connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  const original = content(db)
  const originalMeta = db.prepare('SELECT * FROM project_meta ORDER BY key').all()
  const bundle = await createPortableProject(db, file, root)
  assert.equal(bundle.warnings.length, 1)
  assert.deepEqual(content(db), original)
  assert.deepEqual(db.prepare('SELECT * FROM project_meta ORDER BY key').all(), originalMeta)
  const moved = join(root, 'moved-bundle')
  renameSync(bundle.path, moved)
  const copyPath = join(moved, 'project.twproj')
  const copy = new Database(copyPath)
  const meta = Object.fromEntries((copy.prepare('SELECT key,value FROM project_meta').all() as {key:string;value:string}[]).map(row => [row.key,row.value]))
  assert.deepEqual(content(copy), original)
  assert.equal(meta.json_path, '')
  db.close()
  rmSync(source, { recursive: true })
  await validateProjectPdf(resolveProjectPath(copyPath, meta.pdf_path))
  assert.equal(readFileSync(resolveProjectPath(copyPath, meta.draft_md_path), 'utf8'), 'Synthetic draft')

  const separateBackup = join(root, 'separate-backup.twproj')
  await backupProjectDatabase(copy, copyPath, separateBackup)
  const saved = new Database(separateBackup)
  const savedPdf = (saved.prepare("SELECT value FROM project_meta WHERE key='pdf_path'").get() as { value: string }).value
  assert.ok(readResource(saved, savedPdf)?.includes(Buffer.from('%PDF-')))
  assert.deepEqual(content(saved), original)
  saved.close()
  await assert.rejects(backupProjectDatabase(copy, copyPath, copyPath), /覆盖/)
  const hardlink = join(root, 'same-file.twproj')
  linkSync(copyPath, hardlink)
  await assert.rejects(backupProjectDatabase(copy, copyPath, hardlink), /覆盖/)
  const invalid = join(root, 'invalid.pdf')
  writeFileSync(invalid, 'not a PDF')
  await assert.rejects(validateProjectPdf(invalid), /PDF/)
  const validPdf = resolveProjectPath(copyPath, meta.pdf_path)
  renameSync(validPdf, validPdf + '.unavailable')
  const embeddedCopy = await createPortableProject(copy, copyPath, root)
  assert.ok(embeddedCopy.projectPath)
  copy.prepare('DELETE FROM project_resource').run()
  await assert.rejects(createPortableProject(copy, copyPath, root), /PDF 缺失/)
  assert.equal(readdirSync(root).some(name => name.startsWith('.workbench-')), false)
  assert.deepEqual(content(copy), original)
  copy.close()
  rmSync(root, { recursive: true })
  console.log('Portable project: WAL snapshot, core history preservation, moved folder, absent source, optional missing files, standalone backup paths, self-overwrite guards and failure cleanup passed.')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
