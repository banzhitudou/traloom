import type { Database } from 'better-sqlite3'
import type { RecognizedBlock } from '../../shared/ipc-api'
import { withRevisionContext } from './revision-history'

export function commitRecognizedPage(db: Database, pageIdx: number, blocks: RecognizedBlock[], method: string): void {
  const total = Number((db.prepare("SELECT value FROM project_meta WHERE key='recognition_total'").get() as { value: string } | undefined)?.value)
  if (!Number.isInteger(pageIdx) || pageIdx < 0 || pageIdx >= total || !Array.isArray(blocks) || blocks.length > 10000) throw new Error('无效的识别页。')
  for (const block of blocks) {
    if (typeof block.text !== 'string' || block.text.length > 200000 || !block.box ||
      Object.values(block.box).some(v => typeof v !== 'number' || !Number.isFinite(v)) ||
      block.box.left < 0 || block.box.top < 0 || block.box.width <= 0 || block.box.height <= 0 ||
      block.box.left + block.box.width > 1.001 || block.box.top + block.box.height > 1.001) throw new Error('无效的原文区域。')
  }
  if (db.prepare('SELECT 1 FROM recognized_page WHERE page_idx=?').get(pageIdx)) return
  withRevisionContext(db, '识别原书页面', 'import', { pageIdx, method }, () => db.transaction(() => {
    const insert = db.prepare("INSERT INTO paragraph(page_idx,type,en_text,zh_text,status,sort_order,bbox_json,raw_block) VALUES(?,'paragraph',?,'','todo',?,?,?)")
    const maximum = (db.prepare('SELECT COALESCE(MAX(sort_order),0) AS n FROM paragraph').get() as { n: number }).n
    blocks.filter(b => b.text.trim()).forEach((b, i) => {
      const box = [b.box.left, b.box.top, b.box.left + b.box.width, b.box.top + b.box.height]
      insert.run(pageIdx, b.text.trim(), maximum + i + 1, JSON.stringify(box), JSON.stringify({ ...b, method }))
    })
    db.prepare('INSERT INTO recognized_page(page_idx,method,blocks_json) VALUES(?,?,?)').run(pageIdx, method, JSON.stringify(blocks))
  })())
}
