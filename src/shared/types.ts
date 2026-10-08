/**
 * 共享类型定义
 * 被 主进程 / preload / 渲染进程 三方引用，是跨进程的"契约层"。
 * 来源：《技术方案文档》第 4 节数据模型。
 */

/** 段落类型（来自 content_list_v2.json 的 type 字段） */
export type BlockType =
  | 'title'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'image'
  | 'page_aside_text'
  | 'page_number'
  | 'page_header'
  | 'page_footer'

/** 段落状态机（与 UI 线框图 [5] 状态机对应） */
export type ParaStatus = 'todo' | 'doing' | 'done' | 'review'

/**
 * 段落（核心数据结构，对应 paragraph 表）
 * 最小编辑单元——一个 title / paragraph / list 块。
 */
export interface Paragraph {
  id: number
  pageIdx: number          // 所在页（0-based，pdf.js 用）
  type: BlockType
  enText: string
  zhText: string
  status: ParaStatus
  bboxJson: string         // 原始 bbox 坐标（JSON 数组，M2 高亮用）
  rawBlock: string         // 原始 JSON 块（保留，调试/重建用）
}

/** 术语分类（来自 术语对照表.md） */
export type GlossaryCategory = string

/** 术语条目（对应 glossary 表） */
export interface GlossaryEntry {
  id: number
  category: GlossaryCategory
  en: string
  zh: string
  note: string
}

export interface GlossaryInput {
  en: string
  zh: string
  category: string
  note: string
}

export type GlossaryReviewStatus = 'pending' | 'replaced' | 'kept' | 'review'

export interface GlossaryImpact {
  id: number
  changeId: number
  paragraphId: number
  pageIdx: number
  enText: string
  zhText: string
  paragraphStatus: ParaStatus
  reviewStatus: GlossaryReviewStatus
  oldEn: string
  newEn: string
  oldZh: string
  newZh: string
  canReplace: boolean
  canUndo: boolean
}

/** LLM 协议。旧项目中的 `openai` 会在主进程读取时迁移为 openai_chat。 */
export type LlmProtocol = 'openai_chat' | 'openai_responses' | 'anthropic'

/** LLM 配置（对应 llm_config 表；api_key 主进程内解密，不外泄给渲染层） */
export interface LlmConfig {
  id: number
  name: string
  protocol: LlmProtocol
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  systemPrompt: string
  isDefault: boolean
}

export interface LlmStatus {
  state: 'unconfigured' | 'configured' | 'online' | 'error'
  configName?: string
  model?: string
  checkedAt?: string
  error?: string
}

/** AI 任务类型（决定用哪个模型配置 + 哪套提示词） */
export type AiTask =
  | 'whole_para'      // 整段参考
  | 'hard_sentence'   // 难句分析
  | 'hard_word'       // 难词解释
  | 'consistency'     // 一致性检查
  | 'align'           // 对齐判定

/** 译稿对齐状态（两段式对齐的中间产物） */
export type AlignStatus = 'aligned' | 'pending'

/** 对齐结果单项（对齐预览表的一行） */
export interface AlignResult {
  jsonId: number            // 对应 paragraph.id（-1 表示 json 侧没有对应块）
  draftIdx: number          // 在 md 配对列表中的下标（-1 表示 md 侧没有）
  similarity: number        // 0-1 相似度
  status: AlignStatus
  enMd: string              // 来自 md 的英文
  enJson: string            // 来自 json 的英文
  zh: string                // 来自 md 的中文译文
}

/** 对齐时 AI 判定结果（第二遍） */
export interface AiAlignVerdict {
  verdict: 'mismatch' | 'match'
  shift: number             // 若 mismatch，建议上移(负)/下移(正)几行
  reason: string
}

/** 进度统计 */
export interface Progress {
  total: number
  done: number
  review: number
  percent: number
}

/** 术语冲突（第二关全表校验产物） */
export interface TermConflict {
  en: string              // 词汇表英文
  expected: string        // 词汇表既定译名
  actual: string          // AI 实际用的译法
}

export interface AssistantMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  paragraphId: number | null
  createdAt: string
}

export interface VocabularySuggestion {
  en: string
  zh: string
  note: string
  phonetic?: string
  source?: 'glossary' | 'name' | 'place' | 'dictionary'
  matchedText?: string
}

export interface ProjectDocumentSummary {
  id: number
  path: string
  title: string
  kind: string
  updatedAt: string
}

export interface ProjectDocument extends ProjectDocumentSummary {
  content: string
}
