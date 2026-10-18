export type BatchTask = 'clean' | 'translate' | 'vision'
export interface BatchScope { task: BatchTask; from?: number; to?: number; profileIndex?: number }
export interface BatchCandidate {
  id: number; sequence: number; pageIdx: number; source: string; draft: string; status: string; identity: string
  state: 'pending' | 'running' | 'candidate' | 'applied' | 'failed' | 'skipped' | 'discarded'
  output?: string; generationId?: number; error?: string
  bboxJson?: string
}
export interface BatchPlan {
  eligible: BatchCandidate[]; total: number; existing: number; unchanged: number; empty: number; characters: number
}
export interface BatchJob {
  id: string; task: BatchTask; createdAt: string; instructions: string
  state: 'paused' | 'running' | 'completed' | 'cancelled'; items: BatchCandidate[]; message: string; inFlight?: boolean
}
export function validateBatchScope(scope: BatchScope, total: number): BatchScope {
  if (!scope || !['clean', 'translate', 'vision'].includes(scope.task)) throw new Error('请选择批量处理任务。')
  const from = scope.from ?? 1, to = scope.to ?? total
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > total) throw new Error('段落区间无效。')
  return { task: scope.task, from, to }
}
export function canApplyBatch(item: BatchCandidate, live?: { en_text: string; zh_text: string; status: string; identity: string; bbox_json?: string }): boolean {
  return !!live && !live.zh_text.trim() && live.en_text === item.source && live.zh_text === item.draft && live.status === item.status && live.identity === item.identity && (item.bboxJson === undefined || item.bboxJson === live.bbox_json)
}
export function parseBatchOutput(output: string): string {
  const cleaned = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown
  try { parsed = JSON.parse(cleaned) } catch { throw new Error('模型未返回完整的 JSON 结果，请查看记录后重试。') }
  const text = (parsed as { text?: unknown } | null)?.text
  if (typeof text !== 'string' || !text.trim() || text.length > 200000) throw new Error('模型未返回可用文本。')
  return text.trim()
}

export function validateCleanedText(source: string, output: string): void {
  const parts = source.split(/-[ \t]*\r?\n[ \t]*/).map(part => part.replace(/\s+/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!new RegExp(`^${parts.join('-?')}$`, 'u').test(output.replace(/\s+/g, ''))) throw new Error('整理结果改动了原文文字或标点，已拦截；请查看结果记录并人工核对。')
}
