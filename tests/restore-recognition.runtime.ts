import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { initializeRevisionHistory } from '../src/main/services/revision-history'
import { originalRecognition, restoreRecognition } from '../src/main/services/restore-recognition'
const db = new Database(':memory:')
db.exec(readFileSync('src/main/db/schema.sql', 'utf8'))
initializeRevisionHistory(db)
db.prepare("INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order,raw_block) VALUES(1,0,'paragraph',?,'人工译文','done',1,?)").run('first\ntext', JSON.stringify({text:'first\ntext'}))
db.prepare('UPDATE paragraph SET en_text=? WHERE id=1').run('first text')
assert.equal(originalRecognition(db, 1), 'first\ntext')
assert.deepEqual(restoreRecognition(db, 1, 1), { restored: 1, skipped: 0 })
assert.deepEqual(db.prepare('SELECT en_text,zh_text,status FROM paragraph WHERE id=1').get(), { en_text:'first\ntext',zh_text:'人工译文',status:'review' })
assert.deepEqual(restoreRecognition(db, 1, 1), { restored: 0, skipped: 1 })
assert.throws(() => restoreRecognition(db, 0, 1))
db.close()
console.log('Original recognition restored without changing translation; repeat restore is a no-op.')
