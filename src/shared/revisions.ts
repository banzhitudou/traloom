export type RevisionSource = 'human' | 'ai' | 'import' | 'unknown'
export interface RevisionEntry {
  id: number
  operationId: string
  createdAt: string
  kind: string
  entityId: string
  entityUuid: string
  action: string
  source: RevisionSource
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  sequenceBefore: number | null
  sequenceAfter: number | null
  metadata: Record<string, unknown>
  contextId: string
  neighbors: unknown[]
  liveParagraphId: number | null
}
export interface RevisionFilter {
  paragraphId?: number
  entityUuid?: string
  query?: string
  source?: RevisionSource | ''
  from?: string
  to?: string
  beforeId?: number
  limit?: number
}
export interface RevisionPage { entries: RevisionEntry[]; total: number; nextId: number | null }
export interface RevisionDetail {
  entry: RevisionEntry
  environment: unknown
  related: { id: number; kind: string; entity_id: string; action: string }[]
  annotation: { category: string; reason: string }
  currentState: string | null
}
export interface RestoreRevisionParams {
  id: number
  side: 'before' | 'after'
  field: string
  expected: string | null
}
export const REVISION_FIELDS: Record<string, string> = {
  en_text: '原文', zh_text: '译文', status: '状态', bbox_json: '坐标区域',
  sort_order: '段落顺序', page_idx: 'PDF 页码', type: '段落类型',
  content: '备注／文档', en: '外文术语', zh: '标准译名', category: '分类', note: '备注', value: '项目内容', previous_zh: '替换前译文'
}
export const REVISION_SOURCES: Record<RevisionSource, string> = { human: '人工操作', ai: 'AI 生成', import: '导入', unknown: '来源未知' }
export function changedRevisionFields(entry: Pick<RevisionEntry, 'before' | 'after'>): string[] {
  return [...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})])]
    .filter(key => key !== 'id' && key !== 'raw_block' && entry.before?.[key] !== entry.after?.[key])
}
export interface TextDifference { prefix: string; removed: string; added: string; suffix: string }
// Keep the complete changed span, including disjoint edits, without inventing a semantic explanation.
export function revisionTextDifference(before: string, after: string): TextDifference {
  const a = Array.from(before), b = Array.from(after)
  let start = 0, end = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++
  return { prefix: a.slice(0, start).join(''), removed: a.slice(start, a.length - end).join(''), added: b.slice(start, b.length - end).join(''), suffix: end ? a.slice(a.length - end).join('') : '' }
}
