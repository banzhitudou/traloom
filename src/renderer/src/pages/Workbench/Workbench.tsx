import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronDown, FolderOpen, FileText, Search, Download, Settings as SettingsIcon } from 'lucide-react'
import { api } from '@renderer/lib/ipc'
import type { LlmStatus, Paragraph, Progress } from '@shared/types'
import { formatParagraphNumbers, getParagraphSequenceNumbers } from '@shared/paragraph-numbering'
import ParagraphList from './ParagraphList'
import PdfViewer from './PdfViewer'
import RightPanel, { type RightPanelTab } from './RightPanel'
import SearchDialog from './SearchDialog'
import PdfRecognition from './PdfRecognition'
import type { TranslationExportOptions as ExportOptions } from '@shared/translation-export'
import { exportPageImages } from './export-page-images'
import { isExportPage, validateExportRange } from '@shared/translation-export'

interface Props {
  onOpenSettings: () => void
  onManageProjects: () => void
}

const DEFAULT_SPLIT_PERCENT = 52
const MIN_TRANSLATION_WIDTH = 520
const MIN_PDF_WIDTH = 380

const toolItems: { id: RightPanelTab; label: string; icon: string }[] = [
  { id: 'glossary', label: '术语', icon: '术' },
  { id: 'records', label: '备注与记录', icon: '记' }
]

function readSplitPercent() {
  const stored = Number(localStorage.getItem('workbench-split-percent'))
  return Number.isFinite(stored) && stored >= 30 && stored <= 75
    ? stored
    : DEFAULT_SPLIT_PERCENT
}

/**
 * 主工作台：可调宽翻译区 + PDF 阅读区，低频工具使用覆盖式抽屉。
 */
