import { getParagraphSequenceNumbers } from './paragraph-numbering'

export interface ExportParagraph {
  id: number
  page_idx: number
  type: string
  en_text: string
  zh_text: string
  status: string
  note?: string
  bbox_json?: string
}

export interface TranslationExportOptions {
  content: 'zh' | 'bilingual'
  format: 'txt' | 'md' | 'docx' | 'html'
  scope: 'all' | 'done'
  includeNotes?: boolean
  includeProjectNote?: boolean
  includeStatus?: boolean
  includePageImages?: boolean
  pageFrom?: number
  pageTo?: number
  docxLayout?: 'table' | 'paragraphs'
  version?: string
  pageImages?: { pageIdx: number; dataUrl: string; width: number; height: number }[]
}

export function isExportPage(pageIdx: number, options: TranslationExportOptions): boolean {
  return (options.pageFrom === undefined || pageIdx + 1 >= options.pageFrom)
    && (options.pageTo === undefined || pageIdx + 1 <= options.pageTo)
}

export function validateExportRange(options: TranslationExportOptions): void {
  if (options.version !== undefined && !/^\d+(?:\.\d+)*$/.test(options.version)) throw new Error('版本号须为数字，可使用小数点分隔。')
  for (const value of [options.pageFrom, options.pageTo]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new Error('PDF 页码须为大于 0 的整数。')
  }
  if (options.pageFrom !== undefined && options.pageTo !== undefined && options.pageFrom > options.pageTo) throw new Error('起始页不能大于结束页。')
}

export function exportFileName(meta: Record<string, string | undefined>, options: TranslationExportOptions, date = new Date()): string {
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  const clean = (value: string) => value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80)
  const titles = [meta.book_original_title || meta.book_title, meta.book_chinese_title].filter((value): value is string => Boolean(value?.trim())).map(clean)
  return [stamp, ...(titles.length ? titles : ['translation']), `V${options.version || '1'}`].join('-') + `.${options.format}`
}

export function renderTranslationExport(paragraphs: ExportParagraph[], options: TranslationExportOptions): string {
  const sequenceNumbers = getParagraphSequenceNumbers(paragraphs)
  return `${paragraphs.filter(row => isExportPage(row.page_idx, options) && (options.scope === 'all' || row.status === 'done')).map(row => {
    const en = row.en_text.trim()
    const zh = row.zh_text.trim()
    if (options.content === 'zh' && !zh) return ''
    const label = `第 ${sequenceNumbers.get(row.id)} 段 · 固定编号 #${row.id} · PDF 第 ${row.page_idx + 1} 页`
    if (options.format === 'txt') {
      const body = options.content === 'zh' ? zh : `${en}\n${zh || '（未翻译）'}`
      return `${label}\n${body}`
    }
    const body = options.content === 'zh'
      ? (row.type === 'title' ? `# ${zh}` : zh)
      : (row.type === 'title' ? `# ${en}\n\n## ${zh || '（未翻译）'}` : `${en}\n\n${zh || '（未翻译）'}`)
    return `${label}\n\n${body}`
  }).filter(Boolean).join('\n\n')}\n`
}
