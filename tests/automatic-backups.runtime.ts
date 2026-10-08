import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { initializeRevisionHistory } from '../src/main/services/revision-history'
import { storeResource, readResource } from '../src/main/services/project-resources'
import { AutomaticBackups } from '../src/main/services/automatic-backups'

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'automatic-backups-'))
  const source = join(root, 'original.twproj')
  const db = new Database(source)
  try {
    db.exec(readFileSync('src/main/db/schema.sql', 'utf8'))
    db.pragma('journal_mode=WAL')
    db.exec("INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order) VALUES(1,0,'paragraph','Garden','花园','done',1); INSERT INTO project_meta VALUES('pdf_path','files/original.pdf');")
    initializeRevisionHistory(db)
    storeResource(db, 'files/original.pdf', Buffer.from('%PDF-test'))
    const backups = new AutomaticBackups(join(root, 'backups'), 3)
    assert.equal((await backups.list(source)).length, 0)
    const first = await backups.capture(db, source)
    assert.ok(first)
    assert.equal(await backups.capture(db, source), null)
    const recovered = join(root, 'recovered.twproj')
    await backups.recoverCopy(source, first.id, recovered)
    const copy = new Database(recovered)
    assert.equal((copy.prepare('SELECT zh_text FROM paragraph').get() as {zh_text:string}).zh_text, '花园')
    assert.equal(readResource(copy, 'files/original.pdf')?.toString(), '%PDF-test')
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok')
    copy.close()
    await assert.rejects(backups.recoverCopy(source, first.id, source), /EEXIST/)
    await assert.rejects(backups.recoverCopy(source, '../original.twproj', join(root, 'bad.twproj')), /不存在/)
    for (let i = 0; i < 4; i++) {
      db.prepare('UPDATE paragraph SET zh_text=?').run('译文 ' + i)
      await backups.capture(db, source)
    }
    assert.equal((await backups.list(source)).length, 3)
    assert.equal((db.prepare('SELECT zh_text FROM paragraph').get() as {zh_text:string}).zh_text, '译文 3')
    assert.equal((await backups.list(join(root, 'other.twproj'))).length, 0)
    console.log('Automatic snapshots, unchanged skip, resource preservation, retention, project isolation and non-overwriting recovery passed.')
  } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
