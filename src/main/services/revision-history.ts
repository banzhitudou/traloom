import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { RevisionEntry, RevisionSource } from '../../shared/revisions'

interface HistoryContext { operation: string; action: string; source: RevisionSource; metadata: string; environment: string; contextId: string }
const scope = new AsyncLocalStorage<HistoryContext>()
const emptyEnvironment = JSON.stringify({ provenance: 'unknown' })
const emptyContextId = createHash('sha256').update(emptyEnvironment).digest('hex')

function environment(db: Database): string {
  const meta = db.prepare("SELECT key, value FROM project_meta WHERE key IN ('book_title','src_lang','tgt_lang','style_guide_text','pdf_path','json_path','name_dict_csv_path','place_dict_xlsx_path') ORDER BY key").all()
  const glossary = db.prepare('SELECT id, category, en, zh, note FROM glossary ORDER BY id').all()
  return JSON.stringify({ meta, glossary })
}

export function withRevisionContext<T>(db: Database, action: string, source: RevisionSource, metadata: Record<string, unknown>, work: () => T): T {
  const context = environment(db)
  return scope.run({ operation: randomUUID(), action, source, metadata: JSON.stringify(metadata), environment: context, contextId: createHash('sha256').update(context).digest('hex') }, work)
}

export function configureRevisionFunctions(db: Database): void {
  db.function('revision_context_id', () => scope.getStore()?.contextId ?? emptyContextId)
  db.function('revision_environment', () => scope.getStore()?.environment ?? emptyEnvironment)
  db.function('revision_operation', () => scope.getStore()?.operation ?? randomUUID())
  db.function('revision_action', () => scope.getStore()?.action ?? '')
  db.function('revision_source', () => scope.getStore()?.source ?? 'unknown')
  db.function('revision_metadata', () => scope.getStore()?.metadata ?? '{}')
}

