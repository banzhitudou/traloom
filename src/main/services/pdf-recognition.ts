import type { Database } from 'better-sqlite3'
import type { RecognizedBlock } from '../../shared/ipc-api'
import { withRevisionContext } from './revision-history'

export function setRecognitionPaused(db: Database, paused: boolean): void {
  if (typeof paused !== 'boolean') throw new Error('无效的识别暂停状态。')
  db.prepare("INSERT INTO project_meta(key,value) VALUES('recognition_paused',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(paused ? '1' : '0')
}

export function isRecognitionPaused(db: Database): boolean {
  return (db.prepare("SELECT value FROM project_meta WHERE key='recognition_paused'").get() as { value: string } | undefined)?.value === '1'
}

export function commitRecognizedPage(db: Database, pageIdx: number, blocks: RecognizedBlock[], method: string): void {
  const total = Number((db.prepare("SELECT value FROM project_meta WHERE key='recognition_total'").get() as { value: string } | undefined)?.value)
  if (!Number.isInteger(pageIdx) || pageIdx < 0 || pageIdx >= total || !Array.isArray(blocks) || blocks.length > 10000) throw new Error('无效的识别页。')
  for (const block of blocks) {
    if (typeof block.text !== 'string' || block.text.length > 200000 || (block.ocrUnresolved !== undefined && typeof block.ocrUnresolved !== 'boolean') || !block.box ||
      Object.values(block.box).some(v => typeof v !== 'number' || !Number.isFinite(v)) ||
      block.box.left < 0 || block.box.top < 0 || block.box.width <= 0 || block.box.height <= 0 ||
      block.box.left + block.box.width > 1.001 || block.box.top + block.box.height > 1.001) throw new Error('无效的原文区域。')
  }
  if (db.prepare('SELECT 1 FROM recognized_page WHERE page_idx=?').get(pageIdx)) return
  if (db.prepare('SELECT 1 FROM paragraph WHERE page_idx=? LIMIT 1').get(pageIdx)) throw new Error('该页已有翻译段，为保护现有工程，未自动添加或覆盖。')
  withRevisionContext(db, '识别原书页面', 'import', { pageIdx, method }, () => db.transaction(() => {
    const insert = db.prepare("INSERT INTO paragraph(page_idx,type,en_text,zh_text,status,sort_order,bbox_json,raw_block) VALUES(?,'paragraph',?,'',?,?,?,?)")
    const insertNote = db.prepare('INSERT INTO paragraph_note(paragraph_id,content) VALUES(?,?)')
    const maximum = (db.prepare('SELECT COALESCE(MAX(sort_order),0) AS n FROM paragraph').get() as { n: number }).n
    blocks.filter(b => b.text.trim()).forEach((b, i) => {
      const box = [b.box.left, b.box.top, b.box.left + b.box.width, b.box.top + b.box.height]
      const result = insert.run(pageIdx, b.text.trim(), b.ocrUnresolved ? 'review' : 'todo', maximum + i + 1, JSON.stringify(box), JSON.stringify({ ...b, method }))
      if (b.ocrUnresolved) insertNote.run(result.lastInsertRowid, 'PDF 文字层编码异常，本机 OCR 两次未识别到文字。暂时保留文字层原文和坐标，请对照 PDF 核对；可调整识别区域后重新识别。')
    })
    db.prepare('INSERT INTO recognized_page(page_idx,method,blocks_json) VALUES(?,?,?)').run(pageIdx, method, JSON.stringify(blocks))
  })())
}
