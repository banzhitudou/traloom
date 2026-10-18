import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { VisionCrop } from '@shared/vision-ocr'

export async function renderVisionCrops(pdf: PDFDocumentProxy, pageNumber: number, boxes: VisionCrop['box'][], rotation = 0): Promise<VisionCrop[]> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const results: VisionCrop[] = []
  for (const box of boxes) {
    const width = base.width * box.width, height = base.height * box.height
    if (![width,height,box.left,box.top].every(Number.isFinite) || width <= 0 || height <= 0 || box.left < 0 || box.top < 0 || box.left+box.width > 1.001 || box.top+box.height > 1.001) throw new Error('视觉识别区域无效。')
    // Render the region directly; a whole-page pixel budget makes small text blurry.
    const scale = Math.min(6,2200/Math.max(width,height),Math.sqrt(6000000/(width*height)))
    const view = page.getViewport({scale})
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1,Math.ceil(width*scale)); canvas.height = Math.max(1,Math.ceil(height*scale))
    try {
      await page.render({canvasContext:canvas.getContext('2d')!,viewport:view,transform:[1,0,0,1,-box.left*view.width,-box.top*view.height],background:'white'}).promise
      if (!rotation) { results.push({box,dataUrl:canvas.toDataURL('image/png')}); continue }
      const crop = document.createElement('canvas')
      const w = canvas.width, h = canvas.height
      const quarter = Math.abs(rotation) % 180 === 90
      crop.width = quarter ? h : w; crop.height = quarter ? w : h
      try {
        const ctx = crop.getContext('2d')!
        ctx.fillStyle = 'white'; ctx.fillRect(0,0,crop.width,crop.height)
        ctx.translate(crop.width/2,crop.height/2); ctx.rotate(rotation*Math.PI/180)
        ctx.drawImage(canvas,-w/2,-h/2)
        results.push({ box, dataUrl:crop.toDataURL('image/png') })
      } finally { crop.width = 0; crop.height = 0 }
    } finally { canvas.width = 0; canvas.height = 0 }
  }
  return results
}
