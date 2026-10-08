import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, HeadingLevel, TableLayoutType } from 'docx'
import { parseNormalizedBboxes } from '../../shared/bbox'
import { getParagraphSequenceNumbers } from '../../shared/paragraph-numbering'
import type { ExportParagraph, TranslationExportOptions } from '../../shared/translation-export'
import { isExportPage } from '../../shared/translation-export'
import { exportHtmlScript, exportHtmlStyle } from './rich-export-web'

export interface ExportMetadata { book_title?: string; book_original_title?: string; book_chinese_title?: string; translator_name?: string; translation_started_at?: string; author_name?: string; publisher_name?: string; project_note?: string; book_page_offset?: string; book_pages_per_pdf?: string }
const states: Record<string, string> = { todo: '待译', doing: '待审', done: '通过', review: '存疑' }
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

export function prepareExport(rows: ExportParagraph[], options: TranslationExportOptions, meta: ExportMetadata) {
  const numbers = getParagraphSequenceNumbers(rows)
  const perPdf = meta.book_pages_per_pdf === '2' ? 2 : 1
  const offset = Number(meta.book_page_offset ?? 0) || 0
  return rows.filter(row => isExportPage(row.page_idx, options) && (options.scope === 'all' || row.status === 'done')).map(row => {
    const first = row.page_idx * perPdf + 1 + offset
    const bookPage = perPdf === 2 ? `${first}-${first + 1}` : String(first)
    return { id: row.id, pageIdx: row.page_idx, sequence: numbers.get(row.id)!, type: row.type,
      en: row.en_text, zh: row.zh_text, bookPage, bookPageFrom: first, bookPageTo: first + perPdf - 1,
      label: `第 ${numbers.get(row.id)} 段 · #${row.id} · PDF ${row.page_idx + 1} · 书中 ${bookPage} 页`,
      status: options.includeStatus ? states[row.status] ?? row.status : '',
      note: options.includeNotes ? row.note ?? '' : '', boxes: parseNormalizedBboxes(row.bbox_json ?? '[]') }
  })
}

export async function renderDocxExport(rows: ExportParagraph[], options: TranslationExportOptions, meta: ExportMetadata): Promise<Buffer> {
  const paragraphs = prepareExport(rows, options, meta)
  const font = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Songti SC', cs: 'Arial' }
  const text = (value: string, bold = false, color = '111111') => value.split(/\r?\n/).map(line => new Paragraph({
    spacing: { after: 100, line: 300 }, children: [new TextRun({ text: line, bold, color, size: 22, font })]
  }))
  const cell = (children: Paragraph[], width = 4000) => new TableCell({ width: { size: width, type: WidthType.DXA }, children, margins: { top: 100, bottom: 100, left: 100, right: 100 } })
  const locator = (id: number, bookPage: string) => [new Paragraph({ children: [new TextRun({ text: `#${id}`, size: 18, font })] }), new Paragraph({ children: [new TextRun({ text: `书页 ${bookPage}`, size: 18, font })] })]
  const tableRows = [new TableRow({ tableHeader: true, children: [cell(text('定位', true), 1800), cell(text('原文', true)), cell(text('译文', true))] })]
  for (const p of paragraphs) {
    const translation = [...text(p.zh || '（未翻译）', p.type === 'title')]
    if (p.status) translation.push(...text(`状态：${p.status}`, false, '555555'))
    if (p.note.trim()) translation.push(...text(`段落备注：${p.note}`, false, '555555'))
    tableRows.push(new TableRow({ children: [cell(locator(p.id, p.bookPage), 1800), cell(text(p.en, p.type === 'title')), cell(translation)] }))
  }
  const children: (Paragraph | Table)[] = [new Paragraph({ text: meta.book_chinese_title || meta.book_original_title || meta.book_title || '双语对照译稿', heading: HeadingLevel.TITLE })]
  for (const [label, value] of [['原书名', meta.book_original_title], ['中文书名', meta.book_chinese_title], ['译者', meta.translator_name], ['作者', meta.author_name], ['出版社', meta.publisher_name], ['开始翻译日期', meta.translation_started_at], ['版本', options.version]] as const) {
    if (value?.trim()) children.push(...text(`${label}：${value}`))
  }
  if (options.includeProjectNote && meta.project_note?.trim()) children.push(...text(`项目备注\n${meta.project_note}`))
  if (options.docxLayout === 'paragraphs') {
    for (const p of paragraphs) {
      children.push(...text(p.label + (p.status ? ` · ${p.status}` : ''), false, '555555'))
      if (options.content === 'bilingual') children.push(...text(p.en, p.type === 'title'))
      children.push(...text(p.zh || '（未翻译）', p.type === 'title'))
      if (p.note.trim()) children.push(...text(`段落备注：${p.note}`, false, '555555'))
      children.push(new Paragraph({ spacing: { after: 160 } }))
    }
  } else children.push(new Table({ layout: TableLayoutType.FIXED, width: { size: 9800, type: WidthType.DXA }, columnWidths: [1800, 4000, 4000], rows: tableRows }))
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font, size: 22 } } } }, sections: [{ properties: { page: { margin: { top: 850, bottom: 850, left: 850, right: 850 } } }, children }] }))
}

export function renderHtmlExport(rows: ExportParagraph[], options: TranslationExportOptions, meta: ExportMetadata): string {
  const data = { title: meta.book_title || '双语译稿', paragraphs: prepareExport(rows, options, meta),
    projectNote: options.includeProjectNote ? meta.project_note ?? '' : '',
    images: options.includePageImages ? (options.pageImages ?? []).filter(image => isExportPage(image.pageIdx, options) && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl)) : [],
    mode: 'zh' }
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(data.title)}</title><style>${exportHtmlStyle}</style></head><body>
  <header><strong>${escapeHtml(data.title)}</strong><nav aria-label="语言"><button data-mode="zh">中文</button><button data-mode="en">原文</button><button data-mode="bilingual">双语对照</button></nav><div class="pages"><button id="prev" aria-label="上一页">◀</button><select id="page" aria-label="PDF 页码"></select><button id="next" aria-label="下一页">▶</button></div><div class="jump"><select id="jump-kind" aria-label="跳转页码类型"><option value="pdf">PDF 页码</option><option value="book">书中页码</option></select><input id="jump-value" type="number" step="1" aria-label="跳转页码"><button id="jump-go" title="跳转" aria-label="跳转">→</button></div><div class="zoom"><button id="zoom-out" aria-label="缩小">−</button><input id="zoom-value" type="number" min="25" max="400" aria-label="缩放比例"><span>%</span><button id="zoom-in" aria-label="放大">+</button><button id="fit">适宽</button></div><button id="toggle-reader" aria-expanded="false">展开对照栏</button><input id="search" type="search" placeholder="搜索原文、译文、编号" aria-label="搜索"><label><input id="regions" type="checkbox" checked>区域框</label><button id="print">打印</button></header>
  <main><section id="viewport"><div id="sheet-stage"><div id="sheet"></div></div></section><section id="reader"><div id="project-note"></div><div id="paragraphs"></div></section></main><footer id="status" role="status" aria-live="polite"></footer><script id="export-data" type="application/json">${json}</script><script>${exportHtmlScript}</script></body></html>`
}
