/**
 * 术语服务：双保险策略。
 * 第一关（生成时）：按段筛选相关术语，注入 AI prompt。
 * 第二关（生成后）：全表校验 AI 输出，找出术语冲突。
 * 来源：《技术方案文档》第 6.2 节、决策③。
 */
import type { GlossaryEntry, TermConflict } from '@shared/types'
import type { Database } from 'better-sqlite3'

/** 全部术语（启动时载入内存，几百条不大） */
let allTerms: GlossaryEntry[] = []

export function loadGlossary(terms: GlossaryEntry[]): void {
  allTerms = terms
}

/** 从当前项目库重新载入，确保项目切换和术语修改后 AI 使用最新术语。 */
export function reloadGlossaryFromDatabase(db: Database): number {
  const terms = db.prepare(
    'SELECT id, category, en, zh, note FROM glossary ORDER BY id'
  ).all() as GlossaryEntry[]
  loadGlossary(terms)
  return terms.length
}

export function getAllTerms(): GlossaryEntry[] {
  return allTerms
}

/**
 * 第一关：按段筛选——找出当前段英文里出现的术语。
 * 用大小写不敏感的子串匹配。
 */
export function filterTermsForSegment(enText: string): GlossaryEntry[] {
  if (!enText) return []
  const lower = enText.toLowerCase()
  return allTerms.filter((t) => {
    if (!t.en) return false
    return lower.includes(t.en.toLowerCase())
  })
}

/**
 * 第二关：全表校验——扫描 AI 译文，找出术语不一致。
 * 检测：术语的英文出现在原文段里（说明该用既定译名），
 * 但 AI 译文里没有该译名（用错或漏了）。
 *
 * @param enOriginal 原文段
 * @param zhAiOutput AI 的中文译文
 * @returns 冲突列表
 */
export function checkTermConflicts(
  enOriginal: string,
  zhAiOutput: string
): TermConflict[] {
  const conflicts: TermConflict[] = []
  if (!enOriginal || !zhAiOutput) return []

  // 找原文里出现的术语
  const relevant = filterTermsForSegment(enOriginal)

  for (const term of relevant) {
    if (!term.zh) continue
    // 检查 AI 译文是否包含既定中文译名（支持多个译名，按 / 分隔）
    const acceptedZh = term.zh.split(/[/，,]/).map((s) => s.trim()).filter(Boolean)
    const hasCorrect = acceptedZh.some((zh) => zhAiOutput.includes(zh))
    if (!hasCorrect) {
      conflicts.push({
        en: term.en,
        expected: term.zh,
        actual: '(未使用既定译名)'
      })
    }
  }
  return conflicts
}

/** 把术语列表格式化为 prompt 用的文本 */
export function formatTermsForPrompt(terms: GlossaryEntry[]): string {
  if (terms.length === 0) return '（本段无既定术语）'
  return terms
    .map((t) => `- ${t.en} → ${t.zh}` + (t.note ? `（${t.note}）` : ''))
    .join('\n')
}
