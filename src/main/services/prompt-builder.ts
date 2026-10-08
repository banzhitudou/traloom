/**
 * AI 提示词构建器。
 * 五种任务：整段参考 / 难句分析 / 难词解释 / 一致性检查 / 对齐判定。
 * 结构：通用角色 + 术语约束（按段筛选） + 风格指南 + 任务专属指令。
 * 来源：《技术方案文档》第 6.2 节。
 */
import { filterTermsForSegment, formatTermsForPrompt } from './glossary-service'
import type { ReferenceProfile } from '../../shared/ipc-api'

export interface PromptContext {
  /** 当前段英文原文（整段任务用） */
  enText?: string
  /** 选中的词/句（难词、难句用） */
  selection?: string
  /** 风格指南全文 */
  styleGuide?: string
  /** 译者已写的译文（一致性检查用） */
  zhDraft?: string
}

/** 通用系统提示词头部 */
function systemHeader(styleGuide?: string): string {
  return [
    '你是专业英中图书翻译的辅助助手。你的角色是"顾问"，帮助译者理解原文、提供参考，最终译文由译者本人决定。所有解释用简体中文。',
    styleGuide ? `\n【风格指南】\n${styleGuide}` : ''
  ].join('')
}

/** 整段参考译文 */
export function buildWholeParaPrompt(ctx: PromptContext): { system: string; user: string } {
  const terms = filterTermsForSegment(ctx.enText || '')
  const system = [
    systemHeader(ctx.styleGuide),
    `\n【术语约束】\n必须使用以下既定译名，不得更改：\n${formatTermsForPrompt(terms)}`
  ].join('')
  const user = `请将以下英文翻译为通顺的中文，标注你用到的术语：\n\n${ctx.enText}`
  return { system, user }
}

/** 多译法参考：让译者在不同表达方向中选择，而不是把单一答案直接写入译稿。 */
export function buildTranslationOptionsPrompt(ctx: PromptContext & { count?: number; instructions?: string; profiles?: ReferenceProfile[] }): { system: string; user: string } {
  const terms = filterTermsForSegment(ctx.enText || '')
  const system = [
    systemHeader(),
    `\n【术语约束】\n必须使用以下既定译名，不得更改：\n${formatTermsForPrompt(terms)}`
  ].join('')
  const count = ctx.profiles?.length ?? ctx.count ?? 1
  const profiles = ctx.profiles ?? Array.from({ length: count }, (_, index) => ({ name: `参考 ${index + 1}`, instructions: ctx.instructions ?? '' }))
  const user = `请为以下原文提供 ${count} 条中文译文参考。
按下列方案顺序分别生成，每个方案的翻译要求只适用于该方案，不要混用：
${JSON.stringify(profiles.map(profile => ({ name: profile.name, instructions: profile.instructions || '不预设特定读者年龄或文体，准确自然地翻译。' })))}
每一种译法都必须完整翻译给出的全部英文，不得省略句子或信息，不得为了缩短篇幅自行用省略号收尾。
如果英文原文本身不完整，只翻译已有内容并保持开放结尾，不得猜测或补写缺失内容。
只返回以下格式的 JSON，不要使用 Markdown 代码块，不要添加解释：
${JSON.stringify({ options: profiles.map(profile => ({ label: profile.name, text: '译文' })) })}
options 数组必须恰有 ${count} 项，顺序和名称必须与上述方案一致。

原文：${ctx.enText}`
  return { system, user }
}

/** OCR 断行整理：只修复版面造成的换行，不润色、不翻译。 */
export function buildOcrLineBreakPrompt(enText: string): { system: string; user: string } {
  const system = `你是英文 OCR 文本整理助手。只修复排版或 OCR 造成的意外断行，绝不翻译、润色、改写、补字或改动标点。
规则：
1. 同一句内的意外换行替换为一个空格。
2. 单词被行末换行拆开时接回；仅当它确实是断词时去掉行末连字符，正常的连字符复合词必须保留。
3. 真正的段落分隔保留为空行。
4. 原文没有换行问题时原样返回。
只返回 JSON：{"text":"整理后的英文"}，不要使用 Markdown 代码块。`
  return { system, user: `请整理以下 OCR 英文：\n\n${enText}` }
}

/** 难句分析 */
export function buildHardSentencePrompt(ctx: PromptContext): { system: string; user: string } {
  const system = systemHeader(ctx.styleGuide)
  const user = `请分析这个英文句子的翻译难点，按以下结构输出：
【句法】主句/从句结构
【难词】关键难词的释义
【关键短语】重要短语的含义
【参考译文】一版中文翻译
【决策建议】直译/意译建议及理由

原文：${ctx.selection || ctx.enText}`
  return { system, user }
}

/** 难词解释 */
export function buildHardWordPrompt(ctx: PromptContext): { system: string; user: string } {
  const system = systemHeader(ctx.styleGuide)
  const user = `请解释这个英文词/短语，按以下结构输出：
词性: 
释义: 
本书语境: （结合原文推断含义）
${ctx.enText ? `原文语境：${ctx.enText}` : ''}

要解释的词：${ctx.selection}`
  return { system, user }
}

/** 一致性检查 */
export function buildConsistencyPrompt(ctx: PromptContext): { system: string; user: string } {
  const system = systemHeader(ctx.styleGuide)
  const user = `请检查这段中文译文是否存在以下问题：
1. 术语是否准确、是否与原文一致
2. 是否有漏译、错译
3. 中文表达是否通顺

原文：${ctx.enText}
译文：${ctx.zhDraft}

请指出问题，没有问题则说"未发现问题"。`
  return { system, user }
}

/** 对齐判定（第二遍，严格 JSON 输出） */
export function buildAlignJudgePrompt(ctx: {
  mdEn: string
  jsonEn: string
  mdZh: string
}): { system: string; user: string } {
  const system = '你是译稿对齐助手。判断两段英文是否描述相同内容。只返回 JSON。'
  const user = `判断以下两段英文是否对应同一内容（可能文本差异大但语义相同）。

译稿英文：${ctx.mdEn}
原书英文：${ctx.jsonEn}

以 JSON 返回：{"verdict":"match"或"mismatch","reason":"简短理由"}`.replace(/\s+/g, ' ')
  return { system, user }
}
