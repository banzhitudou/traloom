import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { initializeRevisionHistory } from '../src/main/services/revision-history'
import { commitRecognizedPage } from '../src/main/services/pdf-recognition'
import { storeResource, readResource } from '../src/main/services/project-resources'

const db = new Database(':memory:')
db.exec(readFileSync('src/main/db/schema.sql', 'utf8'))
initializeRevisionHistory(db)
db.prepare("INSERT INTO project_meta VALUES('recognition_total','3')").run()
const blocks = [{ text: 'A small garden.', box: { left: .1, top: .2, width: .5, height: .1 } }]
commitRecognizedPage(db, 0, blocks, 'PDF')
db.prepare("UPDATE paragraph SET zh_text='一座小花园。',status='done' WHERE id=1").run()
commitRecognizedPage(db, 0, blocks, 'PDF')
assert.equal((db.prepare('SELECT COUNT(*) AS n FROM paragraph').get() as {n:number}).n,1)
assert.equal((db.prepare('SELECT zh_text FROM paragraph').get() as {zh_text:string}).zh_text,'一座小花园。')
commitRecognizedPage(db,1,[],'OCR')
assert.equal((db.prepare('SELECT COUNT(*) AS n FROM recognized_page').get() as {n:number}).n,2)
assert.throws(() => commitRecognizedPage(db,3,blocks,'PDF'))
assert.throws(() => commitRecognizedPage(db,2,[{text:'bad',box:{left:2,top:0,width:.2,height:.2}}],'PDF'))
assert.equal((db.prepare('SELECT COUNT(*) AS n FROM recognized_page').get() as {n:number}).n,2)
storeResource(db,'files/original.pdf',Buffer.from('%PDF-fixture'))
assert.equal(readResource(db,'files/original.pdf')?.toString(),'%PDF-fixture')
db.prepare("UPDATE project_resource SET content=?").run(Buffer.from('tampered'))
assert.throws(() => readResource(db,'files/original.pdf'),/校验/)
db.close()
console.log('Recognition resume, empty pages, idempotence, translation preservation, invalid coordinates, and embedded resource integrity passed.')