export function initializeRevisionHistory(db: Database): void {
  configureRevisionFunctions(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS revision_environment (id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revision_identity (
      uuid TEXT PRIMARY KEY, kind TEXT NOT NULL, entity_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_revision_identity_active ON revision_identity(kind, entity_id) WHERE active = 1;
    CREATE TABLE IF NOT EXISTS revision_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL, created_at TEXT NOT NULL,
      kind TEXT NOT NULL, entity_id TEXT NOT NULL, entity_uuid TEXT NOT NULL,
      action TEXT NOT NULL, source TEXT NOT NULL, before_json TEXT, after_json TEXT,
      sequence_before INTEGER, sequence_after INTEGER, metadata_json TEXT NOT NULL,
      context_id TEXT NOT NULL REFERENCES revision_environment(id), neighbors_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_revision_event_entity ON revision_event(entity_uuid, id);
    CREATE INDEX IF NOT EXISTS idx_revision_event_operation ON revision_event(operation_id, id);
    CREATE INDEX IF NOT EXISTS idx_revision_event_time ON revision_event(created_at, id);
    CREATE TABLE IF NOT EXISTS revision_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revision_annotation (revision_id INTEGER PRIMARY KEY REFERENCES revision_event(id), category TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '');
  `)
  const paragraphJson = (row: string) => `json_object('id',${row}.id,'page_idx',${row}.page_idx,'type',${row}.type,'en_text',${row}.en_text,'zh_text',${row}.zh_text,'status',${row}.status,'sort_order',${row}.sort_order,'bbox_json',${row}.bbox_json,'raw_block',${row}.raw_block,'note',COALESCE((SELECT content FROM paragraph_note WHERE paragraph_id=${row}.id),''))`
  const sequence = (row: string) => `(SELECT count(*)+1 FROM paragraph p WHERE p.id != ${row}.id AND (p.page_idx,p.sort_order,p.id)<(${row}.page_idx,${row}.sort_order,${row}.id))`
  const neighbors = (row: string) => `(SELECT json_group_array(json_object('id',id,'page_idx',page_idx,'en_text',en_text,'zh_text',zh_text,'sort_order',sort_order)) FROM (SELECT * FROM paragraph WHERE page_idx=${row}.page_idx AND id!=${row}.id ORDER BY abs(sort_order-${row}.sort_order),id LIMIT 4))`
  const contextInsert = 'INSERT INTO revision_environment(id,snapshot_json) VALUES(revision_context_id(),revision_environment()) ON CONFLICT(id) DO NOTHING;'
  const insert = (kind: string, entityId: string, uuid: string, action: string, before: string, after: string, seqBefore = 'NULL', seqAfter = 'NULL', nearby = "'[]'") => `${contextInsert}
    INSERT INTO revision_event(operation_id,created_at,kind,entity_id,entity_uuid,action,source,before_json,after_json,sequence_before,sequence_after,metadata_json,context_id,neighbors_json)
    VALUES(revision_operation(),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'${kind}',${entityId},${uuid},COALESCE(NULLIF(revision_action(),''),'${action}'),revision_source(),${before},${after},${seqBefore},${seqAfter},revision_metadata(),revision_context_id(),${nearby});`
  const identity = (kind: string, id: string) => `(SELECT uuid FROM revision_identity WHERE kind='${kind}' AND entity_id=CAST(${id} AS TEXT) AND active=1)`
  const newIdentity = (kind: string, id: string) => `INSERT INTO revision_identity(uuid,kind,entity_id) SELECT lower(hex(randomblob(16))),'${kind}',CAST(${id} AS TEXT) WHERE NOT EXISTS (SELECT 1 FROM revision_identity WHERE kind='${kind}' AND entity_id=CAST(${id} AS TEXT) AND active=1);`
  const tables = [
    { table: 'paragraph', kind: 'paragraph', key: 'id', json: paragraphJson, seq: sequence, nearby: neighbors, name: '翻译段', watched: '' },
    { table: 'glossary', kind: 'glossary', key: 'id', json: (r: string) => `json_object('id',${r}.id,'en',${r}.en,'zh',${r}.zh,'category',${r}.category,'note',${r}.note)`, name: '项目术语', watched: '' },
    { table: 'project_document', kind: 'document', key: 'id', json: (r: string) => `json_object('id',${r}.id,'path',${r}.path,'title',${r}.title,'kind',${r}.kind,'content',${r}.content)`, name: '项目文档', watched: '' },
    { table: 'project_meta', kind: 'project', key: 'key', json: (r: string) => `json_object('key',${r}.key,'value',${r}.value)`, name: '项目内容', watched: "IN ('book_title','src_lang','tgt_lang','style_guide_text','project_note')" }
  ]
  // Baselines and installation are atomic; reopening never creates a second baseline.
  db.transaction(() => {
    for (const table of ['paragraph', 'glossary', 'project_document', 'project_meta', 'note', 'annotation', 'term_review']) {
      for (const operation of ['insert', 'update', 'delete']) db.exec(`DROP TRIGGER IF EXISTS revision_${table}_${operation}`)
    }
    if (!db.prepare("SELECT 1 FROM revision_settings WHERE key='enabled_at'").get()) {
      withRevisionContext(db, '启用基线', 'unknown', { priorHistory: 'unavailable' }, () => {
        for (const item of tables) {
          const where = item.watched ? `WHERE p.${item.key} ${item.watched}` : ''
          db.exec(`INSERT INTO revision_identity(uuid,kind,entity_id) SELECT lower(hex(randomblob(16))),'${item.kind}',CAST(p.${item.key} AS TEXT) FROM ${item.table} p ${where};`)
          db.exec(`${contextInsert} INSERT INTO revision_event(operation_id,created_at,kind,entity_id,entity_uuid,action,source,before_json,after_json,sequence_before,sequence_after,metadata_json,context_id,neighbors_json)
            SELECT revision_operation(),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'${item.kind}',CAST(p.${item.key} AS TEXT),${identity(item.kind, `p.${item.key}`)},'启用基线','unknown',NULL,${item.json('p')},NULL,${item.seq?.('p') ?? 'NULL'},revision_metadata(),revision_context_id(),${item.nearby?.('p') ?? "'[]'"} FROM ${item.table} p ${where};`)
        }
        db.exec(`${contextInsert} INSERT INTO revision_event(operation_id,created_at,kind,entity_id,entity_uuid,action,source,before_json,after_json,sequence_before,sequence_after,metadata_json,context_id)
          SELECT revision_operation(),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'paragraph_note',CAST(paragraph_id AS TEXT),${identity('paragraph', 'paragraph_id')},'启用基线','unknown',NULL,json_object('content',content),NULL,NULL,revision_metadata(),revision_context_id() FROM paragraph_note;`)
      })
      db.prepare("INSERT INTO revision_settings(key,value) VALUES('enabled_at',?),('project_uuid',?)").run(new Date().toISOString(), randomUUID())
    }
    for (const item of tables) {
      const watch = item.watched ? `NEW.${item.key} ${item.watched} AND ` : ''
      const deleteWatch = item.watched ? `WHEN OLD.${item.key} ${item.watched}` : ''
      db.exec(`CREATE TRIGGER IF NOT EXISTS revision_${item.table}_insert AFTER INSERT ON ${item.table} ${item.watched ? `WHEN NEW.${item.key} ${item.watched}` : ''} BEGIN
        ${newIdentity(item.kind, `NEW.${item.key}`)}
        ${insert(item.kind, `NEW.${item.key}`, identity(item.kind, `NEW.${item.key}`), `新增${item.name}`, 'NULL', item.json('NEW'), 'NULL', item.seq?.('NEW'), item.nearby?.('NEW'))}
      END;
      CREATE TRIGGER IF NOT EXISTS revision_${item.table}_update AFTER UPDATE ON ${item.table} WHEN ${watch}${item.json('OLD')} != ${item.json('NEW')} BEGIN
        ${insert(item.kind, `NEW.${item.key}`, identity(item.kind, `NEW.${item.key}`), `修改${item.name}`, item.json('OLD'), item.json('NEW'), item.seq?.('OLD'), item.seq?.('NEW'), item.nearby?.('NEW'))}
      END;
      CREATE TRIGGER IF NOT EXISTS revision_${item.table}_delete BEFORE DELETE ON ${item.table} ${deleteWatch} BEGIN
        ${insert(item.kind, `OLD.${item.key}`, identity(item.kind, `OLD.${item.key}`), `删除${item.name}`, item.json('OLD'), 'NULL', item.seq?.('OLD'), 'NULL', item.nearby?.('OLD'))}
        UPDATE revision_identity SET active=0 WHERE uuid=${identity(item.kind, `OLD.${item.key}`)};
      END;`)
    }
    for (const [op, before, after, condition] of [
      ['insert', 'NULL', "json_object('content',NEW.content)", ''],
      ['update', "json_object('content',OLD.content)", "json_object('content',NEW.content)", 'WHEN OLD.content != NEW.content'],
      ['delete', "json_object('content',OLD.content)", 'NULL', '']
    ]) {
      const row = op === 'delete' ? 'OLD' : 'NEW'
      db.exec(`CREATE TRIGGER IF NOT EXISTS revision_note_${op} AFTER ${op.toUpperCase()} ON paragraph_note ${condition} BEGIN
        ${insert('paragraph_note', `${row}.paragraph_id`, `(SELECT uuid FROM revision_identity WHERE kind='paragraph' AND entity_id=CAST(${row}.paragraph_id AS TEXT) ORDER BY active DESC,rowid DESC LIMIT 1)`, '修改段落备注', before, after)}
      END;`)
    }
    const reviewJson = (row: string) => `json_object('review_id',${row}.id,'change_id',${row}.change_id,'paragraph_id',${row}.paragraph_id,'status',${row}.status,'previous_zh',${row}.previous_zh)`
    const acceptanceJson = (row: string) => `json_object('glossary_id',${row}.glossary_id,'paragraph_id',${row}.paragraph_id,'en',${row}.en,'zh',${row}.zh,'en_text',${row}.en_text,'zh_text',${row}.zh_text)`
    for (const operation of ['insert', 'update', 'delete']) {
      const row = operation === 'delete' ? 'OLD' : 'NEW'
      db.exec(`CREATE TRIGGER IF NOT EXISTS revision_term_acceptance_${operation} AFTER ${operation.toUpperCase()} ON glossary_acceptance BEGIN
        ${insert('term_review', `${row}.paragraph_id`, `(SELECT uuid FROM revision_identity WHERE kind='paragraph' AND entity_id=CAST(${row}.paragraph_id AS TEXT) ORDER BY active DESC,rowid DESC LIMIT 1)`, '修改此处译名认可', operation === 'insert' ? 'NULL' : acceptanceJson('OLD'), operation === 'delete' ? 'NULL' : acceptanceJson('NEW'))}
      END;`)
    }
    for (const operation of ['insert', 'update', 'delete']) {
      const row = operation === 'delete' ? 'OLD' : 'NEW'
      const condition = operation === 'update' ? 'WHEN OLD.status!=NEW.status OR OLD.previous_zh IS NOT NEW.previous_zh' : ''
      db.exec(`CREATE TRIGGER IF NOT EXISTS revision_term_review_${operation} AFTER ${operation.toUpperCase()} ON glossary_review ${condition} BEGIN
        ${insert('term_review', `${row}.paragraph_id`, `(SELECT uuid FROM revision_identity WHERE kind='paragraph' AND entity_id=CAST(${row}.paragraph_id AS TEXT) ORDER BY active DESC,rowid DESC LIMIT 1)`, '处理术语影响', operation === 'insert' ? 'NULL' : reviewJson('OLD'), operation === 'delete' ? 'NULL' : reviewJson('NEW'))}
      END;`)
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS revision_event_immutable_update BEFORE UPDATE ON revision_event BEGIN SELECT RAISE(ABORT,'修订记录只允许追加'); END;
      CREATE TRIGGER IF NOT EXISTS revision_event_immutable_delete BEFORE DELETE ON revision_event BEGIN SELECT RAISE(ABORT,'修订记录不能删除'); END;
      CREATE TRIGGER IF NOT EXISTS revision_annotation_insert AFTER INSERT ON revision_annotation BEGIN
        ${insert('annotation', 'NEW.revision_id', "(SELECT entity_uuid FROM revision_event WHERE id=NEW.revision_id)", '填写修订说明', 'NULL', "json_object('revision_id',NEW.revision_id,'category',NEW.category,'reason',NEW.reason)")}
      END;
      CREATE TRIGGER IF NOT EXISTS revision_annotation_update AFTER UPDATE ON revision_annotation WHEN OLD.category!=NEW.category OR OLD.reason!=NEW.reason BEGIN
        ${insert('annotation', 'NEW.revision_id', "(SELECT entity_uuid FROM revision_event WHERE id=NEW.revision_id)", '修改修订说明', "json_object('revision_id',OLD.revision_id,'category',OLD.category,'reason',OLD.reason)", "json_object('revision_id',NEW.revision_id,'category',NEW.category,'reason',NEW.reason)")}
      END;`)
  })()
}

