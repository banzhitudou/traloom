import { createLocalOcr } from '../src/renderer/src/lib/local-ocr'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'

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
    const text = (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')
    return { text, blue }
  } finally { await document.destroy() }
}
