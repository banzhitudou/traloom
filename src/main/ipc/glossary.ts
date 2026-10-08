import { recordedIpc as ipcMain } from './recorded-ipc'
import { getDb } from '../db'
import { reloadGlossaryFromDatabase } from '../services/glossary-service'
import { lookupOfflineDictionary } from '../services/reader-vocabulary'
import { containsWholeTerm, countIndependentTerm, isGlossaryAccepted, type GlossaryAcceptance } from '../../shared/glossary-check'
import { replaceOldTranslations } from '../../shared/glossary-presentation'
import type { GlossaryConsistencyAction } from '../../shared/glossary-check'
import { auditGlossary, type GlossaryAuditApply } from '../../shared/glossary-audit'
import type {
  GlossaryEntry,
  GlossaryImpact,
  GlossaryInput,
  GlossaryReviewStatus,
  ParaStatus,
  Paragraph
} from '@shared/types'

interface GlossaryRow {
  id: number
  category: string
  en: string
  zh: string
  note: string
}

interface ImpactRow {
  id: number
  change_id: number
  paragraph_id: number
  page_idx: number
  en_text: string
  zh_text: string
  paragraph_status: string
  review_status: string
  previous_zh: string | null
  old_en: string
  new_en: string
  old_zh: string
  new_zh: string
}

function toGlossaryEntry(row: GlossaryRow): GlossaryEntry {
  return {
    id: row.id,
    category: row.category,
    en: row.en,
    zh: row.zh,
    note: row.note
  }
}

function refreshGlossaryCache() {
  reloadGlossaryFromDatabase(getDb())
}
function glossaryAcceptances(): GlossaryAcceptance[] {
  return getDb().prepare('SELECT glossary_id AS glossaryId, paragraph_id AS paragraphId, en, zh, en_text AS enText, zh_text AS zhText FROM glossary_acceptance').all() as GlossaryAcceptance[]
}

function normalizeInput(input: GlossaryInput): GlossaryInput {
  return {
    en: String(input.en ?? '').trim(),
    zh: String(input.zh ?? '').trim(),
    category: String(input.category ?? '').trim() || '其他',
    note: String(input.note ?? '').trim()
  }
}

function createImpactRows(changeId: number, englishTerms: string[]): number {
  const db = getDb()
  const terms = [...new Set(englishTerms.map((term) => term.trim()).filter(Boolean))]
  if (terms.length === 0) return 0
  const paragraphs = db.prepare('SELECT id, en_text FROM paragraph ORDER BY id').all() as { id: number; en_text: string }[]
  const entries = db.prepare('SELECT en FROM glossary').all() as { en: string }[]
  const insert = db.prepare(
    'INSERT OR IGNORE INTO glossary_review (change_id, paragraph_id) VALUES (?, ?)'
  )
  let count = 0
  for (const paragraph of paragraphs) {
    if (!terms.some((term) => countIndependentTerm(paragraph.en_text, term, entries))) continue
    count += Number(insert.run(changeId, paragraph.id).changes)
  }
  return count
}

function impactRows(changeId: number): ImpactRow[] {
  return getDb().prepare(
    `SELECT r.id, r.change_id, r.paragraph_id, r.status AS review_status, r.previous_zh,
            p.page_idx, p.en_text, p.zh_text, p.status AS paragraph_status,
            c.old_en, c.new_en, c.old_zh, c.new_zh
       FROM glossary_review r
       JOIN paragraph p ON p.id = r.paragraph_id
       JOIN glossary_change c ON c.id = r.change_id
      WHERE r.change_id = ?
      ORDER BY p.page_idx, p.sort_order, p.id`
  ).all(changeId) as ImpactRow[]
}

function toImpact(row: ImpactRow): GlossaryImpact {
  return {
    id: row.id,
    changeId: row.change_id,
    paragraphId: row.paragraph_id,
    pageIdx: row.page_idx,
    enText: row.en_text,
    zhText: row.zh_text,
    paragraphStatus: row.paragraph_status as ParaStatus,
    reviewStatus: row.review_status as GlossaryReviewStatus,
    oldEn: row.old_en,
    newEn: row.new_en,
    oldZh: row.old_zh,
    newZh: row.new_zh,
    canReplace: Boolean(row.old_zh && row.new_zh && row.old_zh !== row.new_zh && row.zh_text.includes(row.old_zh)),
    canUndo: row.review_status === 'replaced' && row.previous_zh !== null
  }
}

