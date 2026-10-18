import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initializeRevisionHistory } from '../src/main/services/revision-history'
import { planBatch, createBatchJob, runBatch, getBatchJob, decideBatch, controlBatch, listBatchJobs, validateBatchStart } from '../src/main/services/batch-processing'

async function main() {
  const db = new Database(':memory:')
  db.exec(readFileSync('src/main/db/schema.sql', 'utf8'))
  db.pragma('recursive_triggers = ON')
  db.exec(`INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order) VALUES
    (1,0,'paragraph','A line.\nMore.','','todo',1),
    (2,0,'paragraph','A\nB','已有译文','todo',2),
    (3,0,'title','Title','','todo',3),
    (4,1,'paragraph','C\nD','','todo',4),
    (5,1,'paragraph','E\nF','已通过','done',5),
    (6,1,'paragraph','G\nH','存疑','review',6),
    (7,1,'paragraph','I\nJ','待审','doing',7);
    INSERT INTO project_meta VALUES('draft_translation_instructions','正式语体');`)
  initializeRevisionHistory(db)
  const row = (id: number) => db.prepare('SELECT * FROM paragraph WHERE id=?').get(id) as { en_text: string; zh_text: string; status: string }
  const before = [2,5,6,7].map(row)
  const clean = planBatch(db, { task: 'clean' })
  assert.equal(clean.existing, 4); assert.equal(clean.unchanged, 1)
  assert.deepEqual(clean.eligible.map(item => item.id), [1,4])
  const trial = createBatchJob(db, { task: 'clean' }, [4])
  assert.equal(trial.items[0].id, 4)
  await runBatch(db, trial.id, 1, false, async (_job, item) => ({ text: item.source.replace(/\n/g, ' ') }), () => true)
  assert.equal(row(4).en_text, 'C\nD', 'Trial must not change source')
  assert.equal(getBatchJob(db, trial.id).items[0].state, 'candidate')
  decideBatch(db, trial.id, [4], true)
  assert.equal(row(4).en_text, 'C D')
  await runBatch(db, trial.id, 100, true, async (_job, item) => ({ text: item.source.replace(/\n/g, ' ') }), () => true)
  assert.equal(row(1).en_text, 'A line. More.')
  assert.equal(planBatch(db, { task: 'clean' }).eligible.length, 0)
  assert.deepEqual([2,5,6,7].map(row), before)
  assert.ok(db.prepare("SELECT 1 FROM revision_event WHERE action='采用批量断行整理' AND before_json IS NOT NULL").get())

  db.prepare("INSERT INTO project_meta(key,value) VALUES('reference_profiles',?)").run(JSON.stringify([{name:'默认',instructions:''},{name:'正式',instructions:'正式语体'}]))
  const translation = createBatchJob(db, { task: 'translate', profileIndex: 1 })
  assert.equal(translation.instructions, '正式语体')
  let calls = 0
  await runBatch(db, translation.id, 1, false, async () => { calls++; return { text: '初稿' } }, () => true)
  assert.equal(calls, 1); assert.equal(row(1).zh_text, '')
  db.prepare("UPDATE paragraph SET zh_text='人工修订' WHERE id=1").run()
  decideBatch(db, translation.id, [1], true)
  assert.equal(row(1).zh_text, '人工修订'); assert.equal(getBatchJob(db, translation.id).items[0].state, 'skipped')
  await runBatch(db, translation.id, 100, true, async () => ({ text: '生成初稿' }), () => true)
  assert.equal(row(3).status, 'doing'); assert.equal(row(4).zh_text, '生成初稿')
  assert.deepEqual([2,5,6,7].map(row), before)

  db.prepare("UPDATE paragraph SET zh_text='' WHERE id IN (1,3,4)").run()
  const racing = createBatchJob(db, { task: 'translate' })
  let release!: (value: { text: string }) => void
  const running = runBatch(db, racing.id, 100, true, async () => new Promise(resolve => { release = resolve }), () => true)
  assert.throws(() => validateBatchStart(db, racing.id, 10, false), /已有批量任务/)
  controlBatch(db, racing.id, 'pause')
  assert.equal(getBatchJob(db, racing.id).inFlight, true)
  assert.throws(() => decideBatch(db, racing.id, [1], true), /等待/)
  db.prepare("UPDATE paragraph SET en_text='Human edit' WHERE id=1").run()
  release({ text: '不能覆盖' }); await running
  assert.equal(row(1).zh_text, ''); assert.equal(row(1).en_text, 'Human edit')
  assert.equal(getBatchJob(db, racing.id).items[0].state, 'skipped')
  assert.equal(getBatchJob(db, racing.id).items[1].state, 'pending', 'Pause must not start another request')
  await runBatch(db, racing.id, 1, true, async () => { controlBatch(db, racing.id, 'cancel'); return { text: '取消结果' } }, () => true)
  assert.equal(row(3).zh_text, '')

  const failed = createBatchJob(db, { task: 'translate' })
  await runBatch(db, failed.id, 1, true, async () => { throw new Error('Provider error') }, () => true)
  assert.equal(getBatchJob(db, failed.id).items[0].state, 'failed')
  controlBatch(db, failed.id, 'retry')
  assert.equal(getBatchJob(db, failed.id).items[0].state, 'pending')

  const interrupted = createBatchJob(db, { task: 'translate' })
  const metadata = JSON.parse((db.prepare('SELECT data FROM batch_job WHERE id=?').get(interrupted.id) as {data:string}).data)
  metadata.state = 'running'
  db.prepare('UPDATE batch_job SET data=? WHERE id=?').run(JSON.stringify(metadata), interrupted.id)
  const interruptedItem = interrupted.items[0]; interruptedItem.state = 'running'
  db.prepare('UPDATE batch_item SET data=? WHERE job_id=? AND paragraph_id=?').run(JSON.stringify(interruptedItem), interrupted.id, interruptedItem.id)
  const recovered = listBatchJobs(db).find(job => job.id === interrupted.id)!
  assert.equal(recovered.state, 'paused'); assert.equal(recovered.items[0].state, 'failed')

  const switched = createBatchJob(db, { task: 'translate' })
  let current = true
  await runBatch(db, switched.id, 100, true, async () => { current = false; return { text: 'Wrong project' } }, () => current)
  assert.equal(row(switched.items[0].id).zh_text, '')
  assert.equal(getBatchJob(db, switched.id).items[0].state, 'failed')
  db.prepare("INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order) VALUES(8,2,'paragraph','Poem\nline','','todo',8)").run()
  const unchanged = createBatchJob(db, { task: 'clean', from: 8, to: 8 })
  await runBatch(db, unchanged.id, 1, true, async () => ({ text: 'Poem\nline' }), () => true)
  assert.equal(planBatch(db, { task: 'clean', from: 8, to: 8 }).eligible.length, 0, 'Unchanged reviewed line breaks must not be charged again')
  db.prepare("UPDATE paragraph SET en_text='Poem\nnew line' WHERE id=8").run()
  const unsafe = createBatchJob(db, { task: 'clean', from: 8, to: 8 })
  await runBatch(db, unsafe.id, 1, true, async () => ({ text: 'Invented text' }), () => true)
  assert.equal(row(8).en_text, 'Poem\nnew line')
  assert.equal(getBatchJob(db, unsafe.id).items[0].state, 'failed')
  const repeatedFailures = createBatchJob(db, { task: 'translate' })
  let failureCount = 0
  await runBatch(db, repeatedFailures.id, 100, true, async () => { failureCount++; throw new Error('Rate limited') }, () => true)
  assert.equal(failureCount, 3)
  assert.equal(getBatchJob(db, repeatedFailures.id).state, 'paused')
  assert.ok(getBatchJob(db, repeatedFailures.id).items.some(item => item.state === 'pending'))
  db.prepare("UPDATE paragraph SET bbox_json='[0.1,0.1,0.3,0.3]' WHERE id IN (2,8)").run()
  const vision = createBatchJob(db,{task:'vision'})
  assert.deepEqual(vision.items.map(item => item.id),[8], 'Vision batch must skip existing translations and missing regions')
  assert.throws(() => validateBatchStart(db,vision.id,1,true), /手动采用/)
  const beforeVision = row(8).en_text
  await runBatch(db,vision.id,1,false,async () => ({text:'消費電力 2.36 kW'}),() => true)
  assert.equal(row(8).en_text,beforeVision, 'Vision output must remain a candidate')
  decideBatch(db,vision.id,[8],true)
  assert.equal(row(8).en_text,'消費電力 2.36 kW')
  assert.equal(row(8).zh_text,'')
  const staleVision = createBatchJob(db,{task:'vision'})
  await runBatch(db,staleVision.id,1,false,async () => ({text:'Must not overwrite changed regions'}),() => true)
  db.prepare("UPDATE paragraph SET bbox_json='[0.2,0.1,0.4,0.3]' WHERE id=8").run()
  decideBatch(db,staleVision.id,[8],true)
  assert.equal(getBatchJob(db,staleVision.id).items[0].state,'skipped')
  assert.equal(row(8).en_text,'消費電力 2.36 kW')
  const directory = mkdtempSync(join(tmpdir(), 'traloom-batch-persist-'))
  const file = join(directory, 'sample.twproj')
  await db.backup(file)
  const reopened = new Database(file)
  assert.equal(getBatchJob(reopened, repeatedFailures.id).state, 'paused')
  assert.equal(getBatchJob(reopened, unchanged.id).items[0].output, 'Poem\nline')
  reopened.close(); rmSync(directory, { recursive: true, force: true })
  db.close()
  console.log('Batch trials, range eligibility, existing-draft protection, history, concurrent edits, pause, cancellation, recovery and project-switch tests passed.')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
