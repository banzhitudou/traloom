import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { initializeRevisionHistory } from '../src/main/services/revision-history'
import { commitRecognizedPage, isRecognitionPaused, setRecognitionPaused } from '../src/main/services/pdf-recognition'

const db = new Database(':memory:')
db.exec(readFileSync('src/main/db/schema.sql', 'utf8'))
initializeRevisionHistory(db)
db.prepare('INSERT INTO project_meta(key,value) VALUES(?,?)').run('recognition_total', '949')
db.exec("INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order) VALUES(1,0,'paragraph','Original','人工译文','done',1)")
const before = db.prepare('SELECT * FROM paragraph WHERE id=1').get()
assert.equal(isRecognitionPaused(db), false)
setRecognitionPaused(db, true)
assert.equal(isRecognitionPaused(db), true)
assert.equal((db.prepare("SELECT value FROM project_meta WHERE key='recognition_paused'").get() as { value: string }).value, '1')
assert.throws(() => setRecognitionPaused(db, 'false' as unknown as boolean))
assert.equal(isRecognitionPaused(db), true)
const box = { left: .2, top: .3, width: .1, height: .05 }
const blocks = [{ text: '2.36', box }, { text: '\uF6B3', box, ocrUnresolved: true }]
commitRecognizedPage(db, 13, blocks, 'PDF text layer + Tesseract')
assert.equal((db.prepare('SELECT COUNT(*) AS n FROM recognized_page WHERE page_idx=13').get() as { n: number }).n, 1)
assert.deepEqual(db.prepare('SELECT en_text,status FROM paragraph WHERE page_idx=13 ORDER BY sort_order').all(), [{ en_text: '2.36', status: 'todo' }, { en_text: '\uF6B3', status: 'review' }])
assert.match((db.prepare('SELECT content FROM paragraph_note').get() as { content: string }).content, /两次未识别到文字/)
commitRecognizedPage(db, 13, blocks, 'retry')
assert.equal((db.prepare('SELECT COUNT(*) AS n FROM paragraph WHERE page_idx=13').get() as { n: number }).n, 2)
commitRecognizedPage(db, 14, [{ text: 'Next page', box }], 'PDF text layer')
assert.equal(isRecognitionPaused(db), true, 'Saving recognition progress must not clear a user pause')
setRecognitionPaused(db, false)
assert.equal(isRecognitionPaused(db), false)
assert.equal((db.prepare('SELECT COUNT(*) AS n FROM recognized_page').get() as { n: number }).n, 2)
assert.deepEqual(db.prepare('SELECT * FROM paragraph WHERE id=1').get(), before)
db.close()
console.log('Unresolved OCR regions persist for review; page completion, next page, retry idempotency and existing translations preserved.')
