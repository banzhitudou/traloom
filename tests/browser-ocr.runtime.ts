import { createLocalOcr } from '../src/renderer/src/lib/local-ocr'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import { groupPdfText, type PdfTextItem } from '../src/renderer/src/lib/pdf-blocks'

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
