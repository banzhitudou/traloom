/**
 * 译稿对齐 IPC handlers（两段式对齐）
 * channel: align:similarity / align:aiJudge / align:commit
 * 第一遍相似度匹配（本文件实现），第二遍 AI 判定（S5 接入 LLM）。
 */
import { recordedIpc as ipcMain } from './recorded-ipc'
import { getDb, getCurrentDbPath } from '../db'
import { parseDraftMd } from '../services/draft-parser'
import { similarityMatch, alignStats } from '../services/aligner'
import type { AlignResult } from '@shared/types'
import { authorizeProjectFile } from '../services/project-file-permissions'

interface ParagraphRow {
  id: number
  en_text: string
}

interface TranslationCommit {
  jsonId: number
  zh: string
}

function collectTranslations(adjustments: AlignResult[], status: AlignResult['status']): TranslationCommit[] {
  const byJsonId = new Map<number, string[]>()

  for (const a of adjustments) {
    if (a.status !== status) continue
    if (a.jsonId < 0) continue
    const zh = a.zh.trim()
    if (!zh) continue

    const parts = byJsonId.get(a.jsonId) ?? []
    parts.push(zh)
    byJsonId.set(a.jsonId, parts)
  }

  return [...byJsonId.entries()].map(([jsonId, parts]) => ({
    jsonId,
    zh: parts.join('\n\n')
  }))
}

/** 从库里读段落 + 从元信息读译稿路径，跑相似度对齐 */
export function registerAlignHandlers(): void {
  // 第一遍：相似度匹配
  ipcMain.handle('align:similarity', async () => {
    const db = getDb()

    // 读译稿路径
    const draftRow = db.prepare("SELECT value FROM project_meta WHERE key = 'draft_md_path'").get() as
      | { value: string }
      | undefined
    if (!draftRow?.value) {
      return []   // 无译稿，跳过对齐
    }

    // 解析译稿
    const draftPath = await authorizeProjectFile(getCurrentDbPath()!, draftRow.value, '.md')
    if (db !== getDb()) throw new Error('工程已切换，请重试。')
    const drafts = parseDraftMd(draftPath)

    // 读段落（英文）
    const rows = db.prepare(
      'SELECT id, en_text FROM paragraph ORDER BY page_idx ASC, sort_order ASC, id ASC'
    ).all() as ParagraphRow[]
    const jsonBlocks = rows.map((r) => ({ id: r.id, en: r.en_text }))

    // 跑对齐
    const results = similarityMatch(drafts, jsonBlocks)
    const stats = alignStats(results)
    console.log(`[align] 对齐完成: ${stats.aligned}/${stats.total} 覆盖率 ${stats.coverage}%`)
    return results
  })

  // 第二遍：AI 判定单个待核对段
  // TODO(S5): 接入 LLM，取上下文判定 mismatch/match + shift 建议
  ipcMain.handle('align:aiJudge', async (_event, _args: { jsonId: number; draftIdx: number }) => {
    return { verdict: 'match' as const, shift: 0, reason: 'AI 判定功能待实现（S5）' }
  })

  // 确认对齐结果入库：自动对齐只代表已有译文，不代表译者已经人工确认。
  ipcMain.handle('align:commit', async (_event, adjustments: AlignResult[]) => {
    const db = getDb()
    if (!Array.isArray(adjustments) || adjustments.length > 100000 || adjustments.some(a => !a || typeof a !== 'object'
      || !Number.isSafeInteger(a.jsonId) || a.jsonId < -1 || typeof a.zh !== 'string' || a.zh.length > 1000000
      || !['aligned', 'pending'].includes(a.status))) throw new Error('无效的译稿对齐数据。')
    for (const entry of adjustments.filter(a => a.jsonId >= 0 && ['aligned', 'pending'].includes(a.status))) {
      if (!db.prepare('SELECT 1 FROM paragraph WHERE id=?').get(entry.jsonId)) throw new Error('对齐目标段落不存在。')
    }
    return db.transaction(() => {
    const updateTranslation = db.prepare(
      'UPDATE paragraph SET zh_text = ?, status = ? WHERE id = ?'
    )

    const updateMany = db.transaction((entries: TranslationCommit[]) => {
      for (const entry of entries) {
        updateTranslation.run(entry.zh, 'doing', entry.jsonId)
      }
    })
    updateMany(collectTranslations(adjustments, 'aligned'))

    // 标记 pending 段为 review
    const reviewMany = db.transaction((entries: TranslationCommit[]) => {
      for (const entry of entries) {
        updateTranslation.run(entry.zh, 'review', entry.jsonId)
      }
    })
    reviewMany(collectTranslations(adjustments, 'pending'))

    const ready = (db.prepare("SELECT COUNT(*) AS n FROM paragraph WHERE status = 'doing'").get() as { n: number }).n
    return { ok: true, doneCount: ready }
    })()
  })
}
