import type { Database } from 'better-sqlite3'
import { withRevisionContext } from './revision-history'

export function originalRecognition(db: Database, id: number): string | null {
  const row = db.prepare('SELECT raw_block FROM paragraph WHERE id=?').get(id) as { raw_block: string } | undefined
  if (!row) return null
  try {
    const raw = JSON.parse(row.raw_block)
    if (raw.source === 'merged_translation_segments') return null
  } catch { /* Historical projects may not have structured raw blocks. */ }
  const first = db.prepare("SELECT coalesce(before_json,after_json) AS after_json FROM revision_event WHERE kind='paragraph' AND entity_id=? AND entity_uuid=(SELECT uuid FROM revision_identity WHERE kind='paragraph' AND entity_id=? AND active=1) AND (before_json IS NOT NULL OR after_json IS NOT NULL) ORDER BY id LIMIT 1").get(String(id), String(id)) as { after_json: string } | undefined
  if (first) {
    const value = JSON.parse(first.after_json).en_text
    if (typeof value === 'string' && value.trim()) return value
  }
  try { const raw = JSON.parse(row.raw_block); return typeof raw.text === 'string' && raw.text.trim() ? raw.text : null } catch { return null }
}

export function restoreRecognition(db: Database, from: number, to: number): { restored: number; skipped: number } {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from) throw new Error('恢复区间无效。')
  const rows = db.prepare('SELECT id,en_text FROM paragraph ORDER BY sort_order,id LIMIT ? OFFSET ?').all(to - from + 1, from - 1) as { id: number; en_text: string }[]
  let restored = 0, skipped = 0
  withRevisionContext(db, '恢复原始识别', 'human', { from, to }, () => db.transaction(() => {
    for (const row of rows) {
      const text = originalRecognition(db, row.id)
      if (text === null || text === row.en_text) { skipped++; continue }
      db.prepare("UPDATE paragraph SET en_text=?,status=CASE WHEN trim(zh_text)<>'' OR status='done' THEN 'review' ELSE status END WHERE id=?").run(text, row.id)
      restored++
    }
  })())
  return { restored, skipped }
}
