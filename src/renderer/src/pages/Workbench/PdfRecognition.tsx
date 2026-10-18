import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Pause, Play } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import { PSM, type Worker } from 'tesseract.js'
import { api } from '@renderer/lib/ipc'
import { createLocalOcr } from '@renderer/lib/local-ocr'
import { ocrBlocks } from '@renderer/lib/ocr-blocks'
import { orderOcrBlocks } from '@shared/ocr-settings'
import { applyPdfRecovery, isLatinPdfBlock, markBrokenPdfFonts, recoverPdfBlock } from '@renderer/lib/pdf-text-recovery'
import { groupPdfText, type PdfTextItem } from '@renderer/lib/pdf-blocks'
import type { RecognitionState } from '@shared/ipc-api'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
// @ts-ignore - Vite asset import
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfRecognition({ onPage, onBatch,onVision,suspended=false }: { onPage: () => Promise<void>; onBatch: () => void;onVision:()=>void;suspended?:boolean }) {
  const [state, setState] = useState<RecognitionState | null>(null)
  const [running, setRunning] = useState(false)
  const [savingPause, setSavingPause] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showHint, setShowHint] = useState(false)
  const active = useRef(true)
  const stopped = useRef(false)
  const locked = useRef(false)
  const callback = useRef(onPage)
  callback.current = onPage

  const run = async (initial: RecognitionState) => {
    if (locked.current || !initial.enabled || initial.paused || initial.engine==='vision' || suspended) return
    locked.current = true; stopped.current = false
    setRunning(true); setError('')
    let doc: pdfjs.PDFDocumentProxy | undefined
    let worker: Worker | undefined
    let latinWorker: Worker | undefined
    try {
      const data = await api.readPdf()
      if (!data) throw new Error('未找到原书 PDF。')
      doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
      if (!active.current || stopped.current) return
      await api.initializeRecognition(initial.projectPath, doc.numPages)
      const completed = new Set(initial.completed)
      const settings = await api.getOcrSettings()
      for (let index = 0; index < doc.numPages; index++) {
        if (!active.current || stopped.current) break
        if (completed.has(index)) continue
        setMessage(`正在识别 PDF ${index + 1} / ${doc.numPages}`)
        const page = await doc.getPage(index + 1)
        const viewport = page.getViewport({ scale: 1 })
        const text = await page.getTextContent()
        const items = text.items.filter((i): i is TextItem => 'str' in i)
        // True Japanese vertical layout needs column segmentation, not rotated Latin text geometry.
        let blocks = settings.direction === 'vertical' ? [] : groupPdfText(markBrokenPdfFonts(items as PdfTextItem[], settings), viewport.width, viewport.height, viewport.transform, settings.language === 'jpn')
        let method = 'PDF text layer'
        const brokenTextLayer = blocks.some(block => block.needsOcr)
        if (!blocks.length || brokenTextLayer) {
          method = `${brokenTextLayer ? 'PDF text layer + ' : ''}Tesseract (offline ${settings.language}, ${settings.direction})`
          if (brokenTextLayer) setMessage(`PDF ${index + 1} 文字层编码异常，正在使用本机 OCR`)
          if (!worker) {
            setMessage('正在加载内置 OCR 模型')
            worker = await createLocalOcr(undefined, settings)
            await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
          }
          const scale = Math.min(3, 3200 / Math.max(viewport.width, viewport.height))
          const view = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height)
          const context = canvas.getContext('2d')!
          await page.render({ canvasContext: context, viewport: view }).promise
          try {
            if (brokenTextLayer) {
              for (const [blockIndex, block] of blocks.entries()) {
                if (!active.current || stopped.current) break
                if (!block.needsOcr) continue
                setMessage(`PDF ${index + 1} 正在修复异常文字 ${blockIndex + 1} / ${blocks.length}`)
                const latin = settings.language === 'jpn' && isLatinPdfBlock(block.text)
                if (latin && !latinWorker) latinWorker = await createLocalOcr()
                const recovered = await recoverPdfBlock(canvas, block, latin ? latinWorker! : worker, latin)
                blocks[blockIndex] = applyPdfRecovery(block, recovered)
              }
            } else {
              await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
              const result = await worker.recognize(canvas, {}, { blocks: true, text: true })
              blocks = ocrBlocks((result.data.blocks ?? []).flatMap(block => block.paragraphs), canvas.width, canvas.height, settings)
            }
          } finally { canvas.width = 0; canvas.height = 0 }
        }
        if (!active.current || stopped.current) break
        await api.saveRecognizedPage(initial.projectPath, index, orderOcrBlocks(blocks, settings), method)
        completed.add(index)
        setState(previous => ({ ...initial, paused: previous?.projectPath === initial.projectPath ? previous.paused : initial.paused, total: doc!.numPages, completed: [...completed] }))
        page.cleanup()
        await callback.current()
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      if (active.current) setMessage(completed.size === doc.numPages ? '原文识别完成' : '识别已暂停')
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : String(e)) }
    finally {
      await worker?.terminate()
      await latinWorker?.terminate()
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
      if (value.enabled && value.engine!=='vision' && !value.paused && !suspended && (!value.total || value.completed.length < value.total)) void run(value)
    }).catch(e => { if (active.current) setError(String(e)) })
    return () => { active.current = false; stopped.current = true }
  }, [])
  useEffect(()=>{
    if(!suspended)return
    stopped.current=true
    void api.getRecognitionState().then(value=>{if(active.current)setState(value)}).catch(error=>{if(active.current)setError(String(error))})
  },[suspended])
  useEffect(() => {
    if (!state?.enabled || !state.total || state.completed.length !== state.total) return
    let current = true
    void (async () => {
      const meta = await api.getProjectMeta()
      const paragraphs = await api.listParagraphs()
      if (current && !meta.batch_hint_dismissed && !paragraphs.some(paragraph => paragraph.zhText.trim())) setShowHint(true)
    })().catch(error => { if (current) setError(String(error)) })
    return () => { current = false }
  }, [state?.total, state?.completed.length])
  const togglePause = async () => {
    if (!state || savingPause) return
    const paused = running
    if (paused) stopped.current = true
    setSavingPause(true)
    try {
      await api.setRecognitionPaused(state.projectPath, paused)
      const next = { ...state, paused }
      setState(previous => previous?.projectPath === state.projectPath ? { ...previous, paused } : previous)
      setMessage(paused ? '识别已暂停' : '正在准备识别')
      if (!paused) void run(next)
    } catch (error) { setError(String(error)) }
    finally { setSavingPause(false) }
  }
  if (!state?.enabled) return null
  if(state.engine==='vision') return <div role="status" className="flex flex-wrap items-center gap-3 border-b bg-amber-50 px-4 py-2 text-sm"><span>AI 整页识别与分块（测试）：先选页码并确认上传，再核对分块；未确认不会写入工程。</span><span className="text-neutral-500">已确认 {state.completed.length}/{state.total || '—'} 页</span><button type="button" onClick={onVision} className="rounded border bg-white px-3 py-1">打开整页识别</button></div>
  const done = state.total > 0 && state.completed.length === state.total
  if (done) return showHint ? <div role="status" className="flex flex-wrap items-center gap-3 border-b bg-blue-50 px-4 py-2 text-sm"><span>原文识别完成。可先小批量整理断行；以后也可从“项目 → 批量处理”进入。模型调用可能产生费用。</span><button onClick={() => { void api.dismissBatchHint().then(() => { setShowHint(false); onBatch() }).catch(error => setError(String(error))) }} className="rounded border bg-white px-3 py-1">批量处理</button><button onClick={() => { void api.dismissBatchHint().then(() => setShowHint(false)).catch(error => setError(String(error))) }} className="rounded px-3 py-1">稍后再说</button>{error && <span className="text-red-700">{error}</span>}</div> : null
  return <div className="flex flex-wrap items-center gap-3 border-b bg-blue-50 px-4 py-2 text-sm" role="status">
    {running && <LoaderCircle size={16} className="animate-spin" />}
    <span>{error || message || (state.paused ? '识别已暂停' : done ? '原文识别完成' : '正在准备识别')}</span>
    <span className="text-neutral-500">{state.completed.length} / {state.total || '—'} 页</span>
    {!done && <button type="button" disabled={savingPause || (running && state.paused)} className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 disabled:opacity-40" onClick={() => void togglePause()}>{running ? <Pause size={14} /> : <Play size={14} />}{savingPause || (running && state.paused) ? '正在暂停…' : running ? '暂停' : '继续识别'}</button>}
  </div>
}
