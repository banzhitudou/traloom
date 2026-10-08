import * as pdfjs from 'pdfjs-dist'
import { api } from '@renderer/lib/ipc'
import type { Paragraph } from '@shared/types'
import type { TranslationExportOptions } from '@shared/translation-export'
import { isExportPage, validateExportRange } from '@shared/translation-export'

export async function exportPageImages(paragraphs: Paragraph[], options: TranslationExportOptions, onProgress: (text: string) => void) {
  validateExportRange(options)
  const buffer = await api.readPdf()
  if (!buffer) throw new Error('无法读取 PDF。可取消“包含 PDF 页面预览”后导出纯对照网页。')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
  try {
    const indices = [...new Set(paragraphs.filter(p => isExportPage(p.pageIdx, options) && (options.scope === 'all' || p.status === 'done')).map(p => p.pageIdx))]
    const images: NonNullable<TranslationExportOptions['pageImages']> = []
    for (const [index, pageIdx] of indices.entries()) {
      onProgress(`正在生成 PDF 页面预览 ${index + 1}/${indices.length}`)
      const page = await doc.getPage(pageIdx + 1)
      const viewport = page.getViewport({ scale: 1.3 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')!
      await page.render({ canvasContext: context, viewport }).promise
      images.push({ pageIdx, width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL('image/jpeg', 0.85) })
      canvas.width = canvas.height = 0
      page.cleanup()
    }
    return images
  } finally { await doc.destroy() }
}
