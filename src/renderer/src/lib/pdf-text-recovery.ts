import { PSM, type Worker } from 'tesseract.js'
import { hasBrokenPdfText } from '../../../shared/pdf-text-quality'
import type { OcrSettings } from '@shared/ocr-settings'
import type { RecognizedBlock } from '@shared/ipc-api'
import type { PdfTextItem } from './pdf-blocks'

export function markBrokenPdfFonts(items: PdfTextItem[], settings: OcrSettings): PdfTextItem[] {
  const fonts = new Set(items.filter(item => item.fontName && hasBrokenPdfText(item.str, settings)).map(item => item.fontName))
  return items.map(item => ({ ...item, needsOcr: !!(item.fontName && fonts.has(item.fontName)) || hasBrokenPdfText(item.str, settings) }))
}

export async function recoverPdfBlock(canvas: HTMLCanvasElement, block: RecognizedBlock, worker: Worker, latin: boolean): Promise<string> {
  const { box } = block
  const left = Math.max(0, Math.floor(box.left * canvas.width) - 2)
  const top = Math.max(0, Math.floor(box.top * canvas.height) - 2)
  const width = Math.min(canvas.width - left, Math.ceil(box.width * canvas.width) + 4)
  const height = Math.min(canvas.height - top, Math.ceil(box.height * canvas.height) + 4)
  const crop = document.createElement('canvas')
  crop.width = width + 20; crop.height = height + 20
  try {
    const context = crop.getContext('2d')!
    context.fillStyle = 'white'; context.fillRect(0, 0, crop.width, crop.height)
    context.drawImage(canvas, left, top, width, height, 10, 10, width, height)
    await worker.setParameters({ tessedit_pageseg_mode: latin ? PSM.SINGLE_LINE : PSM.SPARSE_TEXT })
    const text = (await worker.recognize(crop)).data.text.trim()
    if (text) return text
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
    return (await worker.recognize(crop)).data.text.trim()
  } finally { crop.width = 0; crop.height = 0 }
}

export function isLatinPdfBlock(text: string): boolean {
  return !!text.trim() && /^[\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\p{Co}\p{Cc}]+$/u.test(text)
}

export function applyPdfRecovery(block: RecognizedBlock, recovered: string): RecognizedBlock {
  return recovered.trim() ? { ...block, text: recovered.trim(), ocrUnresolved: false } : { ...block, ocrUnresolved: true }
}
