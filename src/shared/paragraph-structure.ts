import type { BlockType, ParaStatus } from './types'

export interface MergeParagraphInput {
  id: number
  type: BlockType
  enText: string
  zhText: string
  status: ParaStatus
  bboxJson: string
  rawBlock: string
  note?: string
  reviews?: { change_id: number; status: string; previous_zh: string | null; updated_at: string }[]
  aiLogIds?: number[]
  assistantMessageIds?: number[]
}

export interface MergedParagraphData {
  type: BlockType
  enText: string
  zhText: string
  status: ParaStatus
  bboxJson: string
  rawBlock: string
}

function readBoxes(bboxJson: string): number[][] {
  try {
    const value = JSON.parse(bboxJson) as unknown
    if (!Array.isArray(value)) return []
    if (value.length === 4 && value.every((item) => Number.isFinite(Number(item)))) {
      return [value.map(Number)]
    }
    return value
      .filter((item): item is unknown[] => Array.isArray(item) && item.length === 4)
      .map((item) => item.map(Number))
      .filter((item) => item.every(Number.isFinite))
  } catch {
    return []
  }
}

function readRawBlock(rawBlock: string): unknown {
  try {
    return JSON.parse(rawBlock)
  } catch {
    return rawBlock
  }
}

export function mergeParagraphData(rows: MergeParagraphInput[]): MergedParagraphData {
  if (rows.length < 2) throw new Error('至少选择两个翻译段才能合并。')
  const translations = rows.map((row) => row.zhText.trim()).filter(Boolean)
  return {
    type: rows[0].type,
    enText: rows.map((row) => row.enText.trim()).filter(Boolean).join(' '),
    zhText: translations.join('\n\n'),
    status: translations.length > 0 ? 'review' : 'todo',
    bboxJson: JSON.stringify(rows.flatMap((row) => readBoxes(row.bboxJson))),
    rawBlock: JSON.stringify({
      source: 'merged_translation_segments',
      mergedParagraphIds: rows.map((row) => row.id),
      originalBlocks: rows.map((row) => ({
        id: row.id,
        type: row.type,
        enText: row.enText,
        zhText: row.zhText,
        status: row.status,
        bboxJson: row.bboxJson,
        note: row.note,
        reviews: row.reviews,
        aiLogIds: row.aiLogIds,
        assistantMessageIds: row.assistantMessageIds,
        rawBlock: readRawBlock(row.rawBlock)
      }))
    })
  }
}

export function getMergedParagraphParts(rawBlock: string): MergeParagraphInput[] {
  try {
    const value = JSON.parse(rawBlock)
    if (value.source !== 'merged_translation_segments' || !Array.isArray(value.originalBlocks) || value.originalBlocks.length < 2) return []
    const parts = value.originalBlocks
    if (parts.some((part: any) => !Number.isSafeInteger(part.id) || part.id < 1 || typeof part.enText !== 'string' || typeof part.zhText !== 'string' || typeof part.bboxJson !== 'string' || typeof part.type !== 'string' || !['todo', 'doing', 'done', 'review'].includes(part.status))) return []
    if (new Set(parts.map((part: any) => part.id)).size !== parts.length) return []
    return parts.map((part: any) => ({ ...part, rawBlock: typeof part.rawBlock === 'string' ? part.rawBlock : JSON.stringify(part.rawBlock ?? {}) }))
  } catch { return [] }
}
