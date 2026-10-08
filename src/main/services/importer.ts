/**
 * 数据导入服务。
 * 解析 content_list_v2.json（按页嵌套）→ 扁平化为段落 → 入库。
 * 来源：《技术方案文档》第 4.3 节、S2 任务。
 *
 * json 结构：顶层 = 每页一个数组，每页含若干块 {bbox, content, type}。
 * 文本藏在 content 的各种 *_content 字段里，按 type 不同路径不同。
 */
import { readFileSync } from 'fs'
import type { BlockType } from '@shared/types'

/** 需要跳过的块类型（非正文，不入 paragraph 表） */
const SKIP_TYPES = new Set<BlockType | string>([
  'image',              // 图片本身无文本（图注单独处理）
  'page_aside_text',    // 页边装饰文字
  'page_number',        // 页码
  'page_header',
  'page_footer'
])

interface RawBlock {
  bbox?: number[]
  type: string
  content: Record<string, unknown>
}

interface LegacyRawBlock {
  type?: string
  text?: string
  content?: string
  text_level?: number
  page_idx?: number
  bbox?: number[]
}

/** 扁平化后的段落（待入库） */
export interface FlatParagraph {
  pageIdx: number
  type: string
  enText: string
  bboxJson: string
  rawBlock: string
}

interface ModelBlock {
  type?: string
  content?: string
  bbox?: number[]
}

function normalizeMatchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 用 model.json 的归一化坐标补强 content_list 段落。
 * 两份数据都按 PDF 页组织，用规范化原文做一对一匹配。
 */
export function mergeModelCoordinates(
  paragraphs: FlatParagraph[],
  modelJsonPath: string
): FlatParagraph[] {
  const pages = JSON.parse(readFileSync(modelJsonPath, 'utf-8')) as ModelBlock[][]
  const usedByPage = new Map<number, Set<number>>()

  return paragraphs.map((paragraph) => {
    const target = normalizeMatchText(paragraph.enText)
    if (!target) return paragraph

    const page = pages[paragraph.pageIdx]
    if (!Array.isArray(page)) return paragraph
    const used = usedByPage.get(paragraph.pageIdx) ?? new Set<number>()
    usedByPage.set(paragraph.pageIdx, used)

    let bestIndex = -1
    let bestScore = 0
    for (let index = 0; index < page.length; index++) {
      if (used.has(index)) continue
      const block = page[index]
      if (!Array.isArray(block?.bbox) || block.bbox.length !== 4) continue
      const candidate = normalizeMatchText(String(block.content ?? ''))
      if (!candidate) continue

      let score = 0
      if (candidate === target) score = 1
      else if (candidate.includes(target)) score = target.length / candidate.length
      else if (target.includes(candidate)) score = candidate.length / target.length
      if (paragraph.type === 'title' && block.type === 'title') score += 0.1

      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    }

    if (bestIndex < 0 || bestScore < 0.55) return paragraph
    used.add(bestIndex)
    return { ...paragraph, bboxJson: JSON.stringify(page[bestIndex].bbox) }
  })
}

/**
 * 从一个原始块的 content 里提取纯文本。
 * 按 type 走不同路径。
 */
function extractText(type: string, content: Record<string, unknown>): string {
  const pick = (arr: unknown): string => {
    if (!Array.isArray(arr)) return ''
    return arr
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>
          // text 块：{ type: 'text', content: '...' }
          if (typeof obj.content === 'string') return obj.content
          // list item：{ item_content: [...] }
          if (Array.isArray(obj.item_content)) return pick(obj.item_content)
        }
        return ''
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  switch (type) {
    case 'title':
      return pick(content.title_content)
    case 'paragraph':
      return pick(content.paragraph_content)
    case 'list':
      // list_items 是数组，每项有 item_content
      return pick(content.list_items)
    case 'image':
      // 图注（image_caption），无图注则为空
      return pick(content.image_caption)
    default:
      // 兜底：尝试常见字段
      return pick(content[`${type}_content`])
  }
}

/**
 * 解析 content_list_v2.json，扁平化为段落列表。
 * @param jsonPath json 文件路径
 * @returns 段落数组（已按页+块顺序）
 */