function getImpactById(id: number): ImpactRow | undefined {
  return getDb().prepare(
    `SELECT r.id, r.change_id, r.paragraph_id, r.status AS review_status, r.previous_zh,
            p.page_idx, p.en_text, p.zh_text, p.status AS paragraph_status,
            c.old_en, c.new_en, c.old_zh, c.new_zh
       FROM glossary_review r
       JOIN paragraph p ON p.id = r.paragraph_id
       JOIN glossary_change c ON c.id = r.change_id
      WHERE r.id = ?`
  ).get(id) as ImpactRow | undefined
}

export function registerGlossaryHandlers(): void {
  ipcMain.handle('glossary:acceptances', async () => glossaryAcceptances())
  ipcMain.handle('glossary:setAcceptance', async (_event, params: { entry: Pick<GlossaryEntry, 'id' | 'en' | 'zh'>; paragraph?: Pick<Paragraph, 'id' | 'enText' | 'zhText'>; paragraphs?: Pick<Paragraph, 'id' | 'enText' | 'zhText'>[]; accepted: boolean }) => {
    try {
      const db = getDb()
      const result = db.transaction(() => {
        const entry = db.prepare('SELECT id, en, zh FROM glossary WHERE id = ?').get(params.entry.id) as GlossaryEntry | undefined
        if (!entry || entry.en !== params.entry.en || entry.zh !== params.entry.zh) throw new Error('术语已变化，请重新检查。')
        const snapshots = params.paragraphs ?? (params.paragraph ? [params.paragraph] : [])
        if (!snapshots.length || new Set(snapshots.map(row => row.id)).size !== snapshots.length) throw new Error('请选择不重复的翻译段。')
        for (const snapshot of snapshots) {
          const paragraph = db.prepare('SELECT id, en_text AS enText, zh_text AS zhText FROM paragraph WHERE id = ?').get(snapshot.id) as Paragraph | undefined
          if (!paragraph || paragraph.enText !== snapshot.enText || paragraph.zhText !== snapshot.zhText) throw new Error('翻译段已变化，请重新检查。')
          if (typeof params.accepted !== 'boolean' || !paragraph.zhText.trim() || !containsWholeTerm(paragraph.enText, entry.en)) throw new Error('没有可认可的译文。')
          if (params.accepted) {
            db.prepare('INSERT INTO glossary_acceptance(glossary_id, paragraph_id, en, zh, en_text, zh_text) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(glossary_id, paragraph_id) DO UPDATE SET en=excluded.en, zh=excluded.zh, en_text=excluded.en_text, zh_text=excluded.zh_text, created_at=datetime(\'now\')').run(entry.id, paragraph.id, entry.en, entry.zh, paragraph.enText, paragraph.zhText)
          } else {
            db.prepare('DELETE FROM glossary_acceptance WHERE glossary_id = ? AND paragraph_id = ?').run(entry.id, paragraph.id)
          }
          db.prepare(`UPDATE glossary_review SET status = ?, updated_at=datetime('now') WHERE paragraph_id = ? AND status ${params.accepted ? "IN ('pending', 'review')" : "= 'kept'"} AND change_id IN (SELECT id FROM glossary_change WHERE glossary_id = ? AND new_en = ? AND new_zh = ?)`).run(params.accepted ? 'kept' : 'pending', paragraph.id, entry.id, entry.en, entry.zh)
        }
        return { ok: true, count: snapshots.length }
      })()
      return result
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('glossary:audit', async () => {
    const db = getDb()
    const entries = db.prepare('SELECT id, en, zh, category, note FROM glossary ORDER BY category, en, id').all() as GlossaryEntry[]
    const paragraphs = db.prepare('SELECT id, page_idx AS pageIdx, type, en_text AS enText, zh_text AS zhText, status, bbox_json AS bboxJson, raw_block AS rawBlock FROM paragraph ORDER BY page_idx, sort_order, id').all() as Paragraph[]
    const rows = db.prepare("SELECT glossary_id, old_zh FROM glossary_change WHERE trim(old_zh) <> '' ORDER BY id DESC").all() as { glossary_id: number; old_zh: string }[]
    const history: Record<number, string[]> = {}
    for (const row of rows) (history[row.glossary_id] ??= []).push(row.old_zh)
    return auditGlossary(paragraphs, entries, history, glossaryAcceptances())
  })

  ipcMain.handle('glossary:applyAudit', async (_event, params: GlossaryAuditApply) => {
    try {
      if (!['replace', 'review', 'doing'].includes(params.action) || !params.requests.length) throw new Error('请选择要处理的结果。')
      const db = getDb()
      const result = db.transaction(() => {
        const snapshots = new Map<number, { id: number; en_text: string; zh_text: string; status: string }>()
        const requests = params.requests.map(request => {
          const entry = db.prepare('SELECT id, en, zh FROM glossary WHERE id = ?').get(request.entry.id) as GlossaryRow | undefined
          if (!entry || entry.en !== request.entry.en || entry.zh !== request.entry.zh) throw new Error('术语已发生变化，请重新检查。')
          const oldZh = request.oldZh?.trim() ?? ''
          if (params.action === 'replace' && (!oldZh || oldZh === entry.zh)) throw new Error('请先确认每处需要替换的旧译名。')
          const ids = new Set<number>()
          for (const snapshot of request.paragraphs) {
            if (ids.has(snapshot.id)) throw new Error('重复的翻译段。')
            ids.add(snapshot.id)
            const row = snapshots.get(snapshot.id) ?? db.prepare('SELECT id, en_text, zh_text, status FROM paragraph WHERE id = ?').get(snapshot.id) as { id: number; en_text: string; zh_text: string; status: string } | undefined
            if (!row || row.en_text !== snapshot.enText || row.zh_text !== snapshot.zhText || row.status !== snapshot.status) throw new Error('翻译段已发生变化，请重新检查后操作。')
            if (!countIndependentTerm(row.en_text, entry.en, db.prepare('SELECT en FROM glossary').all() as { en: string }[])) throw new Error('此处术语已由完整词组覆盖，请重新检查。')
            if (params.action === 'replace' && isGlossaryAccepted({ id: row.id, enText: row.en_text, zhText: row.zh_text }, entry, glossaryAcceptances())) throw new Error('此处译名已认可，请先取消认可后再替换。')
            if (params.action === 'replace' && replaceOldTranslations(row.zh_text, [oldZh], entry.zh) === row.zh_text) throw new Error('旧译名已不在译文中，请重新检查。')
            snapshots.set(row.id, row)
          }
          return { entry, oldZh, ids: [...ids] }
        }).sort((a, b) => b.oldZh.length - a.oldZh.length)
        const planned = new Map<number, { entryId: number; oldZh: string; newZh: string }[]>()
        for (const request of requests) {
          for (const id of request.ids) {
            const previous = planned.get(id) ?? []
            if (params.action === 'replace') {
              if (previous.some(item => item.entryId !== request.entry.id && (item.oldZh.includes(request.oldZh) || request.oldZh.includes(item.oldZh) || item.newZh.includes(request.oldZh) || request.entry.zh.includes(item.oldZh)))) throw new Error('同一段中的替换范围有重叠，请分别处理这些术语。')
              previous.push({ entryId: request.entry.id, oldZh: request.oldZh, newZh: request.entry.zh })
            }
            planned.set(id, previous)
          }
        }
        const changes: { entryId: number; changeId: number }[] = []
        const current = new Map([...snapshots].map(([id, row]) => [id, row.zh_text]))
        if (params.action === 'replace') {
          for (const request of requests) {
            const targetIds = request.ids.filter(id => replaceOldTranslations(current.get(id)!, [request.oldZh], request.entry.zh) !== current.get(id))
            if (!targetIds.length) continue
            const changeId = Number(db.prepare("INSERT INTO glossary_change (glossary_id, action, old_en, new_en, old_zh, new_zh) VALUES (?, 'update', ?, ?, ?, ?)").run(request.entry.id, request.entry.en, request.entry.en, request.oldZh, request.entry.zh).lastInsertRowid)
            changes.push({ entryId: request.entry.id, changeId })
            for (const id of targetIds) {
              const before = current.get(id)!
              current.set(id, replaceOldTranslations(before, [request.oldZh], request.entry.zh))
              db.prepare("INSERT INTO glossary_review (change_id, paragraph_id, status, previous_zh) VALUES (?, ?, 'replaced', ?)").run(changeId, id, before)
            }
          }
        }
        for (const id of planned.keys()) {
          db.prepare('UPDATE paragraph SET zh_text = ?, status = ? WHERE id = ?').run(current.get(id)!, params.action === 'replace' ? 'doing' : params.action, id)
        }
        return { count: planned.size, changes }
      })()
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('glossary:oldTranslations', async (_event, entryId: number) => {
    const rows = getDb().prepare("SELECT old_zh FROM glossary_change WHERE glossary_id = ? AND trim(old_zh) <> '' ORDER BY id DESC").all(entryId) as { old_zh: string }[]
    return [...new Set(rows.map(row => row.old_zh.trim()))]
  })
  ipcMain.handle('glossary:applyConsistency', async (_event, params: GlossaryConsistencyAction) => {
    try {
      const db = getDb()
      const result = db.transaction(() => {
        const entry = db.prepare('SELECT id, en, zh FROM glossary WHERE id = ?').get(params.entry.id) as GlossaryRow | undefined
        if (!entry || entry.en !== params.entry.en || entry.zh !== params.entry.zh) throw new Error('术语已发生变化，请重新检查。')
        if (!['replace', 'review', 'doing'].includes(params.action)) throw new Error('无效的批量操作。')
        const oldZh = params.oldZh?.trim() ?? ''
        if (params.action === 'replace' && (!oldZh || oldZh === entry.zh)) throw new Error('请指定与标准译名不同的旧译名。')
        const ids = new Set<number>()
        const rows = params.paragraphs.map(snapshot => {
          if (ids.has(snapshot.id)) throw new Error('重复的翻译段。')
          ids.add(snapshot.id)
          const row = db.prepare('SELECT id, en_text, zh_text, status FROM paragraph WHERE id = ?').get(snapshot.id) as { id: number; en_text: string; zh_text: string; status: string } | undefined
          if (!row || row.en_text !== snapshot.enText || row.zh_text !== snapshot.zhText || row.status !== snapshot.status) throw new Error('翻译段已发生变化，请重新检查后操作。')
          if (!countIndependentTerm(row.en_text, entry.en, db.prepare('SELECT en FROM glossary').all() as { en: string }[])) throw new Error('此处术语已由完整词组覆盖，请重新检查。')
          if (params.action === 'replace' && isGlossaryAccepted({ id: row.id, enText: row.en_text, zhText: row.zh_text }, entry, glossaryAcceptances())) throw new Error('此处译名已认可，请先取消认可后再替换。')
          return row
        })
        const targets = params.action === 'replace' ? rows.filter(row => row.zh_text.includes(oldZh)) : rows
        let changeId: number | undefined
        if (params.action === 'replace' && targets.length) {
          changeId = Number(db.prepare("INSERT INTO glossary_change (glossary_id, action, old_en, new_en, old_zh, new_zh) VALUES (?, 'update', ?, ?, ?, ?)").run(entry.id, entry.en, entry.en, oldZh, entry.zh).lastInsertRowid)
        }
        for (const row of targets) {
          if (params.action === 'replace') {
            db.prepare("UPDATE paragraph SET zh_text = ?, status = 'doing' WHERE id = ?").run(row.zh_text.split(oldZh).join(entry.zh), row.id)
            db.prepare("INSERT INTO glossary_review (change_id, paragraph_id, status, previous_zh) VALUES (?, ?, 'replaced', ?)").run(changeId!, row.id, row.zh_text)
          } else {
            db.prepare('UPDATE paragraph SET status = ? WHERE id = ?').run(params.action, row.id)
          }
        }
        return { count: targets.length, changeId }
      })()
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('glossary:search', async (_event, query: string) => {
    const pattern = `%${String(query ?? '').trim()}%`
    const rows = getDb().prepare(
      'SELECT id, category, en, zh, note FROM glossary WHERE en LIKE ? OR zh LIKE ? ORDER BY en LIMIT 50'
    ).all(pattern, pattern) as GlossaryRow[]
    return rows.map(toGlossaryEntry)
  })

  ipcMain.handle('glossary:list', async (_event, params?: { query?: string; category?: string }) => {
    const query = String(params?.query ?? '').trim()
    const category = String(params?.category ?? '').trim()
    const clauses: string[] = []
    const values: string[] = []
    if (query) {
      clauses.push('(en LIKE ? OR zh LIKE ? OR note LIKE ?)')
      const pattern = `%${query}%`
      values.push(pattern, pattern, pattern)
    }
    if (category) {
      clauses.push('category = ?')
      values.push(category)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = getDb().prepare(
      `SELECT id, category, en, zh, note FROM glossary ${where} ORDER BY category, en LIMIT 1000`
    ).all(...values) as GlossaryRow[]
    return rows.map(toGlossaryEntry)
  })

  ipcMain.handle('glossary:categories', async () => {
    const rows = getDb().prepare(
      "SELECT DISTINCT category FROM glossary WHERE trim(category) <> '' ORDER BY category"
    ).all() as { category: string }[]
    return rows.map((row) => row.category)
  })

  ipcMain.handle('glossary:create', async (_event, rawInput: GlossaryInput) => {
    try {
      const input = normalizeInput(rawInput)
      if (!input.en || !input.zh) return { ok: false, error: '外文术语和中文译名不能为空。' }
      const db = getDb()
      const result = db.transaction(() => {
        const inserted = db.prepare(
          'INSERT INTO glossary (category, en, zh, note) VALUES (?, ?, ?, ?)'
        ).run(input.category, input.en, input.zh, input.note)
        const id = Number(inserted.lastInsertRowid)
        const changed = db.prepare(
          `INSERT INTO glossary_change (glossary_id, action, new_en, new_zh)
           VALUES (?, 'create', ?, ?)`
        ).run(id, input.en, input.zh)
        const changeId = Number(changed.lastInsertRowid)
        const impactCount = createImpactRows(changeId, [input.en])
        return { id, changeId, impactCount }
      })()
      refreshGlossaryCache()
      const row = db.prepare('SELECT id, category, en, zh, note FROM glossary WHERE id = ?').get(result.id) as GlossaryRow
      return { ok: true, entry: toGlossaryEntry(row), changeId: result.changeId, impactCount: result.impactCount }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('glossary:update', async (_event, params: { id: number; input: GlossaryInput }) => {
    try {
      const input = normalizeInput(params.input)
      if (!input.en || !input.zh) return { ok: false, error: '外文术语和中文译名不能为空。' }
      const db = getDb()
      const old = db.prepare('SELECT id, category, en, zh, note FROM glossary WHERE id = ?').get(params.id) as GlossaryRow | undefined
      if (!old) return { ok: false, error: '术语不存在或已经删除。' }

      const termChanged = old.en !== input.en || old.zh !== input.zh
      const result = db.transaction(() => {
        db.prepare(
          'UPDATE glossary SET category = ?, en = ?, zh = ?, note = ? WHERE id = ?'
        ).run(input.category, input.en, input.zh, input.note, params.id)
        if (!termChanged) return { changeId: undefined, impactCount: 0 }
        const changed = db.prepare(
          `INSERT INTO glossary_change (glossary_id, action, old_en, new_en, old_zh, new_zh)
           VALUES (?, 'update', ?, ?, ?, ?)`
        ).run(params.id, old.en, input.en, old.zh, input.zh)
        const changeId = Number(changed.lastInsertRowid)
        return {
          changeId,
          impactCount: createImpactRows(changeId, [old.en, input.en])
        }
      })()
      refreshGlossaryCache()
      const row = db.prepare('SELECT id, category, en, zh, note FROM glossary WHERE id = ?').get(params.id) as GlossaryRow
      return { ok: true, entry: toGlossaryEntry(row), ...result }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('glossary:delete', async (_event, id: number) => {
    try {
      const db = getDb()
      const old = db.prepare('SELECT id, category, en, zh, note FROM glossary WHERE id = ?').get(id) as GlossaryRow | undefined
      if (!old) return { ok: false, error: '术语不存在或已经删除。' }
      db.transaction(() => {
        db.prepare(
          `INSERT INTO glossary_change (glossary_id, action, old_en, old_zh)
           VALUES (?, 'delete', ?, ?)`
        ).run(id, old.en, old.zh)
        db.prepare('DELETE FROM glossary WHERE id = ?').run(id)
      })()
      refreshGlossaryCache()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('glossary:impacts', async (_event, changeId: number) => (
    impactRows(changeId).map(toImpact)
  ))

  ipcMain.handle('glossary:resolveImpact', async (_event, params: { id: number; action: Exclude<GlossaryReviewStatus, 'pending'> }) => {
    try {
      const row = getImpactById(params.id)
      if (!row) return { ok: false, error: '影响项不存在。' }
      const db = getDb()
      if (params.action === 'replaced') {
        if (!row.old_zh || !row.new_zh || row.old_zh === row.new_zh || !row.zh_text.includes(row.old_zh)) {
          return { ok: false, error: '当前译文中没有可安全替换的旧译名。' }
        }
        const nextText = row.zh_text.split(row.old_zh).join(row.new_zh)
        db.transaction(() => {
          db.prepare('UPDATE paragraph SET zh_text = ? WHERE id = ?').run(nextText, row.paragraph_id)
          db.prepare(
            `UPDATE glossary_review
                SET status = 'replaced', previous_zh = COALESCE(previous_zh, ?), updated_at = datetime('now')
              WHERE id = ?`
          ).run(row.zh_text, row.id)
        })()
      } else {
        db.prepare(
          'UPDATE glossary_review SET status = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).run(params.action, row.id)
        if (params.action === 'review') {
          db.prepare("UPDATE paragraph SET status = 'review' WHERE id = ?").run(row.paragraph_id)
        }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('glossary:bulkReplace', async (_event, changeId: number) => {
    try {
      const db = getDb()
      const rows = impactRows(changeId).filter((row) => (
        row.review_status === 'pending'
          && row.old_zh
          && row.new_zh
          && row.old_zh !== row.new_zh
          && row.zh_text.includes(row.old_zh)
      ))
      db.transaction(() => {
        const updateParagraph = db.prepare('UPDATE paragraph SET zh_text = ? WHERE id = ?')
        const updateReview = db.prepare(
          `UPDATE glossary_review
              SET status = 'replaced', previous_zh = ?, updated_at = datetime('now')
            WHERE id = ?`
        )
        for (const row of rows) {
          updateParagraph.run(row.zh_text.split(row.old_zh).join(row.new_zh), row.paragraph_id)
          updateReview.run(row.zh_text, row.id)
        }
      })()
      return { ok: true, replaced: rows.length }
    } catch (error) {
      return { ok: false, replaced: 0, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('glossary:undoImpact', async (_event, id: number) => {
    try {
      const row = getImpactById(id)
      if (!row || row.review_status !== 'replaced' || row.previous_zh === null) {
        return { ok: false, error: '这一项没有可以撤销的替换。' }
      }
      const db = getDb()
      if (row.zh_text !== replaceOldTranslations(row.previous_zh, [row.old_zh], row.new_zh)) {
        return { ok: false, error: '替换后译文已被修改，不能直接撤销覆盖。' }
      }
      db.transaction(() => {
        db.prepare('UPDATE paragraph SET zh_text = ? WHERE id = ?').run(row.previous_zh, row.paragraph_id)
        db.prepare(
          `UPDATE glossary_review
              SET status = 'pending', previous_zh = NULL, updated_at = datetime('now')
            WHERE id = ?`
        ).run(row.id)
      })()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('glossary:offlineDictionary', async (_event, query: string) => (
    lookupOfflineDictionary(String(query ?? ''))
  ))
}
