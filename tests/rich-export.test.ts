import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { prepareExport, renderDocxExport, renderHtmlExport } from '../src/main/services/rich-export'
import type { ExportParagraph, TranslationExportOptions } from '../src/shared/translation-export'
import { exportFileName, isExportPage, validateExportRange, renderTranslationExport } from '../src/shared/translation-export'
import { exportHtmlScript } from '../src/main/services/rich-export-web'

const rows: ExportParagraph[] = [
  { id: 28, page_idx: 6, type: 'title', en_text: 'A small garden', zh_text: '一座小花园', status: 'doing', bbox_json: '[100,100,800,200]', note: '标题备注' },
  { id: 922, page_idx: 6, type: 'paragraph', en_text: 'The garden has three green benches.', zh_text: '花园里有三张绿色长椅。', status: 'done', bbox_json: '[100,300,800,500]', note: '段落备注' },
  { id: 29, page_idx: 7, type: 'paragraph', en_text: 'A path leads to a small gate.', zh_text: '一条小路通向小门。', status: 'review', bbox_json: '[]' }
]
const options: TranslationExportOptions = { content: 'bilingual', format: 'html', scope: 'all', includeNotes: true, includeProjectNote: true, includeStatus: true }
const meta = { book_title: '食物之书', project_note: '项目整体备注', book_page_offset: '-2', book_pages_per_pdf: '2' }

