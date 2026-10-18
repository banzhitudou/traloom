import type { Database } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { validateReferenceSettings, migrateReferenceSettings } from '../../shared/reference-settings'
import { DEFAULT_REFERENCE_INSTRUCTIONS } from '../../shared/translation-prompts'
import { parseNormalizedBboxes } from '../../shared/bbox'
import { canApplyBatch, validateBatchScope, validateCleanedText, type BatchJob, type BatchPlan, type BatchScope, type BatchCandidate } from '../../shared/batch-processing'
import { recordDecision, withRevisionContext } from './revision-history'

const active = new WeakMap<Database, string>()
const serialized = new WeakMap<Database, Map<string, string>>()
function initialize(db: Database) {
  db.exec('CREATE TABLE IF NOT EXISTS batch_job (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
  db.exec('CREATE TABLE IF NOT EXISTS batch_item (job_id TEXT NOT NULL, position INTEGER NOT NULL, paragraph_id INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(job_id,paragraph_id))')
}
function persist(db: Database, job: BatchJob) {
  let cache = serialized.get(db)
  if (!cache) { cache = new Map(); serialized.set(db, cache) }
  const { items, inFlight: _inFlight, ...metadata } = job
  const changes: [string, string][] = []
  db.transaction(() => {
    db.prepare('INSERT INTO batch_job(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id, JSON.stringify(metadata))
    const save = db.prepare('INSERT INTO batch_item(job_id,position,paragraph_id,data) VALUES(?,?,?,?) ON CONFLICT(job_id,paragraph_id) DO UPDATE SET data=excluded.data,position=excluded.position')
    items.forEach((item, position) => {
      const key = `${job.id}:${item.id}`, data = JSON.stringify(item)
      if (cache!.get(key) !== data) { save.run(job.id, position, item.id, data); changes.push([key, data]) }
    })
  })()
  for (const [key, data] of changes) cache.set(key, data)
}
function readItems(db: Database, id: string): BatchCandidate[] {
  return (db.prepare('SELECT data FROM batch_item WHERE job_id=? ORDER BY position').all(id) as { data: string }[]).map(row => JSON.parse(row.data) as BatchCandidate)
}
function liveParagraph(db: Database, id: number) {
  return db.prepare("SELECT p.en_text,p.zh_text,p.status,p.bbox_json,coalesce(i.uuid,'') AS identity FROM paragraph p LEFT JOIN revision_identity i ON i.kind='paragraph' AND i.entity_id=cast(p.id AS TEXT) AND i.active=1 WHERE p.id=?").get(id) as { en_text: string; zh_text: string; status: string; identity: string; bbox_json: string } | undefined
}
export function listBatchJobs(db: Database): BatchJob[] {
  initialize(db)
  const jobs = (db.prepare('SELECT id,data FROM batch_job ORDER BY rowid DESC LIMIT 20').all() as { id: string; data: string }[]).map(row => ({ ...JSON.parse(row.data), items: readItems(db, row.id), inFlight: active.get(db) === row.id }) as BatchJob)
  for (const job of jobs) if (job.state === 'running' && active.get(db) !== job.id) {
    job.state = 'paused'; job.message = '上次运行已中断。未收到结果的请求可能已产生费用，请核对后重试。'
    for (const item of job.items) if (item.state === 'running') { item.state = 'failed'; item.error = '请求中断，结果未知；重试可能再次计费。' }
    persist(db, job)
  }
  return jobs
}
export function getBatchJob(db: Database, id: string): BatchJob {
  if (typeof id !== 'string' || id.length > 100) throw new Error('任务编号无效。')
  initialize(db)
  const row = db.prepare('SELECT data FROM batch_job WHERE id=?').get(id) as { data: string } | undefined
  if (!row) throw new Error('批量任务不存在。')
  const job = { ...JSON.parse(row.data), items: readItems(db, id), inFlight: active.get(db) === id } as BatchJob
  if (job.state === 'running' && !job.inFlight) {
    job.state = 'paused'; job.message = '上次运行中断；结果未知的请求可能已经计费。'
    for (const item of job.items) if (item.state === 'running') { item.state = 'failed'; item.error = '上次请求中断，重试可能再次计费。' }
    persist(db, job)
  }
  return job
}
export function planBatch(db: Database, input: BatchScope): BatchPlan {
  initialize(db)
  const rows = db.prepare("SELECT p.*,coalesce(i.uuid,'') AS identity FROM paragraph p LEFT JOIN revision_identity i ON i.kind='paragraph' AND i.entity_id=cast(p.id AS TEXT) AND i.active=1 ORDER BY p.page_idx,p.sort_order,p.id").all() as { id: number; page_idx: number; en_text: string; zh_text: string; status: string; identity: string; bbox_json: string }[]
  const scope = validateBatchScope(input, rows.length)
  const cleaned = new Map<string, string>()
  if (scope.task === 'clean') for (const row of db.prepare("SELECT i.data FROM batch_item i JOIN batch_job j ON j.id=i.job_id WHERE json_extract(j.data,'$.task')='clean' AND json_extract(i.data,'$.state')='applied' ORDER BY j.rowid").iterate() as Iterable<{ data: string }>) {
    const item = JSON.parse(row.data) as BatchCandidate
    if (item.output) cleaned.set(`${item.id}:${item.identity}`, item.output)
  }
  const plan: BatchPlan = { eligible: [], total: scope.to! - scope.from! + 1, existing: 0, unchanged: 0, empty: 0, characters: 0 }
  rows.forEach((row, index) => {
    if (index + 1 < scope.from! || index + 1 > scope.to!) return
    if (row.zh_text.trim()) { plan.existing++; return }
    if (scope.task === 'vision' && (!parseNormalizedBboxes(row.bbox_json).length || parseNormalizedBboxes(row.bbox_json).length > 16)) { plan.empty++; return }
    if (!row.en_text.trim()) { plan.empty++; return }
    if (scope.task === 'clean' && (!/[\r\n]/.test(row.en_text) || cleaned.get(`${row.id}:${row.identity}`) === row.en_text)) { plan.unchanged++; return }
    plan.characters += row.en_text.length
    plan.eligible.push({ id: row.id, sequence: index + 1, pageIdx: row.page_idx, source: row.en_text, draft: row.zh_text, status: row.status, identity: row.identity, state: 'pending', ...(scope.task === 'vision' ? {bboxJson:row.bbox_json} : {}) })
  })
  return plan
}
export function createBatchJob(db: Database, scope: BatchScope, sampleIds: number[] = []): BatchJob {
  if (active.has(db)) throw new Error('请先暂停当前任务，并等待当前请求结束。')
  if (!Array.isArray(sampleIds) || sampleIds.length > 100000 || sampleIds.some(id => !Number.isInteger(id)) || new Set(sampleIds).size !== sampleIds.length) throw new Error('试处理段落无效。')
  const plan = planBatch(db, scope)
  if (!plan.eligible.length) throw new Error('没有符合条件的段落。')
  if (sampleIds.some(id => !plan.eligible.some(item => item.id === id))) throw new Error('所选段落已变化，请重新核对范围。')
  const ordered = [...plan.eligible.filter(item => sampleIds.includes(item.id)), ...plan.eligible.filter(item => !sampleIds.includes(item.id))]
  const meta = Object.fromEntries((db.prepare("SELECT key,value FROM project_meta WHERE key IN ('reference_profiles','reference_count','reference_instructions')").all() as { key: string; value: string }[]).map(row => [row.key,row.value]))
  const settings = meta.reference_profiles ? validateReferenceSettings({ count: JSON.parse(meta.reference_profiles).length, profiles: JSON.parse(meta.reference_profiles) }) : migrateReferenceSettings(Number(meta.reference_count || 1), meta.reference_instructions || '')
  const profileIndex = scope.profileIndex ?? 0
  if (!Number.isSafeInteger(profileIndex) || !settings.profiles[profileIndex]) throw new Error('请选择有效的译文参考方案。')
  const instructions = settings.profiles[profileIndex].instructions || DEFAULT_REFERENCE_INSTRUCTIONS
  const job: BatchJob = { id: randomUUID(), task: scope.task, instructions, items: ordered, state: 'paused', createdAt: new Date().toISOString(), message: '' }
  persist(db, job); return job
}
function applyItem(db: Database, job: BatchJob, item: BatchCandidate, automatic: boolean) {
  if (typeof item.output !== 'string' || !item.output.trim() || item.output.length > 200000) throw new Error('候选结果无效，请重新生成。')
  if (!canApplyBatch(item, liveParagraph(db, item.id))) { item.state = 'skipped'; item.error = '原文、译文或状态已变化，未覆盖手工修改。'; return }
  withRevisionContext(db, job.task === 'vision' ? '采用批量视觉识别' : job.task === 'clean' ? '采用批量断行整理' : '采用批量译文初稿', automatic ? 'ai' : 'human', { jobId: job.id, generationId: item.generationId, instructions: job.instructions }, () => db.transaction(() => {
    if (job.task !== 'translate') db.prepare("UPDATE paragraph SET en_text=?,status=CASE WHEN status='done' THEN 'review' ELSE status END WHERE id=?").run(item.output, item.id)
    else db.prepare("UPDATE paragraph SET zh_text=?,status='doing' WHERE id=?").run(item.output, item.id)
    recordDecision(db, item.identity, item.id, { jobId: job.id, generationId: item.generationId, task: job.task, output: item.output, automatic })
    item.state = 'applied'
  })())
}
export function decideBatch(db: Database, id: string, ids: number[], adopt: boolean): BatchJob {
  if (!Array.isArray(ids) || ids.length > 100000 || ids.some(value => !Number.isInteger(value)) || typeof adopt !== 'boolean') throw new Error('采用参数无效。')
  const job = getBatchJob(db, id)
  if (job.state === 'running' || job.inFlight) throw new Error('请等待当前请求结束后再采用结果。')
  db.transaction(() => {
    for (const item of job.items) if (item.state === 'candidate' && ids.includes(item.id)) {
      if (adopt) applyItem(db, job, item, false)
      else item.state = 'discarded'
    }
    persist(db, job)
  })()
  return job
}
export function controlBatch(db: Database, id: string, action: 'pause' | 'cancel' | 'retry'): BatchJob {
  if (!['pause', 'cancel', 'retry'].includes(action)) throw new Error('任务操作无效。')
  const job = getBatchJob(db, id)
  if (action === 'retry' && (job.state === 'running' || active.has(db))) throw new Error('请等待当前请求结束。')
  if (action === 'cancel') job.state = 'cancelled'
  else job.state = 'paused'
  if (action === 'retry') for (const item of job.items) if (item.state === 'failed' || item.state === 'discarded') { item.state = 'pending'; item.error = undefined }
  job.message = action === 'pause' ? '正在结束当前请求；暂停后不会发起新请求。' : action === 'cancel' ? '已取消后续请求；已采用的结果保留。' : '失败或放弃项已加入队列；重新调用可能再次计费。'
  persist(db, job); return job
}
export async function runBatch(db: Database, id: string, limit: number, autoApply: boolean, generate: (job: BatchJob, item: BatchCandidate) => Promise<{ text: string; generationId?: number }>, isCurrent: () => boolean): Promise<void> {
  const initial = validateBatchStart(db, id, limit, autoApply)
  active.set(db, id); initial.state = 'running'; initial.message = ''; persist(db, initial)
  let attempted = 0, failures = 0
  try {
    while (attempted < limit && db.open && isCurrent()) {
      let job = getBatchJob(db, id)
      if (job.state !== 'running') break
      const item = job.items.find(item => item.state === 'pending')
      if (!item) break
      if (!canApplyBatch(item, liveParagraph(db, item.id))) { item.state = 'skipped'; item.error = '段落已变化，已跳过。'; persist(db, job); continue }
      item.state = 'running'; persist(db, job); attempted++
      try {
        const result = await generate(job, item)
        if (!db.open || !isCurrent()) break
        job = getBatchJob(db, id)
        const current = job.items.find(row => row.id === item.id)!
        if (job.state === 'cancelled') { current.state = 'discarded'; persist(db, job); break }
        if (!result.text.trim() || result.text.length > 200000) throw new Error('模型结果为空或过长。')
        if (job.task === 'clean') validateCleanedText(item.source, result.text)
        current.output = result.text; current.generationId = result.generationId
        if (!canApplyBatch(current, liveParagraph(db, current.id))) { current.state = 'skipped'; current.error = '处理期间段落已变化，结果未覆盖原文或译文。' }
        else { current.state = 'candidate'; if (autoApply) applyItem(db, job, current, true) }
        failures = 0; persist(db, job)
      } catch (error) {
        if (!db.open || !isCurrent()) break
        job = getBatchJob(db, id)
        const current = job.items.find(row => row.id === item.id)!
        current.state = 'failed'; current.error = String(error); failures++
        if (failures >= 3) { job.state = 'paused'; job.message = '连续三段失败，已暂停以避免继续产生费用。' }
        persist(db, job)
      }
    }
  } finally {
    if (db.open) {
      const job = getBatchJob(db, id)
      for (const item of job.items) if (item.state === 'running') { item.state = 'failed'; item.error = '请求中断或工程切换，结果未写入；重试可能再次计费。' }
      if (job.state === 'running') job.state = job.items.some(item => item.state === 'pending' || item.state === 'failed') ? 'paused' : 'completed'
      persist(db, job)
    }
    active.delete(db)
  }
}

export function validateBatchStart(db: Database, id: string, limit: number, autoApply: boolean): BatchJob {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000 || typeof autoApply !== 'boolean') throw new Error('处理数量无效。')
  if (active.has(db)) throw new Error('已有批量任务正在处理，请等待当前请求结束。')
  const job = getBatchJob(db, id)
  if (job.task === 'vision' && autoApply) throw new Error('视觉识别结果必须预览后手动采用。')
  if (job.state === 'cancelled') throw new Error('该任务已取消，请新建任务。')
  if (!job.items.some(item => item.state === 'pending')) throw new Error('没有待处理项，请先准备重试或新建任务。')
  return job
}
