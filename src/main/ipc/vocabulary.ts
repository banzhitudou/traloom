import { ipcMain } from './secure-ipc'
import { getDb } from '../db'
import { getReaderVocabulary, type KnownVocabularyEntry } from '../services/reader-vocabulary'
import type { VocabularySuggestion } from '@shared/types'

export function registerVocabularyHandlers(): void {
  ipcMain.handle('vocabulary:suggestions', (_event, paragraphId: number): VocabularySuggestion[] => {
    const db = getDb()
    const paragraph = db.prepare('SELECT en_text FROM paragraph WHERE id=?').get(paragraphId) as { en_text: string } | undefined
    if (!paragraph) return []
    const terms = db.prepare('SELECT en,zh,note FROM glossary ORDER BY length(en) DESC').all() as Omit<KnownVocabularyEntry, 'source'>[]
    return getReaderVocabulary(paragraph.en_text, terms.map(term => ({ ...term, source: 'glossary' })), 10)
  })
}
