import { describe, expect, it } from 'vitest'
import { renderTranslationExport, type ExportParagraph } from '../src/shared/translation-export'

const rows: ExportParagraph[] = [
  { id: 28, page_idx: 6, type: 'title', en_text: 'Food for thought', zh_text: '食物小知识', status: 'doing' },
  { id: 922, page_idx: 6, type: 'paragraph', en_text: 'Rice is food.', zh_text: '大米是食物。', status: 'done' },
  { id: 29, page_idx: 6, type: 'paragraph', en_text: 'Next paragraph.', zh_text: '', status: 'todo' },
  { id: 30, page_idx: 7, type: 'paragraph', en_text: 'Last paragraph.', zh_text: '最后一段。', status: 'done' }
]

describe('translation export numbering', () => {
  for (const format of ['txt', 'md'] as const) {
    for (const content of ['zh', 'bilingual'] as const) {
      it(`${format}/${content} includes sequence, stable ID and PDF page`, () => {
        const output = renderTranslationExport(rows, { format, content, scope: 'all' })
        expect(output).toContain('第 1 段 · 固定编号 #28 · PDF 第 7 页')
        expect(output).toContain('第 2 段 · 固定编号 #922 · PDF 第 7 页')
        expect(output).toContain('第 4 段 · 固定编号 #30 · PDF 第 8 页')
        expect(output).toContain('大米是食物。')
        expect(output.indexOf('#28')).toBeLessThan(output.indexOf('#922'))
        if (content === 'bilingual') {
          expect(output).toContain('Rice is food.')
          expect(output).toContain('（未翻译）')
        } else {
          expect(output).not.toContain('Rice is food.')
          expect(output).not.toContain('固定编号 #29')
        }
        if (format === 'md') expect(output).toContain('# 食物小知识')
      })

      it(`${format}/${content} preserves project sequence when exporting only done rows`, () => {
        const output = renderTranslationExport(rows, { format, content, scope: 'done' })
        expect(output).toContain('第 2 段 · 固定编号 #922')
        expect(output).toContain('第 4 段 · 固定编号 #30')
        expect(output).not.toContain('固定编号 #28')
        expect(output).not.toContain('固定编号 #29')
      })
    }
  }
})
