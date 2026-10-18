import type { Database } from 'better-sqlite3'
import { readOcrSettings, validateOcrSettings, type OcrSettings } from '../../shared/ocr-settings'
export function getOcrSettings(db: Database): OcrSettings {
  return readOcrSettings(Object.fromEntries((db.prepare("SELECT key,value FROM project_meta WHERE key IN ('ocr_language','ocr_direction')").all() as { key: string; value: string }[]).map(row => [row.key, row.value])))
}
export function saveOcrSettings(db: Database, input: OcrSettings): void {
  const settings = validateOcrSettings(input)
  db.transaction(() => {
    const save = db.prepare('INSERT INTO project_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    save.run('ocr_language', settings.language); save.run('ocr_direction', settings.direction)
    save.run('src_lang', settings.language === 'jpn' ? 'ja' : 'en')
  })()
}