describe('rich translation exports', () => {
  it('includes keyboard navigation, fit-page and direct copy with feedback', () => {
    const html = renderHtmlExport(rows, options, meta)
    expect(() => new Function(exportHtmlScript)).not.toThrow()
    for (const value of ['sheet-stage', '适页', 'ArrowLeft', 'ArrowRight', 'copyBlock', '已复制', 'font-size:14px']) expect(html).toContain(value)
    expect(html).toContain('input,textarea,select,[contenteditable="true"]')
  })
  it('avoids overlapping long blocks before scaling the complete page', () => {
    const overlays = [
      { dataset: { left: '.1', top: '.1', width: '.4' }, height: 180 },
      { dataset: { left: '.1', top: '.2', width: '.4' }, height: 500 },
      { dataset: { left: '.6', top: '.1', width: '.3' }, height: 120 }
    ].map(item => ({ ...item, style: {} as Record<string, string>, classList: { contains: () => false }, get offsetHeight() { return this.height } }))
    const sheet = { style: {} as Record<string, string>, dataset: {} as Record<string, number>, querySelectorAll: () => overlays }
    const stage = { style: {} as Record<string, string> }
    const viewport = { clientWidth: 900, clientHeight: 600 }
    const elements = { sheet, 'sheet-stage': stage, viewport, 'zoom-value': { value: 0 }, fit: { classList: { toggle() {} } }, 'fit-page': { classList: { toggle() {} } } }
    const layout = exportHtmlScript.slice(exportHtmlScript.indexOf('function layoutSheet()'), exportHtmlScript.indexOf('function render()'))
    new Function('data', '$', 'pageIdx', 'zoom', 'document', layout + ';layoutSheet();')({ images: [{ pageIdx: 0, width: 1300, height: 780 }] }, (id: keyof typeof elements) => elements[id], 0, 'page', { activeElement: null })
    expect(Number.parseFloat(overlays[1].style.top)).toBeGreaterThanOrEqual(Number.parseFloat(overlays[0].style.top) + overlays[0].height + 8)
    expect(Number.parseFloat(overlays[2].style.top)).toBe(60)
    expect(Number.parseFloat(stage.style.height)).toBeLessThanOrEqual(viewport.clientHeight - 36)
    expect(Number.parseFloat(stage.style.width)).toBeLessThanOrEqual(viewport.clientWidth - 36)
    expect(Number.parseFloat(sheet.style.height)).toBeGreaterThan(600)
  })
  it('filters page ranges consistently without renumbering', async () => {
    const range = { ...options, pageFrom: 8, pageTo: 8 }
    expect(prepareExport(rows, range, meta)).toMatchObject([{ id: 29, sequence: 3 }])
    expect(renderTranslationExport(rows, { ...range, format: 'txt' })).not.toContain('#922')
    const html = renderHtmlExport(rows, range, meta)
    expect(html).not.toContain('A small garden')
    expect(isExportPage(7, range)).toBe(true)
    expect(isExportPage(6, range)).toBe(false)
    expect(() => validateExportRange({ ...options, pageFrom: 9, pageTo: 8 })).toThrow()
    expect(() => validateExportRange({ ...options, pageFrom: 0 })).toThrow()
    const xml = await (await JSZip.loadAsync(await renderDocxExport(rows, range, meta))).file('word/document.xml')!.async('string')
    expect(xml).toContain('#29')
    expect(xml).not.toContain('#922')
  })
  it('preserves both identifiers and page mapping before filtering', () => {
    const result = prepareExport(rows, { ...options, scope: 'done' }, meta)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 922, sequence: 2, bookPage: '11-12', status: '通过' })
  })
  it('does not leak excluded notes or status and safely encodes text', () => {
    const html = renderHtmlExport([{ ...rows[0], en_text: '</script><img onerror=alert(1)>' }], { ...options, includeNotes: false, includeProjectNote: false, includeStatus: false }, meta)
    expect(html).not.toContain('标题备注')
    expect(html).not.toContain('项目整体备注')
    expect(html).not.toContain('待审')
    expect(html).not.toContain('</script><img')
    expect(html).toContain('\\u003c/script>')
  })
  it('writes three-column Word tables with notes, repeat headers and one locator per paragraph', async () => {
    const buffer = await renderDocxExport(rows, { ...options, format: 'docx' }, meta)
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('原文')
    expect(xml).toContain('译文')
    expect(xml).toContain('w:tblHeader')
    expect(xml).toContain('#922')
    expect(xml).toContain('段落备注')
    expect(xml).toContain('项目整体备注')
    expect(xml.match(/#922/g)).toHaveLength(1)
    expect(xml).not.toContain('PDF 7')
    expect(xml).not.toContain('第 2 段')
    expect(xml).toContain('书页 11-12')
    expect(xml).toContain('w:w="1800"')
    expect((xml.match(/<w:gridCol /g) ?? []).length).toBe(3)
  })
  it('includes optional book information and version before the table', async () => {
    const info = { ...meta, book_original_title: 'Original title', book_chinese_title: '中文书名', translator_name: '测试译者', translation_started_at: '2026-10-08' }
    const xml = await (await JSZip.loadAsync(await renderDocxExport(rows, { ...options, format: 'docx', version: '2.1' }, info))).file('word/document.xml')!.async('string')
    for (const value of ['Original title', '中文书名', '译者：测试译者', '开始翻译日期：2026-10-08', '版本：2.1']) {
      expect(xml).toContain(value)
      expect(xml.indexOf(value)).toBeLessThan(xml.indexOf('<w:tbl>'))
    }
    const withoutInfo = await (await JSZip.loadAsync(await renderDocxExport(rows, { ...options, format: 'docx' }, {}))).file('word/document.xml')!.async('string')
    expect(withoutInfo).not.toContain('译者：')
  })
  it('names exports with local date, optional titles and numeric versions', () => {
    const date = new Date(2026, 9, 8)
    expect(exportFileName({ book_original_title: 'Food', book_chinese_title: '食物之书' }, { ...options, version: '2.1' }, date)).toBe('20261008-Food-食物之书-V2.1.html')
    expect(exportFileName({ book_title: 'A/B' }, options, date)).toBe('20261008-A_B-V1.html')
    expect(exportFileName({}, options, date)).toBe('20261008-translation-V1.html')
    expect(() => validateExportRange({ ...options, version: '../bad' })).toThrow()
  })
  it('writes paragraph DOCX in bilingual or Chinese-only without tables', async () => {
    for (const content of ['zh', 'bilingual'] as const) {
      const buffer = await renderDocxExport(rows, { ...options, format: 'docx', docxLayout: 'paragraphs', content }, meta)
      const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string')
      expect(xml).not.toContain('<w:tbl>')
      expect(xml).toContain('花园里有三张')
      if (content === 'bilingual') expect(xml.indexOf('The garden has')).toBeLessThan(xml.indexOf('花园里有三张'))
      else expect(xml).not.toContain('The garden has')
    }
  })
  it('always starts HTML in Chinese regardless of the other export settings', () => {
    const html = renderHtmlExport(rows, options, meta)
    const data = JSON.parse(html.match(/<script id="export-data" type="application\/json">(.*?)<\/script>/s)![1])
    expect(data.mode).toBe('zh')
    expect(data.paragraphs[0].en).toBe('A small garden')
  })
})