export function revisionRow(row: Record<string, unknown>, db: Database): RevisionEntry {
  const live = db.prepare("SELECT entity_id FROM revision_identity WHERE uuid=? AND kind='paragraph' AND active=1").get(row.entity_uuid) as { entity_id: string } | undefined
  return {
    id: Number(row.id), operationId: String(row.operation_id), createdAt: String(row.created_at), kind: String(row.kind), entityId: String(row.entity_id), entityUuid: String(row.entity_uuid), action: String(row.action), source: row.source as RevisionSource,
    before: row.before_json ? JSON.parse(String(row.before_json)) : null, after: row.after_json ? JSON.parse(String(row.after_json)) : null,
    sequenceBefore: row.sequence_before == null ? null : Number(row.sequence_before), sequenceAfter: row.sequence_after == null ? null : Number(row.sequence_after), metadata: JSON.parse(String(row.metadata_json)), contextId: String(row.context_id), neighbors: JSON.parse(String(row.neighbors_json)), liveParagraphId: live ? Number(live.entity_id) : null
  }
}

export function recordGeneration(db: Database, params: { paragraphId?: number; task: string; input: unknown; output?: string; model: unknown; error?: string; context?: unknown }): number {
  const parent = params.paragraphId ? db.prepare('SELECT * FROM paragraph WHERE id=?').get(params.paragraphId) as Record<string, unknown> | undefined : undefined
  const parentIdentity = parent ? db.prepare("SELECT uuid FROM revision_identity WHERE kind='paragraph' AND entity_id=? AND active=1").get(String(parent.id)) as { uuid: string } | undefined : undefined
  const ocr = params.task === 'ocr_recognition'
  return withRevisionContext(db, ocr ? '区域识别结果' : 'AI 生成', ocr ? 'import' : 'ai', { task: params.task }, () => db.transaction(() => {
    const ctx = scope.getStore()!
    db.prepare('INSERT OR IGNORE INTO revision_environment(id,snapshot_json) VALUES(?,?)').run(ctx.contextId, ctx.environment)
    const data = { messages: params.input, output: params.output ?? '', model: params.model, error: params.error ?? null, paragraph: parent ?? null, context: params.context ?? null }
    return Number(db.prepare(`INSERT INTO revision_event(operation_id,created_at,kind,entity_id,entity_uuid,action,source,before_json,after_json,metadata_json,context_id)
      VALUES(?,?,'ai_generation',?,?,?,?,NULL,?,?,?)`).run(ctx.operation, new Date().toISOString(), params.paragraphId == null ? '' : String(params.paragraphId), parentIdentity?.uuid ?? randomUUID(), ctx.action, ctx.source, JSON.stringify(data), ctx.metadata, ctx.contextId).lastInsertRowid)
  })())
}