export function parseContentJson(jsonPath: string): FlatParagraph[] {
  const raw = readFileSync(jsonPath, 'utf-8')
  const parsed = JSON.parse(raw) as unknown

  if (!Array.isArray(parsed)) return []
  if (parsed.length > 0 && !Array.isArray(parsed[0])) {
    const result: FlatParagraph[] = []
    for (const block of parsed as LegacyRawBlock[]) {
      const rawType = String(block.type ?? 'text')
      if (SKIP_TYPES.has(rawType) || ['header', 'footer', 'aside_text'].includes(rawType)) continue
      const enText = String(block.text ?? block.content ?? '').replace(/\s+/g, ' ').trim()
      if (!enText) continue
      const pageIdx = Number(block.page_idx)
      result.push({
        pageIdx: Number.isFinite(pageIdx) ? pageIdx : 0,
        type: rawType === 'text' && Number(block.text_level) > 0 ? 'title' : rawType === 'text' ? 'paragraph' : rawType,
        enText,
        bboxJson: JSON.stringify(block.bbox ?? []),
        rawBlock: JSON.stringify(block)
      })
    }
    return result
  }

  const pages = parsed as RawBlock[][]

  const result: FlatParagraph[] = []
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]
    if (!Array.isArray(page)) continue

    for (const block of page) {
      if (!block || typeof block.type !== 'string') continue
      if (SKIP_TYPES.has(block.type)) continue

      const enText = extractText(block.type, block.content || {})
      // 跳过空文本块（如无图注的图片）
      if (!enText) continue

      result.push({
        pageIdx,
        type: block.type,
        enText,
        bboxJson: JSON.stringify(block.bbox ?? []),
        rawBlock: JSON.stringify(block)
      })
    }
  }
  return result
}

// ──────────────────────────────────────────────
// 术语对照表解析（markdown 表格）
// ──────────────────────────────────────────────

export interface ParsedGlossaryEntry {
  category: string
  en: string
  zh: string
  note: string
}

/**
 * 解析《术语对照表.md》。
 * 格式：每个分类一个 `## 二级标题`，下方是四列表格
 *   | 英文原文 | 建议中文译名 | 简短说明 | 出现频次 |
 * 分类名取自二级标题（去掉"一、""二、"等序号前缀）。
 */
export function parseGlossaryMd(mdPath: string): ParsedGlossaryEntry[] {
  const raw = readFileSync(mdPath, 'utf-8')
  const lines = raw.split(/\r?\n/)

  const result: ParsedGlossaryEntry[] = []
  let currentCategory = '其他'
  let inTable = false

  const stripPrefix = (s: string): string =>
    // 去掉"一、""二、"等中文序号前缀
    s.replace(/^[一二三四五六七八九十百]+[、.\s]+/, '').trim()

  for (const line of lines) {
    const trimmed = line.trim()

    // 二级标题 = 新分类
    if (trimmed.startsWith('## ')) {
      currentCategory = stripPrefix(trimmed.slice(3)) || '其他'
      inTable = false
      continue
    }

    // 分隔线（表格边界）— 如 |---|---|
    if (/^\|[\s:|-]+\|?$/.test(trimmed)) {
      inTable = true
      continue
    }

    // 表格行
    if (inTable && trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim())
      // 跳过表头行（英文原文/建议中文译名...）
      if (cells[0] === '英文原文' || cells.length < 2) continue

      const en = cells[0]
      const zh = cells[1] ?? ''
      const note = cells[2] ?? ''
      if (!en) continue

      result.push({ category: currentCategory, en, zh, note })
    } else if (!trimmed.startsWith('|')) {
      // 离开表格
      inTable = false
    }
  }
  return result
}

// ──────────────────────────────────────────────
// 人名辞典 / 地名手册导入（Excel → FTS5）
// ──────────────────────────────────────────────

export interface DictRow {
  en: string
  zh: string
  source: string
}

/**
 * 解析人名辞典 Excel 文件。
 * 实测结构：每行 = [序号, 姓名, 国别, 中文译名]，需跳过"部分标题"和字母分隔行。
 * 判定有效行：第2列(姓名)是纯字母/含变音符号、且第4列(译名)含中文。
 */
export function parseNameDict(filePath: string): DictRow[] {
  // 动态 require 避免 xlsx 在不支持的环境报错
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XLSX = require('xlsx')
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][]

  const result: DictRow[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue
    const name = String(row[1] ?? '').trim()
    const country = String(row[2] ?? '').trim()
    const zh = String(row[3] ?? '').trim()

    // 跳过：姓名为空、译名不含中文（字母分隔行如"A"）、译名为空
    if (!name || !zh) continue
    if (!/[\u4e00-\u9fa5]/.test(zh)) continue
    // 跳过部分标题行（姓名字段是整段中文说明）
    if (/^第.*部分/.test(name)) continue

    result.push({ en: name, zh, source: country })
  }
  return result
}

/**
 * 解析地名手册 Excel 文件。
 * 实测结构：每行 = [序号, 地名, 国别简写, 中文译名]，同样跳过字母分隔行。
 */
export function parsePlaceDict(filePath: string): DictRow[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XLSX = require('xlsx')
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][]

  const result: DictRow[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue
    // 跳过表头行 [Column1, Column2, ...]
    if (String(row[0] ?? '') === 'Column1') continue

    const place = String(row[1] ?? '').trim()
    const country = String(row[2] ?? '').trim()
    const zh = String(row[3] ?? '').trim()

    if (!place || !zh) continue
    if (!/[\u4e00-\u9fa5]/.test(zh)) continue

    result.push({ en: place, zh, source: country })
  }
  return result
}
