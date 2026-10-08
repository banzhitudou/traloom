/**
 * 段落管理 IPC handlers
 * channel: paragraph:list / get / updateTranslation / updateStatus / progress
 */
import { recordedIpc as ipcMain } from './recorded-ipc'
import { getDb } from '../db'
import type { Paragraph, ParaStatus } from '@shared/types'
import { getMergedParagraphParts, mergeParagraphData } from '../../shared/paragraph-structure'
import { parseNormalizedBboxes } from '../../shared/bbox'

interface ParagraphRow {
  id: number
  page_idx: number
  type: string
  en_text: string
  zh_text: string
  status: string
  sort_order: number
  bbox_json: string
  raw_block: string
}

function rowToParagraph(r: ParagraphRow): Paragraph {
  return {
    id: r.id,
    pageIdx: r.page_idx,
    type: r.type as Paragraph['type'],
    enText: r.en_text,
    zhText: r.zh_text,
    status: r.status as ParaStatus,
    bboxJson: r.bbox_json,
    rawBlock: r.raw_block
  }
}

export function registerParagraphHandlers(): void {
  ipcMain.handle('paragraph:listNotes', () => getDb().prepare(
    `WITH numbered AS (
       SELECT id, page_idx, en_text, zh_text, ROW_NUMBER() OVER (ORDER BY page_idx, sort_order, id) AS sequence
       FROM paragraph
     )
     SELECT p.id, p.sequence, p.page_idx AS pageIdx, p.en_text AS enText, p.zh_text AS zhText, n.content
     FROM numbered p JOIN paragraph_note n ON n.paragraph_id = p.id
     WHERE trim(n.content) <> '' ORDER BY p.sequence`
  ).all())
  ipcMain.handle('notes:getProject', () => {
    const row = getDb().prepare("SELECT value FROM project_meta WHERE key = 'project_note'").get() as { value: string } | undefined
    return row?.value ?? ''
  })
  ipcMain.handle('notes:saveProject', (_event, content: string) => {
    if (typeof content !== 'string') throw new Error('项目备注参数无效。')
    getDb().prepare("INSERT INTO project_meta (key, value) VALUES ('project_note', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(content)
  })
  ipcMain.handle('paragraph:getNote', (_event, id: number) => {
    const row = getDb().prepare('SELECT content FROM paragraph_note WHERE paragraph_id = ?').get(id) as { content: string } | undefined
    return row?.content ?? ''
  })
  ipcMain.handle('paragraph:saveNote', (_event, id: number, content: string) => {
    if (!Number.isInteger(id) || typeof content !== 'string') throw new Error('笔记参数无效。')
    const db = getDb()
    if (!db.prepare('SELECT id FROM paragraph WHERE id = ?').get(id)) throw new Error('翻译段不存在。')
    db.prepare('INSERT INTO paragraph_note (paragraph_id, content) VALUES (?, ?) ON CONFLICT(paragraph_id) DO UPDATE SET content = excluded.content').run(id, content)
  })
  ipcMain.handle('paragraph:delete-many', async (_event, ids: number[]) => {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isInteger(id) || id < 1)) throw new Error('翻译段无效。')
    const db = getDb()
    db.transaction(() => {
      for (const id of new Set(ids)) {
        if (!db.prepare('SELECT id FROM paragraph WHERE id = ?').get(id)) throw new Error('翻译段已不存在，请刷新后重试。')
        db.prepare('DELETE FROM glossary_review WHERE paragraph_id = ?').run(id)
        db.prepare('UPDATE ai_log SET paragraph_id = NULL WHERE paragraph_id = ?').run(id)
        db.prepare('UPDATE assistant_message SET paragraph_id = NULL WHERE paragraph_id = ?').run(id)
        db.prepare('DELETE FROM paragraph WHERE id = ?').run(id)
      }
    })()
  })
  ipcMain.handle('paragraph:delete', async (_event, id: number) => {
    if (!Number.isInteger(id) || id < 1) throw new Error('翻译段无效。')
    const db = getDb()
    db.transaction(() => {
      if (!db.prepare('SELECT id FROM paragraph WHERE id = ?').get(id)) throw new Error('翻译段已不存在。')
      db.prepare('DELETE FROM glossary_review WHERE paragraph_id = ?').run(id)
      db.prepare('UPDATE ai_log SET paragraph_id = NULL WHERE paragraph_id = ?').run(id)
      db.prepare('UPDATE assistant_message SET paragraph_id = NULL WHERE paragraph_id = ?').run(id)
      db.prepare('DELETE FROM paragraph WHERE id = ?').run(id)
    })()
  })
  // 列出全部段落（按 PDF 页和人工调整后的页内顺序）
  ipcMain.handle('paragraph:list', async () => {
    const db = getDb()
    const rows = db.prepare(
      'SELECT * FROM paragraph ORDER BY page_idx ASC, sort_order ASC, id ASC'
    ).all() as ParagraphRow[]
    return rows.map(rowToParagraph)
  })

  // 取单个段落
  ipcMain.handle('paragraph:get', async (_event, id: number) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM paragraph WHERE id = ?').get(id) as ParagraphRow | undefined
    return row ? rowToParagraph(row) : null
  })

  // 更新译文（译者编辑后自动保存）
  ipcMain.handle('paragraph:updateTranslation', async (_event, { id, zhText }) => {
    const db = getDb()
    // 译文非空时自动切到 doing（若还是 todo）
    db.prepare(
      `UPDATE paragraph
       SET zh_text = ?,
           status = CASE
             WHEN status = 'todo' AND trim(?) <> '' THEN 'doing'
             ELSE status
           END
       WHERE id = ?`
    ).run(zhText, zhText, id)
  })

  // 窗口关闭前同步落盘，避免防抖计时器尚未执行时丢失最后输入。
  ipcMain.on('paragraph:flushTranslation', (event, { id, zhText }) => {
    try {
      const db = getDb()
      db.prepare(
        `UPDATE paragraph
         SET zh_text = ?,
             status = CASE WHEN status = 'todo' AND trim(?) <> '' THEN 'doing' ELSE status END
         WHERE id = ?`
      ).run(zhText, zhText, id)
      event.returnValue = true
    } catch {
      event.returnValue = false
    }
  })

  // 更新状态
  ipcMain.handle('paragraph:updateStatus', async (_event, args) => {
    if (!args || typeof args !== 'object') throw new Error('无效的翻译段参数。')
    const { id, status } = args
    if (!Number.isSafeInteger(id) || id <= 0 || typeof status !== 'string' || !['todo', 'doing', 'done', 'review'].includes(status)) throw new Error('无效的翻译段状态。')
    const db = getDb()
    if (!db.prepare('SELECT 1 FROM paragraph WHERE id=?').get(id)) throw new Error('翻译段不存在。')
    db.prepare('UPDATE paragraph SET status = ? WHERE id = ?').run(status, id)
  })

  // OCR 原文可由译者修订。已完成的段落退回待复核，译文保留供人工判断是否需要改写。
  ipcMain.handle('paragraph:updateOriginalText', async (_event, { id, enText }) => {
    const text = String(enText ?? '').trim()
    if (!text) throw new Error('英文原文不能为空。')
    const db = getDb()
    db.prepare(
      `UPDATE paragraph
       SET en_text = ?, status = CASE WHEN status = 'done' THEN 'review' ELSE status END
       WHERE id = ?`
    ).run(text, id)
    const row = db.prepare('SELECT * FROM paragraph WHERE id = ?').get(id) as ParagraphRow | undefined
    if (!row) throw new Error('未找到需要更新的段落。')
    return rowToParagraph(row)
  })

  // PDF 上人工补录的 OCR 漏识别区域。保留坐标，但不回写原始 OCR 文件。
  const createManual = (params: { enText: string; pageIdx: number; bboxJson: string; insertAfterParagraphId?: number }) => {
    const enText = String(params?.enText ?? '').trim()
    const pageIdx = Number(params?.pageIdx)
    const bboxJson = String(params?.bboxJson ?? '')
    const requestedAnchorId = Number(params?.insertAfterParagraphId)
    if (!enText) throw new Error('请先输入漏识别区域的英文原文。')
    if (!Number.isInteger(pageIdx) || pageIdx < 0) throw new Error('补录区域的页码无效。')
    try {
      const bbox = JSON.parse(bboxJson)
      if (!Array.isArray(bbox) || bbox.length !== 4) throw new Error()
    } catch {
      throw new Error('补录区域的坐标无效。')
    }

    const db = getDb()
    const insertParagraph = db.transaction(() => {
      let sortOrder: number
      let anchorId: number | null = null
      const anchor = Number.isInteger(requestedAnchorId) && requestedAnchorId >= 1
        ? db.prepare(
          'SELECT id, page_idx, sort_order FROM paragraph WHERE id = ?'
        ).get(requestedAnchorId) as { id: number; page_idx: number; sort_order: number } | undefined
        : undefined

      if (anchor?.page_idx === pageIdx) {
        anchorId = anchor.id
        sortOrder = anchor.sort_order + 1
        db.prepare(
          'UPDATE paragraph SET sort_order = sort_order + 1 WHERE page_idx = ? AND sort_order > ?'
        ).run(pageIdx, anchor.sort_order)
      } else {
        sortOrder = (db.prepare(
          'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM paragraph WHERE page_idx = ?'
        ).get(pageIdx) as { next_order: number }).next_order
      }

      return db.prepare(
        `INSERT INTO paragraph (page_idx, type, en_text, zh_text, status, sort_order, bbox_json, raw_block)
         VALUES (?, 'paragraph', ?, '', 'todo', ?, ?, ?)`
      ).run(pageIdx, enText, sortOrder, bboxJson, JSON.stringify({
        source: 'manual_pdf_selection',
        insertAfterParagraphId: anchorId
      }))
    })
    const result = insertParagraph()
    const row = db.prepare('SELECT * FROM paragraph WHERE id = ?').get(result.lastInsertRowid) as ParagraphRow
    return rowToParagraph(row)
  }
  ipcMain.handle('paragraph:createManual', async (_event, params) => createManual(params))
  ipcMain.handle('paragraph:createManualBatch', async (_event, params) => {
    if (!Array.isArray(params) || !params.length || params.length > 500) throw new Error('补录段落数量无效。')
    if (params.some(item => !item || item.pageIdx !== params[0].pageIdx || !parseNormalizedBboxes(item.bboxJson).length)) throw new Error('补录页码或坐标无效。')
    return getDb().transaction(() => {
      let anchor = params[0].insertAfterParagraphId
      return params.map(item => {
        const saved = createManual({ ...item, insertAfterParagraphId: anchor })
        anchor = saved.id
        return saved
      })
    })()
  })

  // 修订项目库中的段落坐标与 OCR 原文；不回写原始 MinerU 文件。
  ipcMain.handle('paragraph:updateRegion', async (_event, params) => {
    const id = Number(params?.id)
    const enText = String(params?.enText ?? '').trim()
    const bboxJson = String(params?.bboxJson ?? '')
    if (!Number.isInteger(id) || id < 1) throw new Error('段落无效。')
    if (!enText) throw new Error('英文原文不能为空。')
    if (parseNormalizedBboxes(bboxJson).length === 0) {
      throw new Error('识别区域的坐标无效。')
    }

    const db = getDb()
    const row = db.prepare('SELECT * FROM paragraph WHERE id = ?').get(id) as ParagraphRow | undefined
    if (!row) throw new Error('未找到需要调整的段落。')
    db.prepare(
      `UPDATE paragraph
       SET en_text = ?, bbox_json = ?, status = CASE WHEN status = 'done' THEN 'review' ELSE status END
       WHERE id = ?`
    ).run(enText, bboxJson, id)
    return rowToParagraph(db.prepare('SELECT * FROM paragraph WHERE id = ?').get(id) as ParagraphRow)
  })

  ipcMain.handle('paragraph:reorder', async (_event, params) => {
    const pageIdx = Number(params?.pageIdx)
    const paragraphIds = Array.isArray(params?.paragraphIds)
      ? params.paragraphIds.map(Number)
      : []
    if (!Number.isInteger(pageIdx) || pageIdx < 0) throw new Error('页码无效。')
    if (paragraphIds.some((id) => !Number.isInteger(id) || id < 1)) throw new Error('翻译段顺序无效。')

    const db = getDb()
    const currentIds = (db.prepare(
      'SELECT id FROM paragraph WHERE page_idx = ? ORDER BY sort_order, id'
    ).all(pageIdx) as { id: number }[]).map((row) => row.id)
    if (
      currentIds.length !== paragraphIds.length
      || new Set(paragraphIds).size !== paragraphIds.length
      || currentIds.some((id) => !paragraphIds.includes(id))
    ) {
      throw new Error('本页翻译段已经变化，请刷新后再调整。')
    }

    const update = db.prepare('UPDATE paragraph SET sort_order = ? WHERE id = ? AND page_idx = ?')
    db.transaction(() => {
      paragraphIds.forEach((id, index) => update.run(index + 1, id, pageIdx))
    })()
  })

  ipcMain.handle('paragraph:merge', async (_event, rawIds) => {
    const ids = Array.isArray(rawIds) ? rawIds.map(Number) : []
    if (ids.length < 2 || ids.some((id) => !Number.isInteger(id) || id < 1)) {
      throw new Error('至少选择两个有效的翻译段。')
    }
    if (new Set(ids).size !== ids.length) throw new Error('不能重复选择同一个翻译段。')

    const db = getDb()
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT * FROM paragraph WHERE id IN (${placeholders}) ORDER BY page_idx, sort_order, id`
    ).all(...ids) as ParagraphRow[]
    if (rows.length !== ids.length) throw new Error('部分翻译段不存在，请刷新后重试。')
    if (rows.some((row) => row.page_idx !== rows[0].page_idx)) throw new Error('只能合并同一 PDF 页上的翻译段。')

    const pageRows = db.prepare(
      'SELECT id FROM paragraph WHERE page_idx = ? ORDER BY sort_order, id'
    ).all(rows[0].page_idx) as { id: number }[]
    const selectedPositions = rows.map((row) => pageRows.findIndex((item) => item.id === row.id))
    if (selectedPositions.some((position, index) => index > 0 && position !== selectedPositions[index - 1] + 1)) {
      throw new Error('只能合并顺序相邻的翻译段。')
    }

    const merged = mergeParagraphData(rows.map((row) => ({
      id: row.id,
      type: row.type as Paragraph['type'],
      enText: row.en_text,
      zhText: row.zh_text,
      status: row.status as ParaStatus,
      bboxJson: row.bbox_json,
      rawBlock: row.raw_block,
      note: (db.prepare('SELECT content FROM paragraph_note WHERE paragraph_id=?').get(row.id) as { content: string } | undefined)?.content ?? '',
      reviews: db.prepare('SELECT change_id,status,previous_zh,updated_at FROM glossary_review WHERE paragraph_id=?').all(row.id) as any[],
      aiLogIds: (db.prepare('SELECT id FROM ai_log WHERE paragraph_id=?').all(row.id) as { id: number }[]).map(item => item.id),
      assistantMessageIds: (db.prepare('SELECT id FROM assistant_message WHERE paragraph_id=?').all(row.id) as { id: number }[]).map(item => item.id)
    })))
    const primary = rows[0]
    const secondaryIds = rows.slice(1).map((row) => row.id)

    db.transaction(() => {
      db.prepare(
        `UPDATE paragraph
         SET type = ?, en_text = ?, zh_text = ?, status = ?, bbox_json = ?, raw_block = ?
         WHERE id = ?`
      ).run(
        merged.type, merged.enText, merged.zhText, merged.status,
        merged.bboxJson, merged.rawBlock, primary.id
      )

      const copyReview = db.prepare(
        `INSERT OR IGNORE INTO glossary_review
           (change_id, paragraph_id, status, previous_zh, updated_at)
         SELECT change_id, ?, status, previous_zh, updated_at
         FROM glossary_review WHERE paragraph_id = ?`
      )
      const notes = rows.map(row => (db.prepare('SELECT content FROM paragraph_note WHERE paragraph_id = ?').get(row.id) as { content: string } | undefined)?.content ?? '').filter(content => content.trim())
      if (notes.length) db.prepare('INSERT INTO paragraph_note (paragraph_id, content) VALUES (?, ?) ON CONFLICT(paragraph_id) DO UPDATE SET content = excluded.content').run(primary.id, notes.join('\n\n'))
      const deleteReview = db.prepare('DELETE FROM glossary_review WHERE paragraph_id = ?')
      const moveAiLog = db.prepare('UPDATE ai_log SET paragraph_id = ? WHERE paragraph_id = ?')
      const moveAssistant = db.prepare('UPDATE assistant_message SET paragraph_id = ? WHERE paragraph_id = ?')
      const deleteParagraph = db.prepare('DELETE FROM paragraph WHERE id = ?')
      for (const id of secondaryIds) {
        copyReview.run(primary.id, id)
        deleteReview.run(id)
        moveAiLog.run(primary.id, id)
        moveAssistant.run(primary.id, id)
        deleteParagraph.run(id)
      }

      const remaining = db.prepare(
        'SELECT id FROM paragraph WHERE page_idx = ? ORDER BY sort_order, id'
      ).all(primary.page_idx) as { id: number }[]
      const normalizeOrder = db.prepare('UPDATE paragraph SET sort_order = ? WHERE id = ?')
      remaining.forEach((row, index) => normalizeOrder.run(index + 1, row.id))
    })()

    return rowToParagraph(
      db.prepare('SELECT * FROM paragraph WHERE id = ?').get(primary.id) as ParagraphRow
    )
  })

  ipcMain.handle('paragraph:unmerge', (_event, id: number) => {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('翻译段编号无效。')
    const db = getDb()
    const row = db.prepare('SELECT * FROM paragraph WHERE id=?').get(id) as ParagraphRow | undefined
    if (!row) throw new Error('翻译段不存在。')
    const parts = getMergedParagraphParts(row.raw_block)
    if (!parts.length || parts[0].id !== id) throw new Error('这段没有可恢复的合并记录。')
    if (parts.slice(1).some(part => db.prepare('SELECT 1 FROM paragraph WHERE id=?').get(part.id))) throw new Error('原段落编号已被占用，无法解散。')

    return db.transaction(() => {
      const pageIds = (db.prepare('SELECT id FROM paragraph WHERE page_idx=? ORDER BY sort_order,id').all(row.page_idx) as { id: number }[]).map(item => item.id)
      const position = pageIds.indexOf(id)
      pageIds.splice(position, 1, ...parts.map(part => part.id))
      for (const part of parts) {
        if (part.id === id) {
          db.prepare('UPDATE paragraph SET type=?,en_text=?,zh_text=?,status=?,bbox_json=?,raw_block=? WHERE id=?').run(part.type, part.enText, part.zhText, part.status, part.bboxJson, part.rawBlock, id)
        } else {
          const oldIdentity = db.prepare("SELECT uuid FROM revision_identity WHERE kind='paragraph' AND entity_id=? AND active=0 ORDER BY rowid DESC LIMIT 1").get(String(part.id)) as { uuid: string } | undefined
          if (oldIdentity) db.prepare('UPDATE revision_identity SET active=1 WHERE uuid=?').run(oldIdentity.uuid)
          db.prepare('INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order,bbox_json,raw_block) VALUES(?,?,?,?,?,?,?,?,?)').run(part.id,row.page_idx,part.type,part.enText,part.zhText,part.status,row.sort_order,part.bboxJson,part.rawBlock)
        }
        const historical = part.note === undefined ? db.prepare("SELECT before_json FROM revision_event WHERE kind='paragraph' AND entity_id=? AND action='合并翻译段' AND before_json IS NOT NULL AND json_extract(before_json,'$.en_text')=? ORDER BY id DESC LIMIT 1").get(String(part.id),part.enText) as { before_json: string } | undefined : undefined
        const existingNote = part.id === id ? (db.prepare('SELECT content FROM paragraph_note WHERE paragraph_id=?').get(id) as { content: string } | undefined)?.content ?? '' : ''
        const note = part.note ?? (historical ? JSON.parse(historical.before_json).note : existingNote) ?? ''
        db.prepare('INSERT INTO paragraph_note(paragraph_id,content) VALUES(?,?) ON CONFLICT(paragraph_id) DO UPDATE SET content=excluded.content').run(part.id,note)
        if (part.reviews) {
          db.prepare('DELETE FROM glossary_review WHERE paragraph_id=?').run(part.id)
          for (const review of part.reviews) {
            db.prepare('INSERT INTO glossary_review(change_id,paragraph_id,status,previous_zh,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM glossary_change WHERE id=?)').run(review.change_id,part.id,review.status,review.previous_zh,review.updated_at,review.change_id)
          }
        }
        for (const logId of part.aiLogIds ?? []) db.prepare('UPDATE ai_log SET paragraph_id=? WHERE id=? AND paragraph_id=?').run(part.id,logId,id)
        for (const messageId of part.assistantMessageIds ?? []) db.prepare('UPDATE assistant_message SET paragraph_id=? WHERE id=? AND paragraph_id=?').run(part.id,messageId,id)
      }
      pageIds.forEach((paragraphId,index) => db.prepare('UPDATE paragraph SET sort_order=? WHERE id=?').run(index+1,paragraphId))
      return parts.map(part => rowToParagraph(db.prepare('SELECT * FROM paragraph WHERE id=?').get(part.id) as ParagraphRow))
    })()
  })

  // 每个工程独立记忆最后查看的翻译段。段落被合并或删除后返回 null，由界面回退。
  ipcMain.handle('paragraph:lastViewed', async () => {
    const db = getDb()
    const row = db.prepare(
      "SELECT value FROM project_meta WHERE key = 'last_viewed_paragraph_id'"
    ).get() as { value: string } | undefined
    const id = Number(row?.value)
    if (Number.isInteger(id) && id >= 1 && db.prepare('SELECT 1 FROM paragraph WHERE id = ?').get(id)) {
      return id
    }

    // 升级前的工程没有位置记录时，用最近一次带段号的 AI 操作作为一次性回退。
    const recent = db.prepare(
      `SELECT p.id FROM ai_log a
       JOIN paragraph p ON p.id = a.paragraph_id
       WHERE a.paragraph_id IS NOT NULL
       ORDER BY a.id DESC LIMIT 1`
    ).get() as { id: number } | undefined
    return recent?.id ?? null
  })

  ipcMain.handle('paragraph:setLastViewed', async (_event, rawId) => {
    const id = Number(rawId)
    if (!Number.isInteger(id) || id < 1) return
    const db = getDb()
    if (!db.prepare('SELECT 1 FROM paragraph WHERE id = ?').get(id)) return
    db.prepare(
      "INSERT OR REPLACE INTO project_meta (key, value) VALUES ('last_viewed_paragraph_id', ?)"
    ).run(String(id))
  })

  // 进度统计
  ipcMain.handle('paragraph:progress', async () => {
    const db = getDb()
    const total = (db.prepare('SELECT COUNT(*) AS n FROM paragraph').get() as { n: number }).n
    const done = (db.prepare(`SELECT COUNT(*) AS n FROM paragraph WHERE status = 'done'`).get() as { n: number }).n
    const review = (db.prepare(`SELECT COUNT(*) AS n FROM paragraph WHERE status = 'review'`).get() as { n: number }).n
    return {
      total,
      done,
      review,
      percent: total > 0 ? Math.round((done / total) * 100) : 0
    }
  })
}