export default function Workbench({ onOpenSettings, onManageProjects }: Props) {
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [progress, setProgress] = useState<Progress>({ total: 0, done: 0, review: 0, percent: 0 })
  const [exporting, setExporting] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showProjectInfo, setShowProjectInfo] = useState(false)
  const [projectInfo, setProjectInfo] = useState<Record<string, string>>({})
  const [projectInfoSaving, setProjectInfoSaving] = useState(false)
  const [projectInfoError, setProjectInfoError] = useState('')
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [pdfRevision, setPdfRevision] = useState(0)
  const [exportPageRangeEnabled, setExportPageRangeEnabled] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [, setPdfEditing] = useState(false)
  const [toolWidth, setToolWidth] = useState(360)
  const toolDrag = useRef<{ x: number; width: number } | null>(null)
  const [activeTool, setActiveTool] = useState<RightPanelTab>('glossary')
  const [splitPercent, setSplitPercent] = useState(readSplitPercent)
  const [isResizing, setIsResizing] = useState(false)
  const [queueStatus, setQueueStatus] = useState<'review' | 'todo' | 'doing' | undefined>()
  const [jumpId, setJumpId] = useState('')
  const [jumpMode, setJumpMode] = useState<'sequence' | 'fixed'>('sequence')
  const [bookPageOffset, setBookPageOffset] = useState(0)
  const [bookPagesPerPdf, setBookPagesPerPdf] = useState(1)
  const [jumpError, setJumpError] = useState('')
  const [jumpBusy, setJumpBusy] = useState(false)
  const [navigationRevision, setNavigationRevision] = useState(0)
  const [originalPreview, setOriginalPreview] = useState<{ id: number; text: string } | null>(null)
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    content: 'zh',
    format: 'md',
    scope: 'all',
    includeNotes: false,
    includeProjectNote: false,
    includeStatus: true,
    includePageImages: true,
    docxLayout: 'table',
    version: '1'
  })
  const [exportMessage, setExportMessage] = useState('')
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null)
  const saveCurrentRef = useRef<() => Promise<void>>(async () => {})
  const editPreviewRef = useRef<(text: string) => void>(() => {})
  const workspaceRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false)
  const splitPercentRef = useRef(splitPercent)

  const clampSplitPercent = useCallback((next: number) => {
    const width = workspaceRef.current?.clientWidth ?? window.innerWidth
    const min = Math.max(30, (MIN_TRANSLATION_WIDTH / width) * 100)
    const max = Math.min(75, 100 - (MIN_PDF_WIDTH / width) * 100)
    if (min > max) return DEFAULT_SPLIT_PERCENT
    return Math.min(max, Math.max(min, next))
  }, [])

  const persistSplit = useCallback((next: number) => {
    const clamped = clampSplitPercent(next)
    splitPercentRef.current = clamped
    setSplitPercent(clamped)
    localStorage.setItem('workbench-split-percent', String(clamped))
  }, [clampSplitPercent])

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizingRef.current = true
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current || !workspaceRef.current) return
    const rect = workspaceRef.current.getBoundingClientRect()
    const next = clampSplitPercent(((event.clientX - rect.left) / rect.width) * 100)
    splitPercentRef.current = next
    setSplitPercent(next)
  }

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return
    resizingRef.current = false
    setIsResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem('workbench-split-percent', String(splitPercentRef.current))
  }

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Home') {
      event.preventDefault()
      persistSplit(DEFAULT_SPLIT_PERCENT)
      return
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const amount = event.shiftKey ? 5 : 2
    persistSplit(splitPercent + (event.key === 'ArrowLeft' ? -amount : amount))
  }

  const openTool = (tool: RightPanelTab) => {
    if (toolsOpen && activeTool === tool) {
      setToolsOpen(false)
      return
    }
    setActiveTool(tool)
    setToolsOpen(true)
  }

  const refresh = useCallback(async () => {
    const list = await api.listParagraphs()
    setParagraphs(list)
    const p = await api.getProgress()
    setProgress(p)
  }, [])

  useEffect(() => {
    let active = true
    const initialize = async () => {
      const [list, nextProgress, lastViewedId, meta] = await Promise.all([
        api.listParagraphs(),
        api.getProgress(),
        api.getLastViewedParagraph(),
        api.getProjectMeta()
      ])
      if (!active) return
      setParagraphs(list)
      setProgress(nextProgress)
      const offset = Number(meta.book_page_offset ?? 0)
      setBookPageOffset(Number.isSafeInteger(offset) ? offset : 0)
      setBookPagesPerPdf(meta.book_pages_per_pdf === '2' ? 2 : 1)
      const remembered = lastViewedId === null
        ? null
        : list.find((paragraph) => paragraph.id === lastViewedId)
      const fallback = list.find((paragraph) => paragraph.status !== 'done') ?? list[0] ?? null
      const initialId = remembered?.id ?? fallback?.id ?? null
      setCurrentId(initialId)
      if (initialId !== null) void api.setLastViewedParagraph(initialId)
    }
    void initialize()
    return () => {
      active = false
    }
  }, [refresh])

  useEffect(() => {
    let active = true
    const refreshLlmStatus = async () => {
      const next = await api.getLlmStatus()
      if (active) setLlmStatus(next)
    }
    void refreshLlmStatus()
    const timer = window.setInterval(refreshLlmStatus, 5000)
    window.addEventListener('focus', refreshLlmStatus)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshLlmStatus)
    }
  }, [])

  useEffect(() => {
    if (!toolsOpen) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { setToolsOpen(false); setProjectMenuOpen(false) }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [toolsOpen])

  const current = paragraphs.find((p) => p.id === currentId) ?? null
  const sequenceNumbers = getParagraphSequenceNumbers(paragraphs)
  const todoCount = paragraphs.filter((paragraph) => paragraph.status === 'todo').length
  const doingCount = paragraphs.filter((paragraph) => paragraph.status === 'doing').length
  const queueLabel = queueStatus === 'todo' ? '待译' : queueStatus === 'doing' ? '待审' : '存疑'
  const reviewParagraphs = paragraphs.filter((paragraph) => paragraph.status === queueStatus)
  const reviewIndex = reviewParagraphs.findIndex((paragraph) => paragraph.id === currentId)
  const llmDisplay = (() => {
    switch (llmStatus?.state) {
      case 'online':
        return { label: '可用', color: 'bg-emerald-500' }
      case 'configured':
        return { label: '已配置', color: 'bg-amber-500' }
      case 'error':
        return { label: '连接异常', color: 'bg-red-500' }
      case 'unconfigured':
        return { label: '未配置', color: 'bg-neutral-400' }
      default:
        return { label: '检查中', color: 'bg-neutral-300' }
    }
  })()

  const handleParagraphSelect = async (id: number) => {
    if (id === currentId) return
    await saveCurrentRef.current()
    setCurrentId(id)
    void api.setLastViewedParagraph(id)
  }

  const openReviewQueue = async (status: 'review' | 'todo' | 'doing') => {
    await saveCurrentRef.current()
    setQueueStatus(status)
    const first = paragraphs.find(paragraph => paragraph.id === currentId && paragraph.status === status)
      ?? paragraphs.find(paragraph => paragraph.status === status)
    if (first) await handleParagraphSelect(first.id)
  }

  const moveReview = async (offset: -1 | 1) => {
    if (reviewIndex < 0) return
    const next = reviewParagraphs[reviewIndex + offset]
    if (next) await handleParagraphSelect(next.id)
  }

  const jumpReview = async (index: number) => {
    const target = reviewParagraphs[index - 1]
    if (target) await handleParagraphSelect(target.id)
  }

  const jumpToParagraph = async () => {
    if (jumpBusy) return
    const fixed = jumpMode === 'fixed' || jumpId.trim().startsWith('#')
    const value = jumpId.trim().replace(/^#\s*/, '')
    const sequence = Number(value)
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(sequence) || sequence < 1) {
      setJumpError(fixed ? '请输入有效的固定编号。' : '请输入有效的段落序号。')
      return
    }
    const target = fixed ? paragraphs.find(paragraph => paragraph.id === sequence) : paragraphs[sequence - 1]
    if (!target) {
      setJumpError(fixed ? `未找到固定编号 #${sequence}。` : `请输入 1 到 ${paragraphs.length} 之间的段落序号。`)
      return
    }
    const id = target.id
    setJumpBusy(true)
    setJumpError('')
    try {
      await saveCurrentRef.current()
      setQueueStatus(undefined)
      setCurrentId(id)
      setNavigationRevision(revision => revision + 1)
      setJumpId(fixed ? `#${sequence}` : String(sequence))
      void api.setLastViewedParagraph(id)
    } catch {
      setJumpError('当前译文保存失败，未跳转。')
    } finally {
      setJumpBusy(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    setShowExport(false)
    setExportMessage('')
    try {
      await saveCurrentRef.current()
      const options = { ...exportOptions }
      validateExportRange(options)
      const exportRows = await api.listParagraphs()
      if (!exportRows.some(p => isExportPage(p.pageIdx, options) && (options.scope === 'all' || p.status === 'done'))) throw new Error('所选页码范围内没有可导出的段落。')
      if (options.format === 'html' && options.includePageImages) {
        options.pageImages = await exportPageImages(exportRows, options, setExportMessage)
      }
      const result = await api.exportTranslation(options)
      setExportMessage(result.ok ? `已导出：${result.path?.split('/').pop() ?? '译稿'}` : result.error ?? '导出失败')
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : String(error))
    } finally { setExporting(false) }
  }

  const openSearch = useCallback(async () => {
    await saveCurrentRef.current()
    const list = await api.listParagraphs()
    setParagraphs(list)
    setShowSearch(true)
  }, [])

  useEffect(() => {
    const openOnShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        void openSearch()
      }
    }
    window.addEventListener('keydown', openOnShortcut)
    return () => window.removeEventListener('keydown', openOnShortcut)
  }, [openSearch])

  const handleManageProjects = async () => {
    await saveCurrentRef.current()
    onManageProjects()
  }

  const handleRelinkPdf = async () => {
    await saveCurrentRef.current()
    const result = await api.relinkProjectPdf()
    if (result.canceled) return
    if (!result.ok) throw new Error(result.error ?? '重新关联 PDF 失败')
    setPdfRevision(value => value + 1)
    setExportMessage('已重新关联原书 PDF')
  }

  const handleParagraphDeleted = async (id: number, deletedIds: number[] = [id]) => {
    const index = paragraphs.findIndex((item) => item.id === id)
    const remaining = paragraphs.filter(item => !deletedIds.includes(item.id))
    const next = remaining.find(item => item.id === currentId) ?? paragraphs.slice(index + 1).find(item => !deletedIds.includes(item.id)) ?? remaining.at(-1)
    setOriginalPreview(null)
    setCurrentId(next?.id ?? null)
    await refresh()
    if (next) void api.setLastViewedParagraph(next.id)
  }

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden">
      {/* 顶栏：书名 + 进度 + 操作 */}
      <header className="flex min-h-12 flex-none flex-wrap items-center gap-2 border-b bg-white px-4 py-1">
        <span className="font-medium">进度</span>
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <div className="h-2 w-40 overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full bg-para-done transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span>
            {progress.done}/{progress.total}段 {progress.percent}%
            {progress.review > 0 && (
              <button
                title="只看存疑段落"
                onClick={() => void openReviewQueue('review')}
                className="ml-2 text-para-review hover:underline"
              >
                ⚠存疑 {progress.review}
              </button>
            )}
            <button
              type="button"
              title="只看灰色待译段落"
              onClick={() => void openReviewQueue('todo')}
              aria-pressed={queueStatus === 'todo'}
              className="ml-2 text-neutral-500 hover:underline"
            >
              ○ 待译 {todoCount}
            </button>
            <button type="button" title="只看蓝色待审段落" onClick={() => void openReviewQueue('doing')} aria-pressed={queueStatus === 'doing'} className="ml-2 text-blue-600 hover:underline">待审 {doingCount}</button>
          </span>
        </div>
        <form className="flex flex-wrap items-center gap-1" onSubmit={event => { event.preventDefault(); void jumpToParagraph() }}>
          <label htmlFor="paragraph-jump-id" className="text-xs text-neutral-600">段落跳转</label>
          <select aria-label="段落跳转编号类型" value={jumpMode} onChange={event => { setJumpMode(event.target.value as 'sequence' | 'fixed'); setJumpId(''); setJumpError('') }} className="h-7 rounded border bg-white px-1 text-xs"><option value="sequence">第几段</option><option value="fixed">固定 # 编号</option></select>
          <input
            id="paragraph-jump-id"
            type="text"
            inputMode="numeric"
            value={jumpId}
            onChange={event => { setJumpId(event.target.value); setJumpError('') }}
            placeholder={jumpMode === 'fixed' ? '#编号' : '第几段'}
            aria-invalid={!!jumpError}
            aria-describedby={jumpError ? 'paragraph-jump-error' : undefined}
            className="h-7 w-20 rounded border px-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button type="submit" disabled={jumpBusy} title="跳转到翻译段" aria-label="跳转到翻译段" className="h-7 w-7 rounded border text-neutral-700 hover:bg-neutral-100 disabled:opacity-40">→</button>
          {jumpError && <span id="paragraph-jump-error" role="alert" className="text-xs text-red-700">{jumpError}</span>}
        </form>
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={projectMenuOpen} onClick={() => setProjectMenuOpen(value => !value)} className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-neutral-100">项目<ChevronDown size={14} /></button>
            {projectMenuOpen && <>
              <button type="button" aria-label="关闭项目菜单" onClick={() => setProjectMenuOpen(false)} className="fixed inset-0 z-40 cursor-default" />
              <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-40 rounded border bg-white py-1 shadow-lg">
                <button role="menuitem" type="button" onClick={() => { setProjectMenuOpen(false); void handleManageProjects() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50"><FolderOpen size={15} />切换项目</button>
                <button role="menuitem" type="button" onClick={() => {
                  setProjectMenuOpen(false); setProjectInfoError('')
                  void api.getProjectMeta().then(meta => {
                    const keys = ['book_original_title', 'book_chinese_title', 'translator_name', 'translation_started_at', 'author_name', 'publisher_name']
                    setProjectInfo(Object.fromEntries(keys.map(key => [key, meta[key] ?? (key === 'book_original_title' ? meta.book_title ?? '' : '')])))
                    setShowProjectInfo(true)
                  }).catch(error => setExportMessage(String(error)))
                }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50"><FileText size={15} />项目资料</button>
              </div>
            </>}
          </div>
          {toolsOpen && <button type="button" onClick={() => setToolsOpen(false)} className="rounded px-2 py-1 text-sm text-blue-700 hover:bg-blue-50 2xl:hidden">返回 PDF</button>}
          {toolItems.map(tool => <button key={tool.id} type="button" aria-pressed={toolsOpen && activeTool === tool.id} onClick={() => openTool(tool.id)} className={`rounded px-2 py-1 text-sm ${toolsOpen && activeTool === tool.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-neutral-100'}`}>{tool.label}</button>)}
          <button
            type="button"
            onClick={() => void openSearch()}
            title="全文搜索（⌘F）"
            className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-neutral-100"
          >
            <Search size={15} />搜索
          </button>
          {exportMessage && (
            <span className="self-center text-xs text-neutral-500">{exportMessage}</span>
          )}
          <button
            onClick={() => setShowExport(true)}
            disabled={exporting || paragraphs.length === 0}
            className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={15} />{exporting ? '导出中...' : '导出'}
          </button>
          <button
            onClick={() => void saveCurrentRef.current().then(onOpenSettings)}
            className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-neutral-100"
          >
            <SettingsIcon size={15} />设置
          </button>
        </div>
      </header>

      <PdfRecognition onPage={refresh} />

      {/* 主工作区：可拖动双栏，工具抽屉覆盖 PDF，不参与尺寸计算。 */}
      <div ref={workspaceRef} className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className="min-w-0 flex-none overflow-y-auto bg-neutral-50"
          style={{ flexBasis: `${splitPercent}%` }}
        >
          {queueStatus && (
            <div className={`sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs ${queueStatus === 'todo' ? 'border-neutral-200 bg-neutral-100 text-neutral-700' : queueStatus === 'doing' ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
              <span className="font-medium">仅看{queueLabel}</span>
              <button type="button" onClick={() => void moveReview(-1)} disabled={reviewIndex <= 0} className="rounded border border-amber-300 bg-white px-2 py-1 disabled:opacity-40">上一条</button>
              <input
                type="number"
                min="1"
                max={Math.max(1, reviewParagraphs.length)}
                value={reviewIndex >= 0 ? reviewIndex + 1 : ''}
                onChange={(event) => void jumpReview(Number(event.target.value))}
                className="w-12 rounded border border-amber-300 bg-white px-1 py-1 text-center"
                aria-label={`${queueLabel}段落序号`}
              />
              <span>/{reviewParagraphs.length}</span>
              <button type="button" onClick={() => void moveReview(1)} disabled={reviewIndex < 0 || reviewIndex >= reviewParagraphs.length - 1} className="rounded border border-amber-300 bg-white px-2 py-1 disabled:opacity-40">下一条</button>
              <button type="button" onClick={() => setQueueStatus(undefined)} className="ml-auto rounded px-2 py-1 hover:bg-neutral-200">查看全部</button>
            </div>
          )}
          <ParagraphList
            bookPageOffset={bookPageOffset}
            bookPagesPerPdf={bookPagesPerPdf}
            paragraphs={paragraphs}
            currentId={currentId}
            originalPreview={originalPreview}
            onPreviewEdit={(text) => editPreviewRef.current(text)}
            filterStatus={queueStatus}
            navigationRevision={navigationRevision}
            onSelect={handleParagraphSelect}
            onCollapse={async () => {
              await saveCurrentRef.current()
              setCurrentId(null)
            }}
            onCompleteNext={async (id) => {
              if (id === null) setCurrentId(null)
              else await handleParagraphSelect(id)
            }}
            onTranslated={refresh}
            onDeleted={handleParagraphDeleted}
            onSaveReady={(saveCurrent) => { saveCurrentRef.current = saveCurrent }}
          />
        </aside>

        <div
          role="separator"
          aria-label="调整翻译区与 PDF 区宽度"
          aria-orientation="vertical"
          aria-valuemin={30}
          aria-valuemax={75}
          aria-valuenow={Math.round(splitPercent)}
          tabIndex={0}
          title="拖动调整栏宽；双击恢复默认"
          onDoubleClick={() => persistSplit(DEFAULT_SPLIT_PERCENT)}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          className={`group relative z-30 w-2 flex-none cursor-col-resize touch-none border-x outline-none transition-colors focus:bg-blue-100 ${isResizing ? 'border-blue-400 bg-blue-100' : 'border-neutral-200 bg-neutral-100 hover:bg-blue-50'}`}
        >
          <span className="absolute left-1/2 top-1/2 h-12 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-neutral-300 group-hover:bg-blue-500" />
        </div>

        <main className="relative flex min-w-0 flex-1 bg-white">
          <div className={`min-h-0 min-w-0 flex-1 ${toolsOpen ? 'hidden 2xl:block' : ''}`}>
            <PdfViewer
              key={pdfRevision}
              onRelinkPdf={handleRelinkPdf}
              bookPageOffset={bookPageOffset}
              onBookPageOffsetChange={(offset) => {
                setBookPageOffset(offset)
                void api.getProjectMeta().then(meta => setBookPagesPerPdf(meta.book_pages_per_pdf === '2' ? 2 : 1))
              }}
              navigationRevision={navigationRevision}
              onEditingChange={setPdfEditing}
              onDeleted={handleParagraphDeleted}
              paragraph={current}
              paragraphs={paragraphs}
              onSelect={handleParagraphSelect}
              onClearSelection={async () => {
                await saveCurrentRef.current()
                setCurrentId(null)
                setOriginalPreview(null)
              }}
              onOriginalPreview={setOriginalPreview}
              onPreviewEditorReady={(edit) => { editPreviewRef.current = edit }}
              onManualParagraphSaved={async (paragraph) => {
                setOriginalPreview(null)
                await refresh()
                await handleParagraphSelect(paragraph.id)
              }}
            />
          </div>

          {toolsOpen && <div role="separator" aria-label="调整辅助栏宽度" aria-orientation="vertical" tabIndex={0} onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setToolWidth(width => Math.min(520, Math.max(280, width + (event.key === 'ArrowLeft' ? 20 : -20)))) }
          }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); toolDrag.current = { x: event.clientX, width: toolWidth } }} onPointerMove={event => { if (toolDrag.current) setToolWidth(Math.min(520, Math.max(280, toolDrag.current.width + toolDrag.current.x - event.clientX))) }} onPointerUp={() => { toolDrag.current = null }} onPointerCancel={() => { toolDrag.current = null }} className="hidden w-2 flex-none cursor-col-resize touch-none bg-neutral-100 hover:bg-blue-100 2xl:block" />}
            <aside
              aria-label="辅助工具抽屉"
              style={{ '--tool-width': `${toolWidth}px` } as React.CSSProperties}
              className={`${toolsOpen ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col border-l border-neutral-200 bg-white 2xl:w-[var(--tool-width)] 2xl:flex-none`}
            >
              <div className="min-h-0 flex-1">
                <RightPanel
                  paragraph={current}
                  activeTab={activeTool}
                  onSelectParagraph={handleParagraphSelect}
                  onProjectChanged={refresh}
                  onBeforeRestore={() => saveCurrentRef.current()}
                />
              </div>
            </aside>
        </main>
      </div>

      {/* 状态栏 */}
      <footer className="flex min-h-[32px] flex-none items-center gap-4 border-t bg-white px-4 py-1 pb-[max(4px,env(safe-area-inset-bottom))] text-xs leading-5 text-neutral-500">
        <span>{current ? formatParagraphNumbers(sequenceNumbers.get(current.id)!, current.id) : '未选择翻译段'}</span>
        <span>第{(current?.pageIdx ?? 0) + 1}页</span>
        <span
          className="ml-auto flex min-w-0 max-w-[65%] items-center gap-1.5"
          title={llmStatus?.error ?? llmStatus?.model ?? '正在读取模型状态'}
        >
          <span className="truncate">模型：{llmStatus?.configName ?? '未配置'}</span>
          <span className={`h-2 w-2 flex-none rounded-full ${llmDisplay.color}`} aria-hidden="true" />
          <span className="shrink-0">{llmDisplay.label}</span>
        </span>
      </footer>


      {showSearch && (
        <SearchDialog
          paragraphs={paragraphs}
          currentId={currentId}
          onClose={() => setShowSearch(false)}
          onSelect={(id) => {
            setQueueStatus(undefined)
            setShowSearch(false)
            void handleParagraphSelect(id)
          }}
        />
      )}

      {showProjectInfo && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="project-info-title">
        <form className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl" onSubmit={event => {
          event.preventDefault()
          if (projectInfoSaving) return
          setProjectInfoSaving(true)
          setProjectInfoError('')
          void api.updateProjectInfo(projectInfo).then(() => setShowProjectInfo(false)).catch(error => setProjectInfoError(String(error))).finally(() => setProjectInfoSaving(false))
        }}>
          <h2 id="project-info-title" className="mb-4 font-medium">项目资料</h2>
          <div className="grid gap-3">{([
            ['book_original_title', '书原名'], ['book_chinese_title', '书中文名'], ['translator_name', '译者'],
            ['translation_started_at', '开始翻译日期'], ['author_name', '作者'], ['publisher_name', '出版社']
          ] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-sm text-neutral-700">{label}（可选）<input type={key === 'translation_started_at' ? 'date' : 'text'} maxLength={2000} value={projectInfo[key] ?? ''} onChange={event => setProjectInfo(prev => ({ ...prev, [key]: event.target.value }))} className="min-w-0 rounded border px-3 py-2" /></label>)}</div>
          {projectInfoError && <p role="alert" className="mt-3 text-sm text-red-700">{projectInfoError}</p>}
          <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={projectInfoSaving} onClick={() => setShowProjectInfo(false)} className="rounded border px-3 py-2">取消</button><button type="submit" disabled={projectInfoSaving} className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-40">{projectInfoSaving ? '保存中…' : '保存'}</button></div>
        </form>
      </div>}

      {showExport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !exporting) setShowExport(false)
          }}
        >
          <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <h2 id="export-title" className="text-base font-medium">导出译稿</h2>
            <label className="mt-3 flex items-center gap-2 text-sm">版本号<input aria-label="导出版本号" type="text" inputMode="decimal" value={exportOptions.version ?? '1'} onChange={event => setExportOptions(prev => ({ ...prev, version: event.target.value }))} className="w-28 rounded border px-2 py-1" /></label>

            <fieldset className="mt-4">
              <legend className="mb-2 text-sm text-neutral-600">格式</legend>
              <div className="grid grid-cols-4 overflow-hidden rounded border">
                {([
                  ['txt', 'TXT'], ['md', 'Markdown'], ['docx', 'DOCX'], ['html', 'HTML']
                ] as const).map(([value, label]) => <button key={value} type="button"
                  onClick={() => setExportOptions(prev => ({ ...prev, format: value }))}
                  className={`border-l px-3 py-2 text-sm first:border-l-0 ${exportOptions.format === value ? 'bg-para-doing text-white' : 'bg-white hover:bg-neutral-50'}`}>{label}</button>)}
              </div>
            {exportOptions.format === 'docx' && <div className="mt-3 grid grid-cols-2 overflow-hidden rounded border">
              {([['table', '表格式'], ['paragraphs', '段落式']] as const).map(([value, label]) => <button key={value} type="button"
                onClick={() => setExportOptions(prev => ({ ...prev, docxLayout: value }))}
                className={`px-3 py-2 text-sm ${exportOptions.docxLayout !== 'paragraphs' ? (value === 'table' ? 'bg-para-doing text-white' : 'bg-white') : (value === 'paragraphs' ? 'bg-para-doing text-white' : 'bg-white')}`}>{label}</button>)}
            </div>}
            {(exportOptions.format === 'txt' || exportOptions.format === 'md' || (exportOptions.format === 'docx' && exportOptions.docxLayout === 'paragraphs')) && <div className="mt-3 rounded border bg-neutral-50 p-3">
              <div className="mb-2 text-sm text-neutral-600">内容</div>
              <div className="grid grid-cols-2 overflow-hidden rounded border">
                {([
                  ['zh', '纯中文'],
                  ['bilingual', '双语对照']
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setExportOptions((prev) => ({ ...prev, content: value }))}
                    className={`px-3 py-2 text-sm ${exportOptions.content === value ? 'bg-para-doing text-white' : 'bg-white hover:bg-neutral-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>}
            </fieldset>

            {(exportOptions.format === 'docx' || exportOptions.format === 'html') && <fieldset className="mt-4 space-y-2 text-sm">
              <legend className="mb-2 text-neutral-600">附加内容</legend>
              {([
                ['includeNotes', '段落备注'],
                ['includeProjectNote', '项目整体备注'],
                ['includeStatus', '翻译状态'],
                ...(exportOptions.format === 'html' ? [['includePageImages', 'PDF 页面预览']] : [])
              ] as [keyof ExportOptions, string][]).map(([key, label]) => <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={Boolean(exportOptions[key])} onChange={event => setExportOptions(prev => ({ ...prev, [key]: event.target.checked }))} />{label}
              </label>)}
            </fieldset>}

            <fieldset className="mt-4">
              <legend className="mb-2 text-sm text-neutral-600">范围</legend>
              <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox"
                checked={exportPageRangeEnabled}
                onChange={event => { setExportPageRangeEnabled(event.target.checked); setExportOptions(prev => ({ ...prev, pageFrom: event.target.checked ? 1 : undefined, pageTo: undefined })) }} />指定 PDF 页码范围</label>
              {exportPageRangeEnabled && <div className="mb-3 flex items-center gap-2 text-sm">
                <input type="number" min="1" step="1" aria-label="导出起始 PDF 页" className="w-24 rounded border px-2 py-1" value={exportOptions.pageFrom ?? ''}
                  onChange={event => setExportOptions(prev => ({ ...prev, pageFrom: event.target.value ? Number(event.target.value) : undefined }))} />
                <span>至</span><input type="number" min="1" step="1" aria-label="导出结束 PDF 页" placeholder="最后一页" className="w-28 rounded border px-2 py-1" value={exportOptions.pageTo ?? ''}
                  onChange={event => setExportOptions(prev => ({ ...prev, pageTo: event.target.value ? Number(event.target.value) : undefined }))} />
              </div>}
              <div className="grid grid-cols-2 overflow-hidden rounded border">
                {([
                  ['all', `全部段落（${paragraphs.filter(p => isExportPage(p.pageIdx, exportOptions)).length}）`],
                  ['done', `仅已完成（${paragraphs.filter(p => isExportPage(p.pageIdx, exportOptions) && p.status === 'done').length}）`]
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setExportOptions((prev) => ({ ...prev, scope: value }))}
                    className={`px-3 py-2 text-sm ${exportOptions.scope === value ? 'bg-para-doing text-white' : 'bg-white hover:bg-neutral-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowExport(false)}
                className="rounded border px-4 py-2 text-sm hover:bg-neutral-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting || !paragraphs.some(p => isExportPage(p.pageIdx, exportOptions) && (exportOptions.scope === 'all' || p.status === 'done'))}
                className="rounded bg-para-doing px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {exporting ? '导出中...' : '选择保存位置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