export function finishGeneration(db: Database, requestId: number, result: { text?: string; error?: string; rawResponse?: unknown }): number {
  const request = db.prepare("SELECT * FROM revision_event WHERE id=? AND kind='ai_generation'").get(requestId) as Record<string, unknown>
  const data = { ...JSON.parse(String(request.after_json)), output: result.text ?? '', error: result.error ?? null, rawResponse: result.rawResponse ?? null }
  return Number(db.prepare(`INSERT INTO revision_event(operation_id,created_at,kind,entity_id,entity_uuid,action,source,before_json,after_json,metadata_json,context_id)
    VALUES(?,?,?,?,?,'AI 返回','ai',NULL,?,?,?)`).run(request.operation_id, new Date().toISOString(), request.kind, request.entity_id, request.entity_uuid, JSON.stringify(data), JSON.stringify({ ...JSON.parse(String(request.metadata_json)), requestId }), request.context_id).lastInsertRowid)
}

export function recordDecision(db: Database, entityUuid: string, paragraphId: number, decision: unknown): void {
  const ctx = scope.getStore()
  if (!ctx) throw new Error('Missing revision operation context')
  db.prepare('INSERT OR IGNORE INTO revision_environment(id,snapshot_json) VALUES(?,?)').run(ctx.contextId, ctx.environment)
  db.prepare(`INSERT INTO revision_event(operation_id,created_at,kind,entity_id,entity_uuid,action,source,after_json,metadata_json,context_id)
    VALUES(?,?,'decision',?,?,?,?,?,?,?)`).run(ctx.operation, new Date().toISOString(), String(paragraphId), entityUuid, ctx.action, ctx.source, JSON.stringify(decision), ctx.metadata, ctx.contextId)
}
