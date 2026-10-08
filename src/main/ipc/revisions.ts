import { dialog } from 'electron'
import { ipcMain } from './secure-ipc'
import { openSync, closeSync, writeSync, renameSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { revisionRow, withRevisionContext, recordGeneration, recordDecision } from '../services/revision-history'
import { reloadGlossaryFromDatabase } from '../services/glossary-service'
import { parseTranslationOptions } from '../../shared/translation-options'
import type { RevisionEntry, RevisionFilter, RestoreRevisionParams } from '../../shared/revisions'

function entryById(id: number): RevisionEntry {
  if (!Number.isInteger(id)) throw new Error('修订编号无效。')
  const db = getDb()
  const row = db.prepare('SELECT * FROM revision_event WHERE id=?').get(id) as Record<string, unknown> | undefined
  if (!row) throw new Error('修订记录不存在。')
  return revisionRow(row, db)
}

function currentState(entry: RevisionEntry): string | null {
  const db = getDb()
  const kind = entry.kind === 'paragraph_note' ? 'paragraph' : entry.kind
  const identity = db.prepare('SELECT entity_id FROM revision_identity WHERE uuid=? AND kind=? AND active=1').get(entry.entityUuid, kind) as { entity_id: string } | undefined
  if (!identity) return null
  if (entry.kind === 'paragraph_note') {
    const note = db.prepare('SELECT content FROM paragraph_note WHERE paragraph_id=?').get(identity.entity_id) as { content: string } | undefined
    return JSON.stringify({ content: note?.content ?? '' })
  }
  const table = { paragraph: 'paragraph', glossary: 'glossary', document: 'project_document', project: 'project_meta' }[entry.kind]
  if (!table) return null
  const row = db.prepare(`SELECT * FROM ${table} WHERE ${entry.kind === 'project' ? 'key' : 'id'}=?`).get(identity.entity_id) as Record<string, unknown> | undefined
  if (row && entry.kind === 'paragraph') row.note = (db.prepare('SELECT content FROM paragraph_note WHERE paragraph_id=?').get(identity.entity_id) as { content: string } | undefined)?.content ?? ''
  return row ? JSON.stringify(row) : null
}

export function registerRevisionHandlers(): void {
  ipcMain.handle('revision:list', (_event, filter: RevisionFilter = {}) => {
    const db = getDb()
    const where: string[] = [], params: (string | number)[] = []
    if (filter.paragraphId !== undefined) {
      const identity = db.prepare("SELECT uuid FROM revision_identity WHERE kind='paragraph' AND entity_id=? AND active=1").get(String(filter.paragraphId)) as { uuid: string } | undefined
      where.push('entity_uuid=?'); params.push(identity?.uuid ?? '')
    }
    if (filter.entityUuid) { where.push('entity_uuid=?'); params.push(filter.entityUuid) }
    if (filter.source) { where.push('source=?'); params.push(filter.source) }
    if (filter.from) { where.push('created_at>=?'); params.push(filter.from) }
    if (filter.to) { where.push('created_at<=?'); params.push(filter.to) }
    if (filter.query?.trim()) {
      where.push("(entity_id LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR before_json LIKE ? ESCAPE '\\' OR after_json LIKE ? ESCAPE '\\')")
      const query = filter.query.trim().replace(/^#(?=\d+$)/, '')
      const needle = `%${query.replace(/[\\%_]/g, '\\$&')}%`
      params.push(needle, needle, needle, needle)
    }
    const condition = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (db.prepare(`SELECT count(*) AS n FROM revision_event ${condition}`).get(...params) as { n: number }).n
    if (filter.beforeId) { where.push('id<?'); params.push(filter.beforeId) }
    const limit = Math.min(100, Math.max(1, Math.trunc(filter.limit ?? 40)))
    const rows = db.prepare(`SELECT * FROM revision_event ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...params, limit + 1) as Record<string, unknown>[]
    const entries = rows.slice(0, limit).map(row => revisionRow(row, db))
    return { entries, total, nextId: rows.length > limit ? entries[entries.length - 1].id : null }
  })

  ipcMain.handle('revision:detail', (_event, id: number) => {
    const db = getDb(), entry = entryById(id)
    const context = db.prepare('SELECT snapshot_json FROM revision_environment WHERE id=?').get(entry.contextId) as { snapshot_json: string }
    const related = db.prepare('SELECT id,kind,entity_id,action FROM revision_event WHERE operation_id=? ORDER BY id').all(entry.operationId)
    const annotation = db.prepare('SELECT category,reason FROM revision_annotation WHERE revision_id=?').get(id) ?? { category: '', reason: '' }
    return { entry, environment: JSON.parse(context.snapshot_json), related, annotation, currentState: currentState(entry) }
  })

  ipcMain.handle('revision:restore', (_event, params: RestoreRevisionParams) => {
    const db = getDb(), entry = entryById(params.id), snapshot = entry[params.side]
    if (!snapshot) throw new Error('这个版本没有可恢复的内容。')
    const state = currentState(entry)
    if (state !== params.expected) throw new Error('当前内容已发生变化，请重新打开记录后再恢复。')
    return withRevisionContext(db, '恢复历史版本', 'human', { revisionId: entry.id, side: params.side, field: params.field, originalUuid: entry.entityUuid }, () => db.transaction(() => {
      if (entry.kind === 'paragraph') {
        let id = entry.liveParagraphId
        if (id === null) {
          if (params.field !== 'paragraph') throw new Error('该段已删除，请选择恢复整段。')
          db.prepare('UPDATE paragraph SET sort_order=sort_order+1 WHERE page_idx=? AND sort_order>=?').run(snapshot.page_idx, snapshot.sort_order)
          id = Number(db.prepare('INSERT INTO paragraph(page_idx,type,en_text,zh_text,status,sort_order,bbox_json,raw_block) VALUES(?,?,?,?,?,?,?,?)').run(snapshot.page_idx, snapshot.type, snapshot.en_text, snapshot.zh_text, 'doing', snapshot.sort_order, snapshot.bbox_json, snapshot.raw_block).lastInsertRowid)
          if (snapshot.note) db.prepare('INSERT INTO paragraph_note(paragraph_id,content) VALUES(?,?)').run(id, snapshot.note)
        } else if (params.field === 'paragraph') {
          db.prepare("UPDATE paragraph SET en_text=?,zh_text=?,bbox_json=?,type=?,raw_block=?,status='doing' WHERE id=?").run(snapshot.en_text, snapshot.zh_text, snapshot.bbox_json, snapshot.type, snapshot.raw_block, id)
          db.prepare('INSERT INTO paragraph_note(paragraph_id,content) VALUES(?,?) ON CONFLICT(paragraph_id) DO UPDATE SET content=excluded.content').run(id, snapshot.note ?? '')
        } else {
          if (!['en_text', 'zh_text', 'bbox_json', 'status'].includes(params.field)) throw new Error('该字段不支持单独恢复。')
          db.prepare(`UPDATE paragraph SET ${params.field}=?${params.field === 'status' ? '' : ",status='doing'"} WHERE id=?`).run(snapshot[params.field], id)
        }
        return { paragraphId: id }
      }
      if (entry.kind === 'paragraph_note' && entry.liveParagraphId !== null) {
        db.prepare('INSERT INTO paragraph_note(paragraph_id,content) VALUES(?,?) ON CONFLICT(paragraph_id) DO UPDATE SET content=excluded.content').run(entry.liveParagraphId, snapshot.content ?? '')
        return { paragraphId: entry.liveParagraphId }
      }
      if (entry.kind === 'glossary') {
        const active = db.prepare("SELECT entity_id FROM revision_identity WHERE uuid=? AND kind='glossary' AND active=1").get(entry.entityUuid) as { entity_id: string } | undefined
        if (active) db.prepare('UPDATE glossary SET en=?,zh=?,category=?,note=? WHERE id=?').run(snapshot.en, snapshot.zh, snapshot.category, snapshot.note, active.entity_id)
        else db.prepare('INSERT INTO glossary(en,zh,category,note) VALUES(?,?,?,?)').run(snapshot.en, snapshot.zh, snapshot.category, snapshot.note)
        reloadGlossaryFromDatabase(db)
        return { paragraphId: null }
      }
      if (entry.kind === 'project' && ['book_title','src_lang','tgt_lang','style_guide_text','project_note'].includes(String(snapshot.key))) {
        db.prepare('INSERT INTO project_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(snapshot.key, snapshot.value)
        return { paragraphId: null }
      }
      if (entry.kind === 'document') {
        db.prepare('INSERT INTO project_document(path,title,kind,content) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET title=excluded.title,kind=excluded.kind,content=excluded.content').run(snapshot.path, snapshot.title, snapshot.kind, snapshot.content)
        return { paragraphId: null }
      }
      throw new Error('该操作没有可恢复的内容。')
    })())
  })

  ipcMain.handle('revision:annotate', (_event, id: number, category: string, reason: string) => {
    if (typeof category !== 'string' || typeof reason !== 'string') throw new Error('修订说明无效。')
    const db = getDb(), entry = entryById(id)
    withRevisionContext(db, '填写修订说明', 'human', { revisionId: id }, () => db.transaction(() => {
      db.prepare('INSERT INTO revision_annotation(revision_id,category,reason) VALUES(?,?,?) ON CONFLICT(revision_id) DO UPDATE SET category=excluded.category,reason=excluded.reason').run(id, category, reason)
    })())
    return entry.id
  })

  ipcMain.handle('revision:adoptCandidate', (_event, params: { paragraphId: number; generationId: number; candidateIndex: number; expectedDraft: string }) => {
    const db = getDb(), generation = entryById(params.generationId)
    const live = db.prepare('SELECT en_text,zh_text FROM paragraph WHERE id=?').get(params.paragraphId) as { en_text: string; zh_text: string } | undefined
    const generatedParagraph = generation.after?.paragraph as Record<string, unknown> | null
    const candidate = parseTranslationOptions(String(generation.after?.output ?? ''))[params.candidateIndex]
    if (generation.kind !== 'ai_generation' || generation.action !== 'AI 返回' || generation.liveParagraphId !== params.paragraphId || generation.metadata.task !== 'translation_options' || !candidate || !live || generatedParagraph?.en_text !== live.en_text || live.zh_text !== params.expectedDraft) throw new Error('原文或译文已变化，请重新生成参考后采用。')
    withRevisionContext(db, '采用 AI 译文参考', 'human', { generationId: generation.id, candidateIndex: params.candidateIndex, candidateLabel: candidate.label }, () => db.transaction(() => {
      db.prepare("UPDATE paragraph SET zh_text=?,status='doing' WHERE id=?").run(candidate.text, params.paragraphId)
      recordDecision(db, generation.entityUuid, params.paragraphId, { generationId: generation.id, candidateIndex: params.candidateIndex, candidate, previousDraft: live.zh_text })
    })())
    return candidate.text
  })

  ipcMain.handle('revision:recordOcr', (_event, params: { paragraphId?: number; pageIdx: number; boxes: unknown; rotation: number; method: string; text: string; regions?: unknown }) => {
    if (!Number.isInteger(params.pageIdx) || typeof params.text !== 'string') throw new Error('识别记录无效。')
    return recordGeneration(getDb(), { paragraphId: params.paragraphId, task: 'ocr_recognition', input: { pageIdx: params.pageIdx, boxes: params.boxes, rotation: params.rotation }, output: params.text, model: { engine: params.method }, context: params.regions })
  })

  ipcMain.handle('revision:export', async () => {
    const db = getDb()
    const result = await dialog.showSaveDialog({ title: '导出完整修订原始记录', defaultPath: '修订原始记录.jsonl', filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }] })
    if (result.canceled || !result.filePath) return { ok: false, error: '已取消导出。' }
    if (db !== getDb() || !db.open) return { ok: false, error: '工程已切换，请重新导出。' }
    const temporary = `${result.filePath}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      fd = openSync(temporary, 'wx')
      const write = (value: unknown) => writeSync(fd!, `${JSON.stringify(value)}\n`)
      db.transaction(() => {
        write({ recordType: 'manifest', schemaVersion: 1, exportedAt: new Date().toISOString(), settings: db.prepare('SELECT * FROM revision_settings').all(), project: db.prepare("SELECT key,value FROM project_meta WHERE key IN ('book_title','src_lang','tgt_lang')").all(), timestampFormat: 'UTC ISO 8601', legacyHistory: 'Only the baseline and subsequent saved operations are available.' })
        for (const row of db.prepare('SELECT * FROM revision_environment ORDER BY id').iterate() as Iterable<{ id: string; snapshot_json: string }>) write({ recordType: 'environment', id: row.id, snapshot: JSON.parse(row.snapshot_json) })
        for (const row of db.prepare('SELECT * FROM revision_event ORDER BY id').iterate() as Iterable<Record<string, unknown>>) write({ recordType: 'revision', ...revisionRow(row, db) })
        for (const row of db.prepare('SELECT * FROM revision_annotation ORDER BY revision_id').iterate()) write({ recordType: 'annotation', ...row as object })
        for (const table of ['ai_log', 'glossary_change', 'glossary_review', 'assistant_message']) {
          for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY id`).iterate()) write({ recordType: 'legacy', table, provenance: 'Partial historical evidence; completeness and authorship are not inferred.', ...row as object })
        }
      })()
      closeSync(fd); fd = undefined
      renameSync(temporary, result.filePath)
      return { ok: true, path: result.filePath }
    } catch (error) {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(temporary) } catch {}
      return { ok: false, error: String(error) }
    }
  })
}
