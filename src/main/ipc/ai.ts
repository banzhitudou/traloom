/**
 * AI 调用 IPC handlers
 * channel: ai:call
 * 流程：选配置 → 取上下文(术语+风格指南) → 构建 prompt → 调 LLM → 术语全表校验 → 入 log
 */
import { ipcMain } from 'electron'
import { getDb } from '../db'
import { getConfigForTask } from './llm'
import { loggedChat } from '../services/logged-llm'
import { checkTermConflicts } from '../services/glossary-service'
import {
  buildTranslationOptionsPrompt,
  buildOcrLineBreakPrompt
} from '../services/prompt-builder'
import type { AiTask } from '@shared/types'
import type { AiCallResult } from '@shared/ipc-api'
import { parseTranslationOptions } from '../../shared/translation-options'
import { migrateReferenceSettings, validateReferenceSettings } from '../../shared/reference-settings'
import type { ReferenceSettings } from '../../shared/ipc-api'

interface ParagraphRow {
  en_text: string
  zh_text: string
}

/** 取段落数据 */
function getParagraph(id: number): ParagraphRow | null {
  const db = getDb()
  const row = db.prepare('SELECT en_text, zh_text FROM paragraph WHERE id = ?').get(id) as
    | ParagraphRow
    | undefined
  return row ?? null
}

/** 取风格指南 */
function getStyleGuide(): string {
  return ''
}

function referenceSettings(): ReferenceSettings {
  const rows = getDb().prepare("SELECT key,value FROM project_meta WHERE key IN ('reference_profiles','reference_count','reference_instructions')").all() as { key: string; value: string }[]
  const meta = Object.fromEntries(rows.map(r => [r.key,r.value]))
  if (meta.reference_profiles) {
    const profiles = JSON.parse(meta.reference_profiles)
    return validateReferenceSettings({ count: profiles.length, profiles })
  }
  return migrateReferenceSettings(Number(meta.reference_count || 1), meta.reference_instructions || '')
}

/** 写 AI 日志 */
function logAi(paragraphId: number | undefined, task: AiTask, input: string, output: string): void {
  try {
    const db = getDb()
    db.prepare(
      `INSERT INTO ai_log (paragraph_id, task, input_text, output_text, adopted, created_at)
       VALUES (?, ?, ?, ?, 0, datetime('now'))`
    ).run(paragraphId ?? null, task, input, output)
  } catch {
    // 日志失败不影响主流程
  }
}

export function registerAiHandlers(): void {
  ipcMain.handle('ai:referenceSettings', () => referenceSettings())
  ipcMain.handle('ai:saveReferenceSettings', (_event, input: ReferenceSettings) => {
    const settings = validateReferenceSettings(input)
    getDb().transaction(() => {
      const save = getDb().prepare('INSERT INTO project_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      save.run('reference_count', String(settings.count))
      save.run('reference_profiles', JSON.stringify(settings.profiles))
    })()
  })
  ipcMain.handle('ai:cleanOcrLineBreaks', async (_event, input: string, paragraphId?: number): Promise<AiCallResult> => {
    const enText = String(input ?? '').trim()
    if (!enText) return { ok: false, error: '请先识别或输入英文原文。' }
    const config = await getConfigForTask('whole_para')
    if (!config) return { ok: false, error: '未配置整段翻译模型，无法整理断行。' }
    const prompt = buildOcrLineBreakPrompt(enText)
    const result = await loggedChat(config, [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ], 'ocr_line_breaks', paragraphId)
    if (!result.ok || !result.text) return { ok: false, error: result.error ?? 'AI 调用失败' }

    const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    let text = ''
    try {
      const parsed = JSON.parse(cleaned) as { text?: unknown }
      text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    } catch {
      text = cleaned
    }
    if (!text) return { ok: false, error: '模型没有返回可用的整理结果，请重试。' }
    logAi(paragraphId, 'whole_para', prompt.user, text)
    return { ok: true, text, generationId: result.generationId }
  })

  ipcMain.handle('ai:translationOptions', async (_event, paragraphId: number): Promise<AiCallResult> => {
    const config = await getConfigForTask('whole_para')
    if (!config) return { ok: false, error: '未配置模型。请在“设置”里添加模型配置。' }
    const para = getParagraph(paragraphId)
    if (!para?.en_text.trim()) return { ok: false, error: '当前段没有可供翻译的英文原文。' }
    const settings = referenceSettings()
    const prompt = buildTranslationOptionsPrompt({
      ...settings,
      enText: para.en_text,
      zhDraft: para.zh_text,
      styleGuide: getStyleGuide()
    })
    const result = await loggedChat(config, [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ], 'translation_options', paragraphId)
    if (!result.ok || !result.text) return { ok: false, error: result.error ?? 'AI 调用失败' }
    const translationOptions = parseTranslationOptions(result.text, settings.count)
    if (translationOptions.length !== settings.count) {
      return { ok: false, error: `模型未完整返回 ${settings.count} 条译文参考，请重试。` }
    }
    translationOptions.forEach((option, index) => { option.label = settings.profiles[index].name })
    logAi(paragraphId, 'whole_para', prompt.user, result.text)
    return {
      ok: true,
      text: result.text,
      translationOptions,
      generationId: result.generationId,
      termConflicts: checkTermConflicts(para.en_text, translationOptions.map((option) => option.text).join('\n'))
    }
  })

}
