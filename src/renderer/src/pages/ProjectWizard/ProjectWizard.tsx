import { useState } from 'react'
import { FilePlus2, LoaderCircle } from 'lucide-react'
import { api } from '@renderer/lib/ipc'
import { newProjectFileName } from '@shared/project-file-name'
import { DEFAULT_OCR, type OcrSettings } from '@shared/ocr-settings'
import { OcrControls } from '../Workbench/OcrSettings'
import { VISION_PAGE_NOTICE } from '@shared/vision-page'

interface Props { onNext: () => void; onBack?: () => void }

export default function ProjectWizard({ onNext, onBack }: Props) {
  const [pdfPath, setPdfPath] = useState('')
  const [bookTitle, setBookTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const [ocrSettings, setOcrSettings] = useState<OcrSettings>(DEFAULT_OCR)
  const [recognitionEngine,setRecognitionEngine]=useState<'offline'|'vision'>('offline')
  const pickPdf = async () => {
    if (picking) return
    setPicking(true); setError('')
    try {
      const file = await api.pickFile({ title: '选择原书 PDF', defaultPath: pdfPath || undefined, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
      if (!file) return
      setPdfPath(file)
      setBookTitle(file.split(/[\\/]/).pop()?.replace(/\.pdf$/i, '') ?? '')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setPicking(false) }
  }
  const create = async () => {
    setBusy(true); setError('')
    try {
      const result = await api.createProject({ pdfPath, bookTitle, ocrSettings,recognitionEngine })
      if (!result.ok) throw new Error(result.error || '创建失败')
      onNext()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <main className="flex h-dvh items-center justify-center bg-neutral-50 p-6">
    <form className="w-full max-w-xl" onSubmit={e => { e.preventDefault(); void create() }}>
      <h1 className="mb-6 text-xl font-medium">新建翻译工程</h1>
      <label className="mb-4 block text-sm">原书 PDF
        <div className="mt-2 flex gap-2"><input aria-label="原书 PDF" readOnly value={pdfPath} className="min-w-0 flex-1 rounded border bg-white px-3 py-2" />
          <button type="button" onClick={() => void pickPdf()} disabled={busy || picking} className="flex shrink-0 items-center gap-2 rounded border bg-white px-3 disabled:opacity-40"><FilePlus2 size={16} />{picking ? '正在选择' : '选择 PDF'}</button></div>
      </label>
      <label className="mb-4 block text-sm">书名（可选）<input value={bookTitle} onChange={e => setBookTitle(e.target.value)} disabled={busy} className="mt-2 w-full rounded border px-3 py-2" /></label>
      <fieldset className="mb-4 space-y-3"><legend className="mb-3 text-sm">识别设置</legend><label className="block text-sm">识别方式<select aria-label="新工程识别方式" value={recognitionEngine} disabled={busy} onChange={e=>setRecognitionEngine(e.target.value as 'offline'|'vision')} className="ml-3 rounded border bg-white p-2"><option value="offline">本机识别</option><option value="vision">AI 整页识别与分块（测试）</option></select></label>{recognitionEngine==='offline'?<OcrControls value={ocrSettings} onChange={setOcrSettings} disabled={busy}/>:<p role="note" className="border-l-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-800">{VISION_PAGE_NOTICE} 工程建立后先配置视觉模型、选择页码并确认上传，不会自动发送 PDF 页面。以后从“项目 → AI 整页识别与分块”进入。</p>}</fieldset>
      <p className="mb-4 break-words text-sm leading-6 text-neutral-600">工程会建在 PDF 所在文件夹，名为「{pdfPath ? newProjectFileName(pdfPath) : '原文件名-翻译工程.twproj'}」。它保存你的译文和全部工程资料，请勿删除；如已有同名工程，会另加序号，不会覆盖。</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-6 flex justify-between gap-3"><button type="button" disabled={busy || picking} onClick={onBack} className="rounded border px-4 py-2 text-sm">返回</button>
        <button disabled={busy || picking || !pdfPath} className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40">{busy && <LoaderCircle size={16} className="animate-spin" />}{busy ? '正在建立工程' : '开始翻译'}</button></div>
    </form>
  </main>
}
