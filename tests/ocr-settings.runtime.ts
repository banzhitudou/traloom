import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { initializeRevisionHistory } from '../src/main/services/revision-history'
import { getOcrSettings, saveOcrSettings } from '../src/main/services/ocr-settings'
const db = new Database(':memory:')
db.exec(readFileSync('src/main/db/schema.sql','utf8'))
initializeRevisionHistory(db)
db.exec("INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order) VALUES(1,0,'paragraph','Original','人工译文','done',1)")
const before = db.prepare('SELECT * FROM paragraph').all()
assert.equal(getOcrSettings(db).language,'eng')
saveOcrSettings(db,{language:'jpn',direction:'vertical'})
assert.deepEqual(getOcrSettings(db),{language:'jpn',direction:'vertical'})
assert.deepEqual(db.prepare('SELECT * FROM paragraph').all(),before)
assert.throws(() => saveOcrSettings(db,{language:'eng',direction:'vertical'}))
assert.deepEqual(getOcrSettings(db),{language:'jpn',direction:'vertical'})
db.close()
console.log('OCR settings persist independently and never re-recognize or modify existing source/translations.')
