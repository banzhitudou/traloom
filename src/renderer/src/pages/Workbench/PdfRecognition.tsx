import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Pause, Play } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import { PSM, type Worker } from 'tesseract.js'
import { api } from '@renderer/lib/ipc'
import { createLocalOcr } from '@renderer/lib/local-ocr'
import { groupPdfText, type PdfTextItem } from '@renderer/lib/pdf-blocks'
import type { RecognizedBlock, RecognitionState } from '@shared/ipc-api'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
// @ts-ignore - Vite asset import
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfRecognition({ onPage }: { onPage: () => Promise<void> }) {
  const [state, setState] = useState<RecognitionState | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const active = useRef(true)
  const stopped = useRef(false)
  const locked = useRef(false)
  const callback = useRef(onPage)
  callback.current = onPage

  const run = async (initial: RecognitionState) => {
    if (locked.current || !initial.enabled) return
    locked.current = true; stopped.current = false
    setRunning(true); setError('')
    let doc: pdfjs.PDFDocumentProxy | undefined
    let worker: Worker | undefined
    try {
      const data = await api.readPdf()
      if (!data) throw new Error('未找到原书 PDF。')
      doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
      if (!active.current || stopped.current) return
      await api.initializeRecognition(initial.projectPath, doc.numPages)
      const completed = new Set(initial.completed)
      for (let index = 0; index < doc.numPages; index++) {
        if (!active.current || stopped.current) break
        if (completed.has(index)) continue
        setMessage(`正在识别 PDF ${index + 1} / ${doc.numPages}`)
        const page = await doc.getPage(index + 1)
        const viewport = page.getViewport({ scale: 1 })
        const text = await page.getTextContent()
        // Transform positions through the viewport, including rotated PDF pages.
        const items = text.items.filter((i): i is TextItem => 'str' in i).map(i => {
          const matrix = pdfjs.Util.transform(viewport.transform, i.transform)
          return { ...i, transform: [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], viewport.height - matrix[5]], width: i.width }
        })
        let blocks = groupPdfText(items as PdfTextItem[], viewport.width, viewport.height)
        let method = 'PDF text layer'
        if (!blocks.length) {
          method = 'Tesseract (offline English)'
          if (!worker) {
            setMessage('正在加载内置英文 OCR')
            worker = await createLocalOcr()
            await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
          }
          const scale = Math.min(2, 2600 / Math.max(viewport.width, viewport.height))
          const view = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height)
          const context = canvas.getContext('2d')!
          await page.render({ canvasContext: context, viewport: view }).promise
          const result = await worker.recognize(canvas, {}, { blocks: true, text: true })
          blocks = (result.data.blocks ?? []).flatMap(block => block.paragraphs.map(p => ({
            text: p.text.trim(), box: { left: p.bbox.x0 / canvas.width, top: p.bbox.y0 / canvas.height, width: (p.bbox.x1 - p.bbox.x0) / canvas.width, height: (p.bbox.y1 - p.bbox.y0) / canvas.height }
          }))).filter(b => b.text) as RecognizedBlock[]
          canvas.width = 0; canvas.height = 0
        }
        if (!active.current || stopped.current) break
        await api.saveRecognizedPage(initial.projectPath, index, blocks, method)
        completed.add(index)
        setState({ ...initial, total: doc.numPages, completed: [...completed] })
        page.cleanup()
        await callback.current()
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      if (active.current) setMessage(completed.size === doc.numPages ? '原文识别完成' : '识别已暂停')
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : String(e)) }
    finally {
      await worker?.terminate()
      await doc?.destroy()
      locked.current = false
      if (active.current) setRunning(false)
    }
  }
  useEffect(() => {
    active.current = true
    void api.getRecognitionState().then(value => {
      if (!active.current) return
      setState(value)
      if (value.enabled && (!value.total || value.completed.length < value.total)) void run(value)
    }).catch(e => { if (active.current) setError(String(e)) })
    return () => { active.current = false; stopped.current = true }
  }, [])
  if (!state?.enabled) return null
  const done = state.total > 0 && state.completed.length === state.total
  return <div className="flex flex-wrap items-center gap-3 border-b bg-blue-50 px-4 py-2 text-sm" role="status">
    {running && <LoaderCircle size={16} className="animate-spin" />}
    <span>{error || message || (done ? '原文识别完成' : '正在准备识别')}</span>
    <span className="text-neutral-500">{state.completed.length} / {state.total || '—'} 页</span>
    {!done && <button type="button" className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1" onClick={() => { if (running) stopped.current = true; else void run(state) }}>{running ? <Pause size={14} /> : <Play size={14} />}{running ? '暂停' : '继续识别'}</button>}
  </div>
}
