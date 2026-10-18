import type { OcrSettings } from '../../../shared/ocr-settings'
import { joinOcrLines, orderOcrBlocks } from '../../../shared/ocr-settings'
interface OcrParagraph { text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; lines?: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }
export function ocrParagraphText(paragraph: OcrParagraph, settings: OcrSettings): string {
  if (settings.language === 'eng') return paragraph.text.trim()
  if (!paragraph.lines?.length) return joinOcrLines(paragraph.text.split(/\r?\n/), settings)
  const lines = settings.direction === 'vertical' ? [...paragraph.lines].sort((a, b) => b.bbox.x0 - a.bbox.x0 || a.bbox.y0 - b.bbox.y0) : paragraph.lines
  return joinOcrLines(lines.map(line => line.text), settings)
}
export function ocrBlocks(paragraphs: OcrParagraph[], width: number, height: number, settings: OcrSettings) {
  return orderOcrBlocks(paragraphs.map(paragraph => ({ text: ocrParagraphText(paragraph, settings), box: { left: paragraph.bbox.x0 / width, top: paragraph.bbox.y0 / height, width: (paragraph.bbox.x1 - paragraph.bbox.x0) / width, height: (paragraph.bbox.y1 - paragraph.bbox.y0) / height } })).filter(block => block.text), settings)
}
