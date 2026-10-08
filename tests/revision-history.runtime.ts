import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { initializeRevisionHistory, withRevisionContext, recordGeneration, finishGeneration, recordDecision, revisionRow } from '../src/main/services/revision-history'

const db = new Database(':memory:')
db.exec(readFileSync('src/main/db/schema.sql', 'utf8'))
db.pragma('recursive_triggers = ON')
db.exec(`INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order) VALUES
  (1,0,'paragraph','Rice is food.','初稿','doing',1),(2,0,'paragraph','Maize is food.','玉米','todo',2);
  INSERT INTO paragraph_note VALUES(1,'旧备注');
  INSERT INTO glossary VALUES(1,'术语','Rice','大米','');
  INSERT INTO project_meta VALUES('style_guide_text','儿童读物');`)
const events = () => db.prepare('SELECT * FROM revision_event ORDER BY id').all() as Record<string, unknown>[]
const last = () => revisionRow(events().at(-1)!, db)
initializeRevisionHistory(db)
const baselineCount = events().length
assert.equal(baselineCount, 5)
assert.equal(last().source, 'unknown')
initializeRevisionHistory(db)
assert.equal(events().length, baselineCount)

withRevisionContext(db, '修改译文', 'human', {}, () => db.prepare('UPDATE paragraph SET zh_text=? WHERE id=1').run('修订稿'))
assert.equal(last().before?.zh_text, '初稿')
assert.equal(last().after?.zh_text, '修订稿')
assert.equal(last().before?.note, '旧备注')
assert.equal(last().sequenceBefore, 1)
assert.equal(last().sequenceAfter, 1)
assert.match(last().createdAt, /^\d{4}-.*Z$/)
const environment = JSON.parse((db.prepare('SELECT snapshot_json FROM revision_environment WHERE id=?').get(last().contextId) as { snapshot_json: string }).snapshot_json)
assert.equal(environment.glossary[0].zh, '大米')
const count = events().length
db.prepare('UPDATE paragraph SET zh_text=? WHERE id=1').run('修订稿')
assert.equal(events().length, count, 'No duplicate events for unchanged saves')
withRevisionContext(db, '修改段落备注', 'human', {}, () => {
  db.prepare('INSERT INTO paragraph_note(paragraph_id,content) VALUES(?,?) ON CONFLICT(paragraph_id) DO UPDATE SET content=excluded.content').run(1,'旧备注')
  db.prepare('INSERT INTO paragraph_note(paragraph_id,content) VALUES(?,?) ON CONFLICT(paragraph_id) DO UPDATE SET content=excluded.content').run(1,'备注修订')
})
assert.equal(last().before?.content, '旧备注')
assert.equal(last().after?.content, '备注修订')
const afterNoteCount = events().length
assert.throws(() => db.transaction(() => { db.prepare('UPDATE paragraph SET zh_text=? WHERE id=1').run('不应保存'); throw new Error('rollback') })())
assert.equal(events().length, afterNoteCount)
assert.equal((db.prepare('SELECT zh_text FROM paragraph WHERE id=1').get() as {zh_text:string}).zh_text, '修订稿')

withRevisionContext(db, '批量状态', 'human', { ids: [1,2] }, () => db.prepare("UPDATE paragraph SET status='review'").run())
assert.equal(events().at(-1)?.operation_id, events().at(-2)?.operation_id)
assert.equal(last().metadata.ids instanceof Array, true)
db.prepare("INSERT INTO glossary_change(glossary_id,action,old_en,new_en,old_zh,new_zh) VALUES(1,'update','Rice','Rice','米','大米')").run()
withRevisionContext(db, '处理术语影响', 'human', { action: 'kept' }, () => {
  db.prepare('INSERT OR IGNORE INTO glossary_review(change_id,paragraph_id) VALUES(1,1)').run()
  db.prepare("UPDATE glossary_review SET status='kept' WHERE paragraph_id=1").run()
})
assert.equal(last().kind, 'term_review')
assert.equal(last().before?.status, 'pending')
assert.equal(last().after?.status, 'kept')
withRevisionContext(db, '修改项目备注', 'human', {}, () => {
  db.prepare("INSERT INTO project_meta VALUES('project_note',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run('初始项目备注')
  db.prepare("INSERT INTO project_meta VALUES('project_note',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run('项目备注修订')
})
assert.equal(last().before?.value, '初始项目备注')
const request = recordGeneration(db, { paragraphId: 1, task: 'translation_options', input: 'input'.repeat(3000), model: { model: 'test', maxTokens: 10000 } })
const requestContext = last().contextId
db.prepare('UPDATE glossary SET zh=? WHERE id=1').run('米饭')
const response = finishGeneration(db, request, { text: 'output'.repeat(3000) })
assert.equal(last().contextId, requestContext, 'Response retains request-time glossary')
assert.equal(last().after?.output, 'output'.repeat(3000))
assert.equal(last().after?.messages, 'input'.repeat(3000))
withRevisionContext(db, '采用 AI 译文参考', 'human', { generationId: response }, () => recordDecision(db, last().entityUuid, 1, { candidateIndex: 0 }))
assert.equal(last().kind, 'decision')

const identity = (db.prepare("SELECT uuid FROM revision_identity WHERE kind='paragraph' AND entity_id='1' AND active=1").get() as {uuid:string}).uuid
withRevisionContext(db, '删除翻译段', 'human', {}, () => db.prepare('DELETE FROM paragraph WHERE id=1').run())
const deletion = events().findLast(row => row.kind === 'paragraph' && row.entity_id === '1')!
assert.equal(revisionRow(deletion, db).before?.note, '备注修订')
assert.equal(revisionRow(deletion, db).liveParagraphId, null)
assert.equal((db.prepare('SELECT count(*) AS n FROM paragraph_note').get() as {n:number}).n, 0)
db.prepare("INSERT INTO paragraph(id,page_idx,type,en_text,sort_order) VALUES(1,0,'paragraph','New entity',1)").run()
assert.notEqual(last().entityUuid, identity)
assert.equal(revisionRow(deletion, db).liveParagraphId, null, 'Reused numeric ID must not link old history to new entity')
db.prepare('INSERT INTO revision_annotation(revision_id,category,reason) VALUES(?,?,?)').run(response, '纠正误译', '量词')
assert.equal(last().kind, 'annotation')
assert.throws(() => db.prepare('DELETE FROM revision_event WHERE id=?').run(response), /不能删除/)
assert.throws(() => db.prepare('UPDATE revision_event SET action=? WHERE id=?').run('changed', response), /只允许追加/)
assert.equal(db.pragma('foreign_key_check').length, 0)
initializeRevisionHistory(db)
db.prepare('UPDATE paragraph SET en_text=? WHERE id=1').run('New source')
assert.equal(last().before?.en_text, 'New entity')
db.close()
console.log('Revision baseline, atomic rollback, deduplication, snapshots, bulk grouping, long AI evidence, adoption, deletion, ID reuse and append-only guards passed.')
