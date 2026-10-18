import { createLocalOcr } from '../src/renderer/src/lib/local-ocr'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import { groupPdfText, type PdfTextItem } from '../src/renderer/src/lib/pdf-blocks'
import { PSM } from 'tesseract.js'
import { ocrBlocks } from '../src/renderer/src/lib/ocr-blocks'
import { hasBrokenPdfText } from '../src/shared/pdf-text-quality'
import { isLatinPdfBlock, markBrokenPdfFonts, recoverPdfBlock } from '../src/renderer/src/lib/pdf-text-recovery'

export async function inspectJapanesePdf(dataUrl: string, workerUrl: string) {
  GlobalWorkerOptions.workerSrc = workerUrl
  const pdf = await getDocument({ data: Uint8Array.from(atob(dataUrl.split(',')[1]), character => character.charCodeAt(0)), isEvalSupported: false }).promise
  const worker = await createLocalOcr()
  try {
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 3 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
    const items = (await page.getTextContent()).items.filter(item => 'str' in item) as PdfTextItem[]
    const suspicious = items.filter(item => hasBrokenPdfText(item.str, { language: 'jpn', direction: 'horizontal' })).length
    const crop = document.createElement('canvas')
    crop.width = Math.ceil(canvas.width * .14); crop.height = Math.ceil(canvas.height * .045)
    crop.getContext('2d')!.drawImage(canvas, canvas.width * .795, canvas.height * .58, crop.width, crop.height, 0, 0, crop.width, crop.height)
    const base = page.getViewport({ scale: 1 })
    const blocks = groupPdfText(markBrokenPdfFonts(items, { language: 'jpn', direction: 'horizontal' }), base.width, base.height, base.transform, true)
    const numeric = blocks.filter(block => block.box.left > .74 && block.box.top > .58 && block.box.top < .76 && block.needsOcr && isLatinPdfBlock(block.text))
    const recovered = []
    for (const block of numeric) recovered.push({ before: block.text, after: await recoverPdfBlock(canvas, block, worker, true) })
    return { suspicious, recovered, crop: crop.toDataURL() }
  } finally { await worker.terminate(); await pdf.destroy() }
}

export async function recognizeJapaneseFixture(vertical: boolean, automatic = false) {
  const canvas = document.createElement('canvas')
  canvas.width = vertical ? 400 : 1100; canvas.height = vertical ? 700 : 260
  const context = canvas.getContext('2d')!
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = 'black'; context.font = '48px "Hiragino Sans"'; context.textBaseline = 'top'
  const lines = ['今日は良い天気です', '日本語を読みます']
  lines.forEach((line, index) => {
    if (vertical) [...line].forEach((character, row) => context.fillText(character, 260 - index * 90, 50 + row * 55))
    else context.fillText(line, 60, 50 + index * 80)
  })
  const settings = { language: 'jpn' as const, direction: vertical ? 'vertical' as const : 'horizontal' as const }
  const worker = await createLocalOcr(undefined, settings)
  try {
    await worker.setParameters({ tessedit_pageseg_mode: automatic ? PSM.AUTO : vertical ? PSM.SINGLE_BLOCK_VERT_TEXT : PSM.SINGLE_BLOCK })
    const result = await worker.recognize(canvas, {}, { blocks: true, text: true })
    const blocks = ocrBlocks((result.data.blocks ?? []).flatMap(block => block.paragraphs), canvas.width, canvas.height, settings)
    return { raw: result.data.text, text: blocks.map(block => block.text).join('\n\n'), blocks }
  } finally { await worker.terminate() }
}

export async function recognizeFixture(dataUrl: string): Promise<string> {
  const worker = await createLocalOcr()
  try {
    const result = await worker.recognize(dataUrl)
    return result.data.text
  } finally { await worker.terminate() }
}

export async function renderPdfFixture(bytes: number[], workerUrl: string) {
  GlobalWorkerOptions.workerSrc = workerUrl
  const document = await getDocument({ data: new Uint8Array(bytes) }).promise
  try {
    const page = await document.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const canvas = window.document.createElement('canvas')
    canvas.width = viewport.width; canvas.height = viewport.height
    const context = canvas.getContext('2d')!
    await page.render({ canvasContext: context, viewport }).promise
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let blue = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 50 && pixels[i + 1] < 50 && pixels[i + 2] > 200) blue++
    const items = (await page.getTextContent()).items.filter(item => 'str' in item) as PdfTextItem[]
    const blocks = groupPdfText(items, viewport.width, viewport.height, viewport.transform)
    let ink = 0, coveredInk = 0
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4
      if (pixels[offset] > 100 || pixels[offset + 1] > 100 || pixels[offset + 2] > 100) continue
      ink++
      if (blocks.some(({ box }) => x >= box.left * canvas.width && x < (box.left + box.width) * canvas.width && y >= box.top * canvas.height && y < (box.top + box.height) * canvas.height)) coveredInk++
    }
    return { text: items.map(item => item.str).join(' '), blue, blocks, inkCoverage: coveredInk / ink }
  } finally { await document.destroy() }
}
