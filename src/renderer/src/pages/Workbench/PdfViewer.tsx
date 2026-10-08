import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { BookOpen, ChevronDown, FolderOpen, Trash2 } from 'lucide-react'
import { api } from '@renderer/lib/ipc'
import type { Paragraph } from '@shared/types'
import { mapOcrRegion, overlapsExisting } from '@shared/ocr-regions'
import { getPdfFocusBox, getPdfFocusScrollAxis, rotatePdfBox } from '@shared/pdf-focus'
import {
  parseNormalizedBbox,
  parseNormalizedBboxes,
  serializeNormalizedBboxes,
  type NormalizedBbox
} from '@shared/bbox'
import {
  cropBoxToHalf,
  getBoxHalf,
  getPdfViewIndex,
  stepPdfView,
  type PdfHalf,
  type PdfViewMode
} from '@shared/pdf-view'

// pdf.js worker 配置（Vite 下用 ?url 拿 worker 路径）
import * as pdfjsLib from 'pdfjs-dist'
import { PSM, type Worker as TesseractWorker } from 'tesseract.js'
import { createLocalOcr } from '@renderer/lib/local-ocr'
// @ts-ignore - vite 的 ?url 导入
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  onRelinkPdf: () => Promise<void>
  bookPageOffset: number
  onBookPageOffsetChange: (offset: number) => void
  paragraph: Paragraph | null
  paragraphs: Paragraph[]
  navigationRevision?: number
  onSelect: (id: number) => void
  onClearSelection: () => Promise<void>
  onDeleted: (id: number, deletedIds?: number[]) => Promise<void>
  onEditingChange: (editing: boolean) => void
  onOriginalPreview: (preview: { id: number; text: string } | null) => void
  onPreviewEditorReady: (edit: (text: string) => void) => void
  onManualParagraphSaved: (paragraph: Paragraph) => void
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'
type ZoomMode = 'fit-page' | 'fit-width' | 'custom'
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'
interface RegionDraft { text: string; box: NormalizedBbox; selected: boolean; duplicate: boolean }

interface ManualAdjustment {
  kind: 'move' | 'resize'
  corner?: ResizeCorner
  startX: number
  startY: number
  box: NormalizedBbox
}

interface ZoomAnchor {
  pageX?: number
  pageY?: number
  oldScale: number
  anchorX: number
  anchorY: number
  scrollLeft: number
  scrollTop: number
}

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const ZOOM_STEP = 1.15
const VIEW_PADDING = 32
const SCROLLBAR_RESERVE = 16
const OVERFLOW_EPSILON = 2
const MIN_MANUAL_BOX_SIZE = 0.01

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function readZoomMode(): ZoomMode {
  const stored = localStorage.getItem('pdf-zoom-mode')
  return stored === 'fit-width' || stored === 'custom' ? stored : 'fit-page'
}

function readCustomScale() {
  const stored = Number(localStorage.getItem('pdf-custom-scale'))
  return Number.isFinite(stored) ? clampScale(stored) : 1
}

/**
 * PDF 预览：段落与 bbox 双向联动，支持完整页/左右单页、独立缩放与平移。
 */
export default function PdfViewer({ onRelinkPdf, bookPageOffset, onBookPageOffsetChange, paragraph, paragraphs, navigationRevision, onSelect, onClearSelection, onDeleted, onEditingChange, onOriginalPreview, onPreviewEditorReady, onManualParagraphSaved }: Props) {
  const [relinking, setRelinking] = useState(false)
  const [relinkError, setRelinkError] = useState('')
  const blankClickStart = useRef<{ x: number; y: number } | null>(null)
  const [zoomDraft, setZoomDraft] = useState<string | null>(null)
  const [zoomPresetsOpen, setZoomPresetsOpen] = useState(false)
  const [pageMappingOpen, setPageMappingOpen] = useState(false)
  const [mappingPdfPage, setMappingPdfPage] = useState('1')
  const [mappingBookPage, setMappingBookPage] = useState('1')
  const [mappingError, setMappingError] = useState('')
  const [mappingSaving, setMappingSaving] = useState(false)
  const [pagesPerPdf, setPagesPerPdf] = useState(1)
  const [rightFirst, setRightFirst] = useState(false)
  const [mappingPagesPerPdf, setMappingPagesPerPdf] = useState(1)
  const [mappingRightFirst, setMappingRightFirst] = useState(false)
  useEffect(() => {
    let active = true
    void api.getProjectMeta().then(meta => {
      if (!active) return
      setPagesPerPdf(meta.book_pages_per_pdf === '2' ? 2 : 1)
      setRightFirst(meta.book_right_first === 'true')
    })
    return () => { active = false }
  }, [])
  const deletingRef = useRef(false)
  const [regionMode, setRegionMode] = useState(false)
  const [regionDrafts, setRegionDrafts] = useState<RegionDraft[]>([])
  const [regionPreview, setRegionPreview] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [selectionBox, setSelectionBox] = useState<NormalizedBbox | null>(null)
  const selectionStart = useRef<{ x: number; y: number } | null>(null)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const deleteSelected = async () => {
    if (deletingRef.current || !selectedIds.length) return
    deletingRef.current = true
    setBatchDeleting(true)
    try {
      if (!window.confirm(`删除选中的 ${selectedIds.length} 个翻译段？原文、译文及这些段落的全部 PDF 坐标框将一起删除，无法撤销。`)) return
      await api.deleteParagraphs(selectedIds)
      await onDeleted(selectedIds[0], selectedIds)
      setSelectedIds([])
    } catch (error) {
      window.alert(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      deletingRef.current = false
      setBatchDeleting(false)
    }
  }
  const deleteBoxParagraph = async (id: number) => {
    if (deletingRef.current) return
    deletingRef.current = true
    try {
      if (!window.confirm(`删除翻译段 #${id}？该段原文、译文和全部 PDF 坐标框将一并删除，无法撤销。`)) return
      await api.deleteParagraph(id)
      await onDeleted(id)
    } catch (error) {
      window.alert(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      deletingRef.current = false
    }
  }
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null)
  const renderGenerationRef = useRef(0)
  const pendingParagraphFocusRef = useRef(false)
  const renderedViewRef = useRef<{ page: number; mode: PdfViewMode; half: PdfHalf; rotation: number } | null>(null)
  const requestedScaleRef = useRef(readCustomScale())
  const pendingZoomRef = useRef<ZoomAnchor | null>(null)
  const gestureAnchorRef = useRef<ZoomAnchor | null>(null)
  const zoomCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spacePressedRef = useRef(false)
  const panRef = useRef<{
    pointerId: number
    x: number
    y: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const manualDragRef = useRef<{ startX: number; startY: number } | null>(null)
  const manualAdjustmentRef = useRef<ManualAdjustment | null>(null)
  const manualOperationRef = useRef(0)
  const ocrWorkerRef = useRef<TesseractWorker | null>(null)

  const [state, setState] = useState<LoadState>('idle')
  const [pageCount, setPageCount] = useState(0)
  const [curPage, setCurPage] = useState(0)
  const [pageJumpValue, setPageJumpValue] = useState('1')
  const [pageJumpError, setPageJumpError] = useState('')
  useEffect(() => { setPageJumpValue(String(curPage || 1)); setPageJumpError('') }, [curPage])
  const [targetPage, setTargetPage] = useState<number | null>(null)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [boxesVisible, setBoxesVisible] = useState(true)
  const [overlayReady, setOverlayReady] = useState(false)
  const [zoomMode, setZoomMode] = useState<ZoomMode>(readZoomMode)
  const [customScale, setCustomScale] = useState(readCustomScale)
  const [renderedScale, setRenderedScale] = useState(1)
  const [previewScale, setPreviewScale] = useState<number | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [viewMode, setViewMode] = useState<PdfViewMode>(() => (
    localStorage.getItem('pdf-view-mode') === 'split' ? 'split' : 'full'
  ))
  const [half, setHalf] = useState<PdfHalf>('left')
  const [manualMode, setManualMode] = useState(false)
  useEffect(() => {
    onEditingChange(manualMode)
    return () => onEditingChange(false)
  }, [manualMode, onEditingChange])
  const [manualEditingId, setManualEditingId] = useState<number | null>(null)
  const [manualBoxes, setManualBoxes] = useState<NormalizedBbox[]>([])
  const [manualBoxIndex, setManualBoxIndex] = useState(0)
  const [manualBox, setManualBox] = useState<NormalizedBbox | null>(null)
  const [manualIsDrawing, setManualIsDrawing] = useState(false)
  const [manualFocusRevision, setManualFocusRevision] = useState(0)
  const [manualText, setManualText] = useState('')
  const recognitionEvidence = useRef<{ ocrRecordId?: number; generationId?: number }>({})
  const supplementEvidence = useRef<{ single: typeof recognitionEvidence.current; regions: typeof recognitionEvidence.current }>({ single: {}, regions: {} })
  const originalDetailsRef = useRef<HTMLDetailsElement>(null)
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({})
  const ocrRotation = pageRotations[targetPage ?? 1] ?? 0
  const quarterTurn = ocrRotation % 180 !== 0
  useEffect(() => { onPreviewEditorReady(setManualText) }, [onPreviewEditorReady])
  const [manualRecognizing, setManualRecognizing] = useState(false)
  const [manualRecognitionNote, setManualRecognitionNote] = useState('')
  const [manualOcrProgress, setManualOcrProgress] = useState('')
  const [manualSaving, setManualSaving] = useState(false)
  const [manualError, setManualError] = useState('')
  const [manualCleaning, setManualCleaning] = useState(false)
  const [manualAutoClean, setManualAutoClean] = useState(true)
  const [manualTextBeforeClean, setManualTextBeforeClean] = useState<string | null>(null)

  useEffect(() => {
    if (manualMode && manualEditingId !== null) {
      onOriginalPreview({ id: manualEditingId, text: manualText })
    } else {
      onOriginalPreview(null)
    }
  }, [manualMode, manualEditingId, manualText, onOriginalPreview])

  useEffect(() => () => onOriginalPreview(null), [onOriginalPreview])

  const pageBoxes = useMemo(() => paragraphs
    .filter((item) => item.pageIdx === curPage - 1)
    .flatMap((item) => parseNormalizedBboxes(item.bboxJson).map((box) => ({ item, box }))),
  [paragraphs, curPage])

  const visiblePageBoxes = useMemo(() => pageBoxes.flatMap(({ item, box }) => {
    if (viewMode === 'full') return [{ item, box }]
    const cropped = cropBoxToHalf(box, half)
    return cropped ? [{ item, box: cropped }] : []
  }), [pageBoxes, viewMode, half])

  useEffect(() => {
    setSelectedIds([])
    setSelectionBox(null)
    selectionStart.current = null
  }, [curPage, viewMode, half, selectionMode, manualMode, boxesVisible])

  useEffect(() => {
    const container = viewportRef.current
    if (!container) return

    let frame = 0
    const updateSize = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        // clientWidth 会随滚动条出现/消失而变化，容易与适页缩放形成重绘循环。
        // 外框尺寸只跟窗口和分栏变化，取整后也不会受亚像素布局扰动。
        const rect = container.getBoundingClientRect()
        const width = Math.max(0, Math.round(rect.width))
        const height = Math.max(0, Math.round(rect.height))
        setContainerSize((current) => (
          current.width === width && current.height === height
            ? current
            : { width, height }
        ))
      })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(container)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setState('loading')
    api.readPdf().then(async (buf) => {
      if (cancelled) return
      if (!buf) {
        setState('error')
        return
      }
      try {
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
        if (cancelled) { void doc.destroy(); return }
        pdfDocRef.current = doc
        setPageCount(doc.numPages)
        setState('ready')
      } catch (error) {
        console.error('[pdf] 加载失败', error)
        if (!cancelled) setState('error')
      }
    }).catch(() => { if (!cancelled) setState('error') })
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      void pdfDocRef.current?.destroy()
    }
  }, [])

  useEffect(() => {
    if (!paragraph) return
    setTargetPage(paragraph.pageIdx + 1)
    if (viewMode === 'split') {
      setHalf(getBoxHalf(parseNormalizedBbox(paragraph.bboxJson)))
    }
  }, [paragraph?.id, paragraph?.pageIdx, paragraph?.bboxJson, viewMode])

  useEffect(() => {
    pendingParagraphFocusRef.current = !!paragraph
  }, [paragraph?.id, paragraph?.pageIdx, paragraph?.bboxJson, navigationRevision, viewMode])

  useEffect(() => {
    const rendered = renderedViewRef.current
    if (!pendingParagraphFocusRef.current || !paragraph || !overlayReady || manualMode || selectionMode || previewScale !== null) return
    // Selection changes reach this effect before the new half-page state is committed.
    if (viewMode === 'split' && half !== getBoxHalf(parseNormalizedBbox(paragraph.bboxJson))) return
    if (!rendered || rendered.page !== paragraph.pageIdx + 1 || rendered.mode !== viewMode || rendered.half !== half || rendered.rotation !== ocrRotation) return
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current
      const page = pageRef.current
      if (!viewport || !page || viewport.clientWidth === 0 || viewport.clientHeight === 0 || pendingZoomRef.current) return
      const boxes = parseNormalizedBboxes(paragraph.bboxJson).flatMap(box => {
        const visible = viewMode === 'split' ? cropBoxToHalf(box, half) : box
        return visible ? [rotatePdfBox(visible, ocrRotation)] : []
      })
      const pageRect = page.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      const box = getPdfFocusBox(boxes, pageRect.width, pageRect.height, viewport.clientWidth, viewport.clientHeight)
      pendingParagraphFocusRef.current = false
      if (!box) return
      viewport.scrollTo({
        left: getPdfFocusScrollAxis(viewport.scrollLeft, viewport.clientWidth, viewport.scrollWidth, pageRect.left - viewportRect.left - viewport.clientLeft + box.left * pageRect.width, box.width * pageRect.width),
        top: getPdfFocusScrollAxis(viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight, pageRect.top - viewportRect.top - viewport.clientTop + box.top * pageRect.height, box.height * pageRect.height),
        behavior: 'instant'
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [paragraph?.id, paragraph?.pageIdx, paragraph?.bboxJson, navigationRevision, overlayReady, curPage, viewMode, half, ocrRotation, pageSize, containerSize, manualMode, selectionMode, previewScale])

  useEffect(() => {
    if (!manualMode || !manualBox || manualIsDrawing || manualAdjustmentRef.current || previewScale !== null || !overlayReady) return
    const visible = viewMode === 'split' ? cropBoxToHalf(manualBox, half) : manualBox
    if (!visible) return
    const frame = requestAnimationFrame(() => {
      if (manualDragRef.current || manualAdjustmentRef.current) return
      const viewport = viewportRef.current, page = pageRef.current
      if (!viewport || !page) return
      const box = rotatePdfBox(visible, ocrRotation)
      const pageRect = page.getBoundingClientRect(), viewportRect = viewport.getBoundingClientRect()
      viewport.scrollTo({
        left: getPdfFocusScrollAxis(viewport.scrollLeft, viewport.clientWidth, viewport.scrollWidth, pageRect.left - viewportRect.left - viewport.clientLeft + box.left * pageRect.width, box.width * pageRect.width),
        top: getPdfFocusScrollAxis(viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight, pageRect.top - viewportRect.top - viewport.clientTop + box.top * pageRect.height, box.height * pageRect.height),
        behavior: 'instant'
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [manualMode, manualBox, manualIsDrawing, manualFocusRevision, containerSize, pageSize, overlayReady, previewScale, viewMode, half, ocrRotation])

  const renderPage = async (pageNum: number, generation: number) => {
    const doc = pdfDocRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas || pageNum < 1 || pageNum > doc.numPages) return

    try {
      const page = await doc.getPage(pageNum)
      if (generation !== renderGenerationRef.current) return
      const baseViewport = page.getViewport({ scale: 1 })
      const widthRatio = viewMode === 'split' ? 0.5 : 1
      const availableWidth = Math.max(160, containerSize.width - VIEW_PADDING)
      const availableHeight = Math.max(160, containerSize.height - VIEW_PADDING)
      const fitWidthScale = availableWidth / (quarterTurn ? baseViewport.height : baseViewport.width * widthRatio)
      const fitPageScale = Math.min(fitWidthScale, availableHeight / (quarterTurn ? baseViewport.width * widthRatio : baseViewport.height))
      const scale = clampScale(
        zoomMode === 'custom'
          ? customScale
          : zoomMode === 'fit-width'
            ? fitWidthScale
            : fitPageScale
      )
      const viewport = page.getViewport({ scale })
      const visibleWidth = viewport.width * widthRatio
      const outputScale = Math.max(1, window.devicePixelRatio || 1)

      const buffer = document.createElement('canvas')
      buffer.width = Math.max(1, Math.floor(visibleWidth * outputScale))
      buffer.height = Math.max(1, Math.floor(viewport.height * outputScale))
      const context = buffer.getContext('2d')
      if (!context) return
      renderTaskRef.current?.cancel()
      const offsetX = viewMode === 'split' && half === 'right' ? -visibleWidth : 0
      const transform = [outputScale, 0, 0, outputScale, offsetX * outputScale, 0]
      const task = page.render({ canvasContext: context, viewport, transform })
      renderTaskRef.current = task
      await task.promise
      if (renderTaskRef.current !== task || generation !== renderGenerationRef.current) return

      canvas.width = buffer.width
      canvas.height = buffer.height
      canvas.style.width = `${visibleWidth}px`
      canvas.style.height = `${viewport.height}px`
      canvas.getContext('2d')?.drawImage(buffer, 0, 0)

      setPageSize({ width: visibleWidth, height: viewport.height })
      setRenderedScale(scale)
      setPreviewScale(null)
      if (zoomMode !== 'custom') requestedScaleRef.current = scale
      setCurPage(pageNum)
      renderedViewRef.current = { page: pageNum, mode: viewMode, half, rotation: ocrRotation }
      setOverlayReady(true)

      const pending = pendingZoomRef.current
      if (pending && viewportRef.current) {
        pendingZoomRef.current = null
        window.requestAnimationFrame(() => {
          const scrollViewport = viewportRef.current
          if (!scrollViewport) return
          const factor = scale / pending.oldScale
          const pageRect = pageRef.current?.getBoundingClientRect()
          const viewportRect = scrollViewport.getBoundingClientRect()
          if (pageRect && pending.pageX !== undefined && pending.pageY !== undefined) {
            scrollViewport.scrollLeft += pageRect.left - viewportRect.left + pending.pageX * factor - pending.anchorX
            scrollViewport.scrollTop += pageRect.top - viewportRect.top + pending.pageY * factor - pending.anchorY
          } else {
            scrollViewport.scrollLeft = (pending.scrollLeft + pending.anchorX) * factor - pending.anchorX
            scrollViewport.scrollTop = (pending.scrollTop + pending.anchorY) * factor - pending.anchorY
          }
        })
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'RenderingCancelledException') return
      console.error('[pdf] 渲染页失败', error)
    }
  }

  useEffect(() => {
    if (state === 'ready' && containerSize.width > 0 && containerSize.height > 0) {
      // 画布会在异步渲染过程中先出现新页内容。此时旧页坐标仍在状态中，
      // 必须先隐藏，直到新画布与 curPage/左右半页状态一起提交完成。
      const generation = ++renderGenerationRef.current
      renderTaskRef.current?.cancel()
      setOverlayReady(false)
      void renderPage(targetPage ?? 1, generation)
    }
  }, [targetPage, state, containerSize.width, containerSize.height, viewMode, half, zoomMode, customScale, ocrRotation])

  const setCustomZoom = (nextScale: number, clientX?: number, clientY?: number) => {
    const next = clampScale(nextScale)
    const viewport = viewportRef.current
    if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current)
    gestureAnchorRef.current = null
    if (viewport) {
      const rect = viewport.getBoundingClientRect()
      pendingZoomRef.current = {
        oldScale: renderedScale,
        anchorX: clientX === undefined ? viewport.clientWidth / 2 : clientX - rect.left,
        anchorY: clientY === undefined ? viewport.clientHeight / 2 : clientY - rect.top,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop
      }
    }
    setZoomMode('custom')
    setCustomScale(next)
    requestedScaleRef.current = next
    localStorage.setItem('pdf-zoom-mode', 'custom')
    localStorage.setItem('pdf-custom-scale', String(next))
  }

  const changeZoomMode = (mode: Exclude<ZoomMode, 'custom'>) => {
    pendingZoomRef.current = null
    setZoomMode(mode)
    localStorage.setItem('pdf-zoom-mode', mode)
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.006)
      const next = clampScale(requestedScaleRef.current * factor)
      const rect = viewport.getBoundingClientRect()
      if (!gestureAnchorRef.current) {
        const pageRect = pageRef.current?.getBoundingClientRect()
        gestureAnchorRef.current = {
          pageX: pageRect ? event.clientX - pageRect.left : undefined,
          pageY: pageRect ? event.clientY - pageRect.top : undefined,
          oldScale: renderedScale,
          anchorX: event.clientX - rect.left,
          anchorY: event.clientY - rect.top,
          scrollLeft: viewport.scrollLeft,
          scrollTop: viewport.scrollTop
        }
      }
      requestedScaleRef.current = next
      setPreviewScale(next)
      if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current)
      zoomCommitTimerRef.current = setTimeout(() => {
        const finalScale = requestedScaleRef.current
        const anchor = gestureAnchorRef.current
        gestureAnchorRef.current = null
        zoomCommitTimerRef.current = null
        if (Math.abs(finalScale - renderedScale) < 0.001) {
          setPreviewScale(null)
          return
        }
        pendingZoomRef.current = anchor
        setZoomMode('custom')
        setCustomScale(finalScale)
        localStorage.setItem('pdf-zoom-mode', 'custom')
        localStorage.setItem('pdf-custom-scale', String(finalScale))
      }, 160)
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [renderedScale])

  useEffect(() => () => {
    if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current)
  }, [])

  useEffect(() => () => {
    void ocrWorkerRef.current?.terminate()
  }, [])

  const viewIndex = getPdfViewIndex(curPage || 1, half, viewMode)
  const viewCount = viewMode === 'split' ? pageCount * 2 : pageCount

  const move = (delta: -1 | 1) => {
    const next = stepPdfView(curPage || 1, half, viewMode, delta, pageCount)
    setHalf(next.half)
    setTargetPage(next.page)
  }

  const changeViewMode = (mode: PdfViewMode) => {
    setViewMode(mode)
    localStorage.setItem('pdf-view-mode', mode)
    if (mode === 'split') {
      setHalf(getBoxHalf(parseNormalizedBbox(paragraph?.bboxJson ?? '')))
    }
  }

  const handleViewportKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return
    if (selectionMode && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat && !event.nativeEvent.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey) void deleteSelected()
      return
    }
    if (selectionMode && event.key === 'Escape') {
      setSelectedIds([])
      setSelectionBox(null)
      selectionStart.current = null
    }
    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault()
      spacePressedRef.current = true
    }
  }

  const handleViewportKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.code === 'Space') spacePressedRef.current = false
  }

  const handlePanStart = (event: PointerEvent<HTMLDivElement>) => {
    blankClickStart.current = event.button === 0 && !spacePressedRef.current ? { x: event.clientX, y: event.clientY } : null
    if (manualMode || selectionMode) return
    if (event.button !== 1 && !spacePressedRef.current) return
    const viewport = viewportRef.current
    if (!viewport) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop
    }
    setIsPanning(true)
  }

  const handlePanMove = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    const viewport = viewportRef.current
    if (!pan || !viewport || pan.pointerId !== event.pointerId) return
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.x)
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.y)
  }

  const handlePanEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return
    panRef.current = null
    setIsPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const pointerToPagePoint = (event: Pick<PointerEvent<HTMLElement>, 'clientX' | 'clientY'>) => {
    const pageElement = pageRef.current
    if (!pageElement) return null
    const rect = pageElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    const [localX, localY] = ocrRotation === 90 ? [y, 1 - x]
      : ocrRotation === 180 ? [1 - x, 1 - y]
        : ocrRotation === 270 ? [1 - y, x] : [x, y]
    return {
      x: viewMode === 'split' ? (half === 'right' ? 0.5 : 0) + localX * 0.5 : localX,
      y: localY
    }
  }

  const selectionPoint = (event: PointerEvent<HTMLDivElement>) => {
    const point = pointerToPagePoint(event)
    if (!point) return null
    return { x: viewMode === 'split' ? (point.x - (half === 'right' ? 0.5 : 0)) * 2 : point.x, y: point.y }
  }

  const updateSelection = (event: PointerEvent<HTMLDivElement>) => {
    const start = selectionStart.current
    const point = selectionPoint(event)
    if (!start || !point) return
    const box = { left: Math.min(start.x, point.x), top: Math.min(start.y, point.y), width: Math.abs(start.x - point.x), height: Math.abs(start.y - point.y) }
    setSelectionBox(box)
    setSelectedIds([...new Set(visiblePageBoxes.filter(({ box: target }) =>
      target.left < box.left + box.width && target.left + target.width > box.left &&
      target.top < box.top + box.height && target.top + target.height > box.top
    ).map(({ item }) => item.id))])
  }

  const constrainManualBox = (box: NormalizedBbox): NormalizedBbox => {
    const width = Math.min(1, Math.max(MIN_MANUAL_BOX_SIZE, box.width))
    const height = Math.min(1, Math.max(MIN_MANUAL_BOX_SIZE, box.height))
    return {
      left: Math.min(1 - width, Math.max(0, box.left)),
      top: Math.min(1 - height, Math.max(0, box.top)),
      width,
      height
    }
  }

  const materializeManualBoxes = (activeBox = manualBox): NormalizedBbox[] => {
    if (!activeBox) return manualBoxes
    if (manualBoxes.length === 0) return [activeBox]
    return manualBoxes.map((box, index) => index === manualBoxIndex ? activeBox : box)
  }

  const selectManualBox = (index: number) => {
    const boxes = materializeManualBoxes()
    const next = boxes[index]
    if (!next) return
    setManualBoxes(boxes)
    setManualBoxIndex(index)
    setManualBox(next)
    setManualError('')
    setManualRecognitionNote(`正在调整第 ${index + 1} 个框；拖框内移动，拖四角缩放。`)
  }

  const startManualAdjustment = (event: PointerEvent<HTMLElement>, kind: ManualAdjustment['kind'], corner?: ResizeCorner) => {
    if (regionMode && manualRecognizing) return
    if (!manualBox || event.button !== 0) return
    const point = pointerToPagePoint(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    manualAdjustmentRef.current = { kind, corner, startX: point.x, startY: point.y, box: manualBox }
  }

  const handleManualStart = (event: PointerEvent<HTMLDivElement>) => {
    if (regionMode && manualRecognizing) return
    if (!manualMode || event.button !== 0) return
    if (manualAdjustmentRef.current) return
    const point = pointerToPagePoint(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    manualOperationRef.current += 1
    setManualRecognizing(false)
    setManualCleaning(false)
    setManualError('')
    setManualRecognitionNote('')
    setManualOcrProgress('')
    setManualTextBeforeClean(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    manualDragRef.current = { startX: point.x, startY: point.y }
    setManualIsDrawing(true)
    setManualBox({ left: point.x, top: point.y, width: 0, height: 0 })
  }

  const handleManualMove = (event: PointerEvent<HTMLDivElement>) => {
    const adjustment = manualAdjustmentRef.current
    if (manualMode && adjustment) {
      const point = pointerToPagePoint(event)
      if (!point) return
      event.preventDefault()
      const deltaX = point.x - adjustment.startX
      const deltaY = point.y - adjustment.startY
      if (adjustment.kind === 'move') {
        setManualBox(constrainManualBox({
          ...adjustment.box,
          left: adjustment.box.left + deltaX,
          top: adjustment.box.top + deltaY
        }))
        return
      }

      const right = adjustment.box.left + adjustment.box.width
      const bottom = adjustment.box.top + adjustment.box.height
      let left = adjustment.box.left
      let top = adjustment.box.top
      let nextRight = right
      let nextBottom = bottom
      if (adjustment.corner === 'nw' || adjustment.corner === 'sw') left = Math.min(right - MIN_MANUAL_BOX_SIZE, Math.max(0, left + deltaX))
      if (adjustment.corner === 'ne' || adjustment.corner === 'se') nextRight = Math.max(left + MIN_MANUAL_BOX_SIZE, Math.min(1, nextRight + deltaX))
      if (adjustment.corner === 'nw' || adjustment.corner === 'ne') top = Math.min(bottom - MIN_MANUAL_BOX_SIZE, Math.max(0, top + deltaY))
      if (adjustment.corner === 'sw' || adjustment.corner === 'se') nextBottom = Math.max(top + MIN_MANUAL_BOX_SIZE, Math.min(1, nextBottom + deltaY))
      setManualBox({ left, top, width: nextRight - left, height: nextBottom - top })
      return
    }
    const start = manualDragRef.current
    if (!manualMode || !start) return
    const point = pointerToPagePoint(event)
    if (!point) return
    event.preventDefault()
    const left = Math.min(start.startX, point.x)
    const top = Math.min(start.startY, point.y)
    setManualBox({ left, top, width: Math.abs(point.x - start.startX), height: Math.abs(point.y - start.startY) })
  }

  const handleManualEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (manualAdjustmentRef.current) {
      manualAdjustmentRef.current = null
      setManualFocusRevision(value => value + 1)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      return
    }
    if (!manualMode || !manualDragRef.current) return
    const start = manualDragRef.current
    manualDragRef.current = null
    setManualIsDrawing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const point = pointerToPagePoint(event)
    if (!point || event.type === 'pointercancel') {
      setManualBox(null)
      return
    }
    const box = {
      left: Math.min(start.startX, point.x),
      top: Math.min(start.startY, point.y),
      width: Math.abs(point.x - start.startX),
      height: Math.abs(point.y - start.startY)
    }
    if (box.width < 0.01 || box.height < 0.01) {
      setManualBox(null)
      return
    }
    const boxes = materializeManualBoxes(box)
    setManualBox(box)
    setManualBoxes(boxes)
    setRegionDrafts([])
    if (regionMode) void recognizeRegions(box)
    else void recognizeManualBoxes(boxes)
  }

  const extractTextFromSelection = async (box: NormalizedBbox) => {
    const doc = pdfDocRef.current
    if (!doc || curPage < 1) return ''
    const page = await doc.getPage(curPage)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const left = box.left * viewport.width
    const top = box.top * viewport.height
    const right = (box.left + box.width) * viewport.width
    const bottom = (box.top + box.height) * viewport.height
    const lines = new Map<number, { x: number; text: string }[]>()

    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [,,, , x, y] = item.transform
      const itemWidth = item.width
      const itemHeight = Math.abs(item.height) || 10
      const itemTop = viewport.height - y - itemHeight
      const itemBottom = viewport.height - y + itemHeight * 0.25
      if (x + itemWidth < left || x > right || itemBottom < top || itemTop > bottom) continue
      const lineKey = Math.round((viewport.height - y) / 4) * 4
      const line = lines.get(lineKey) ?? []
      line.push({ x, text: item.str })
      lines.set(lineKey, line)
    }

    return [...lines.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, line]) => line.sort((a, b) => a.x - b.x).map((item) => item.text).join(' '))
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
  }

  const recognizeManualBoxes = async (boxes: NormalizedBbox[]) => {
    if (boxes.length === 0) return
    if (viewMode === 'split' && boxes.some((box) => !cropBoxToHalf(box, half))) {
      setManualError('该翻译段含有另一半页面的坐标框，请切换到“完整页”后重新识别全部原文。')
      return
    }
    const operation = ++manualOperationRef.current
    setManualRecognizing(true)
    setManualError('')
    setManualTextBeforeClean(null)
    recognitionEvidence.current = {}
    setManualRecognitionNote(boxes.length > 1 ? `正在识别 ${boxes.length} 个坐标框…` : '正在读取 PDF 内置文本层…')
    try {
      const recognized: string[] = []
      let usedOcr = false
      for (const [index, box] of boxes.entries()) {
        setManualRecognitionNote(boxes.length > 1 ? `正在识别第 ${index + 1} / ${boxes.length} 个框…` : '正在读取 PDF 内置文本层…')
        let text = ocrRotation === 0 ? await extractTextFromSelection(box) : ''
        if (operation !== manualOperationRef.current) return
        if (!text) {
          usedOcr = true
          setManualRecognitionNote(boxes.length > 1 ? `第 ${index + 1} 个框正在使用本机 OCR…` : 'PDF 没有内置文字，正在使用本机 OCR…')
          text = await recognizeCanvasSelection(box)
          if (operation !== manualOperationRef.current) return
        }
        if (text.trim()) recognized.push(text.trim())
      }
      const recognizedText = recognized.join('\n')
      const ocrRecordId = await api.recordOcrResult({ paragraphId: manualEditingId ?? undefined, pageIdx: curPage - 1, boxes, rotation: ocrRotation, method: usedOcr ? 'Tesseract / PDF text layer' : 'PDF text layer', text: recognizedText })
      if (operation !== manualOperationRef.current) return
      recognitionEvidence.current = { ocrRecordId }
      if (recognized.length === 0) {
        setManualRecognitionNote('没有识别到文字。可继续调整范围、从剪贴板粘贴，或手动输入。')
        if (originalDetailsRef.current) originalDetailsRef.current.open = true
        return
      }
      setManualText(recognizedText)
      if (manualAutoClean) {
        setManualRecognizing(false)
        setManualCleaning(true)
        setManualRecognitionNote('识别结果已显示在左侧，正在用 AI 整理意外断行…')
        const result = await api.cleanOcrLineBreaks(recognizedText, manualEditingId ?? undefined)
        if (operation !== manualOperationRef.current) return
        setManualCleaning(false)
        recognitionEvidence.current.generationId = result.generationId
        if (!result.ok || !result.text) {
          setManualError(`文字已识别，但 AI 整理断行失败：${result.error ?? '请稍后重试。'}`)
          return
        }
        setManualTextBeforeClean(result.text === recognizedText ? null : recognizedText)
        setManualText(result.text)
        setManualRecognitionNote(
          result.text === recognizedText
            ? '识别完成；AI 判断没有需要合并的意外断行。左侧为尚未保存的预览。'
            : '识别及 AI 断行整理完成，左侧已更新为尚未保存的预览。'
        )
      } else {
        setManualRecognitionNote(
          `${usedOcr ? '本机 OCR' : 'PDF 文本层'}识别完成；已按原始断行显示在左侧，尚未保存。`
        )
      }
    } catch {
      if (operation !== manualOperationRef.current) return
      setManualRecognitionNote('读取 PDF 文本失败。可粘贴剪贴板文字，或手动输入。')
      if (originalDetailsRef.current) originalDetailsRef.current.open = true
    } finally {
      if (operation === manualOperationRef.current) {
        setManualRecognizing(false)
        setManualCleaning(false)
      }
    }
  }

  const recognizeCanvasSelection = async (box: NormalizedBbox, onRegions?: (regions: { text: string; box: NormalizedBbox }[]) => void) => {
    let canvas = canvasRef.current
    // OCR uses an independent render, not the current screen zoom.
    const fullPageSource = !!pdfDocRef.current
    if (pdfDocRef.current) {
      const page = await pdfDocRef.current.getPage(curPage)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(3, Math.sqrt(16000000 / (base.width * base.height))) })
      canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建区域识别图像。')
      await page.render({ canvasContext: context, viewport }).promise
    }
    if (!canvas) return ''
    const splitSource = !fullPageSource && viewMode === 'split'
    const visible = splitSource ? cropBoxToHalf(box, half) : box
    if (!visible) return ''
    const sourceWidth = canvas.width
    const sourceHeight = canvas.height
    const cropLeft = Math.max(0, Math.floor(visible.left * sourceWidth))
    const cropTop = Math.max(0, Math.floor(visible.top * sourceHeight))
    const cropWidth = Math.max(1, Math.min(sourceWidth - cropLeft, Math.ceil(visible.width * sourceWidth)))
    const cropHeight = Math.max(1, Math.min(sourceHeight - cropTop, Math.ceil(visible.height * sourceHeight)))
    const image = document.createElement('canvas')
    // Upscale small text before OCR; the source canvas itself remains untouched.
    const scale = Math.max(1, Math.min(3, 1400 / cropWidth))
    image.width = Math.round(cropWidth * scale)
    image.height = Math.round(cropHeight * scale)
    const context = image.getContext('2d')
    if (!context) return ''
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, image.width, image.height)
    context.drawImage(canvas, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, image.width, image.height)

    let worker = onRegions ? null : ocrWorkerRef.current
    if (!worker) {
      setManualOcrProgress('正在准备英文识别模型…')
      worker = await createLocalOcr((message) => {
          if (message.status === 'recognizing text') {
            setManualOcrProgress(`正在识别…${Math.round(message.progress * 100)}%`)
          } else if (message.status.includes('loading')) {
            setManualOcrProgress('正在加载内置英文识别模型…')
          }
      })
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
      if (!onRegions) ocrWorkerRef.current = worker
    } else {
      setManualOcrProgress('正在识别…')
    }
    try {
      let input = image
      if (ocrRotation !== 0) {
        input = document.createElement('canvas')
        input.width = quarterTurn ? image.height : image.width
        input.height = quarterTurn ? image.width : image.height
        const rotated = input.getContext('2d')
        if (!rotated) throw new Error('无法旋转识别图片。')
        rotated.translate(input.width / 2, input.height / 2)
        rotated.rotate(ocrRotation * Math.PI / 180)
        rotated.drawImage(image, -image.width / 2, -image.height / 2)
      }
      await worker.setParameters({ tessedit_pageseg_mode: onRegions ? PSM.AUTO : PSM.SPARSE_TEXT })
      const result = await worker.recognize(input, {}, { text: true, blocks: !!onRegions })
      if (onRegions) {
        const crop = {
          left: (cropLeft / sourceWidth) * (splitSource ? 0.5 : 1) + (splitSource && half === 'right' ? 0.5 : 0),
          top: cropTop / sourceHeight,
          width: cropWidth / sourceWidth * (splitSource ? 0.5 : 1),
          height: cropHeight / sourceHeight
        }
        onRegions((result.data.blocks ?? []).flatMap(block => block.paragraphs).filter(item => item.text.trim()).map(item => ({
          text: item.text.trim(),
          box: mapOcrRegion({ left: item.bbox.x0 / input.width, top: item.bbox.y0 / input.height, width: (item.bbox.x1 - item.bbox.x0) / input.width, height: (item.bbox.y1 - item.bbox.y0) / input.height }, crop, ocrRotation)
        })))
      }
      return result.data.text.trim()
    } finally {
      if (onRegions) await worker.terminate()
      setManualOcrProgress('')
    }
  }

  const recognizeRegions = async (box: NormalizedBbox) => {
    if (manualRecognizing || manualCleaning) return
    const operation = ++manualOperationRef.current
    setManualRecognizing(true)
    setManualError('')
    setRegionDrafts([])
    try {
      let regions: { text: string; box: NormalizedBbox }[] = []
      await recognizeCanvasSelection(box, result => { regions = result })
      if (operation !== manualOperationRef.current) return
      const ocrRecordId = await api.recordOcrResult({ pageIdx: curPage - 1, boxes: [box], rotation: ocrRotation, method: 'Tesseract blocks', text: regions.map(item => item.text).join('\n\n'), regions })
      if (operation !== manualOperationRef.current) return
      recognitionEvidence.current = { ocrRecordId }
      if (!regions.length) throw new Error('没有识别出文字块，请调整范围或使用单段补录。')
      setRegionDrafts(regions.map(item => {
        const duplicate = overlapsExisting(item.box, pageBoxes.map(existing => existing.box))
        return { ...item, duplicate, selected: !duplicate }
      }))
      setRegionPreview(true)
    } catch (error) {
      if (operation === manualOperationRef.current) setManualError(error instanceof Error ? error.message : '区域识别失败。')
    } finally {
      if (operation === manualOperationRef.current) setManualRecognizing(false)
    }
  }

  const saveRegions = async () => {
    const selected = regionDrafts.filter(item => item.selected)
    if (!selected.length || manualSaving) return
    if (selected.some(item => !item.text.trim() || item.box.width <= 0 || item.box.height <= 0 || item.box.left + item.box.width > 1.00001 || item.box.top + item.box.height > 1.00001)) {
      setManualError('请检查已选段落的原文和坐标，坐标不能超出页面。')
      return
    }
    if (selected.some(item => overlapsExisting(item.box, pageBoxes.map(existing => existing.box))) && !window.confirm('已选结果包含疑似重复区域，仍然作为新段落加入？已有段落和译文不会被覆盖。')) return
    setManualSaving(true)
    setManualError('')
    try {
      const saved = await api.createManualParagraphBatch(selected.map(item => ({ ...recognitionEvidence.current, pageIdx: curPage - 1, enText: item.text, bboxJson: serializeNormalizedBboxes([item.box]), insertAfterParagraphId: paragraph?.pageIdx === curPage - 1 ? paragraph.id : undefined })))
      resetManualEditor()
      onManualParagraphSaved(saved[0])
    } catch (error) {
      setManualError(error instanceof Error ? error.message : '批量加入失败。')
    } finally { setManualSaving(false) }
  }

  const changeSupplementMode = (nextRegionMode: boolean) => {
    if (manualRecognizing || manualCleaning || manualSaving || nextRegionMode === regionMode) return
    setRegionMode(nextRegionMode)
    supplementEvidence.current[regionMode ? 'regions' : 'single'] = { ...recognitionEvidence.current }
    recognitionEvidence.current = supplementEvidence.current[nextRegionMode ? 'regions' : 'single']
    setManualError('')
    if (nextRegionMode) {
      if (regionDrafts.length) setRegionPreview(true)
      else if (manualBox) void recognizeRegions(manualBox)
    } else {
      setRegionPreview(false)
      if (!manualText.trim() && regionDrafts.length) setManualText(regionDrafts.filter(item => item.selected).map(item => item.text).join('\n\n'))
    }
  }

  const supplementModes = manualEditingId === null ? (
    <div className="inline-flex flex-none overflow-hidden rounded border border-neutral-300 text-xs" aria-label="补录方式">
      {([false, true] as const).map(mode => <button key={String(mode)} type="button" aria-pressed={regionMode === mode} disabled={manualRecognizing || manualCleaning || manualSaving} onClick={() => changeSupplementMode(mode)} className={`px-2 py-1 disabled:opacity-40 ${regionMode === mode ? 'bg-blue-600 text-white' : 'bg-white hover:bg-neutral-50'}`}>{mode ? '自动分块' : '单段补录'}</button>)}
    </div>
  ) : null

  const pasteManualText = async () => {
    try {
      const text = await navigator.clipboard?.readText()
      if (!text?.trim()) {
        setManualRecognitionNote('剪贴板里没有可用文字。')
        return
      }
      setManualText(text.trim())
      setManualTextBeforeClean(null)
      setManualRecognitionNote('已从剪贴板填入，可继续修订。')
    } catch {
      setManualRecognitionNote('无法读取剪贴板，请直接在输入框中粘贴。')
    }
  }

  const resetManualEditor = () => {
    recognitionEvidence.current = {}
    supplementEvidence.current = { single: {}, regions: {} }
    setRegionMode(false)
    setRegionPreview(false)
    setRegionDrafts([])
    manualOperationRef.current += 1
    manualDragRef.current = null
    setManualIsDrawing(false)
    manualAdjustmentRef.current = null
    setManualMode(false)
    setManualRecognizing(false)
    setManualEditingId(null)
    setManualBoxes([])
    setManualBoxIndex(0)
    setManualBox(null)
    setManualText('')
    setManualError('')
    setManualRecognitionNote('')
    setManualOcrProgress('')
    setManualCleaning(false)
    setManualTextBeforeClean(null)
  }

  const editParagraphRegion = (target: Paragraph) => {
    recognitionEvidence.current = {}
    const boxes = parseNormalizedBboxes(target.bboxJson)
    if (boxes.length === 0) return
    const visibleIndex = viewMode === 'split'
      ? Math.max(0, boxes.findIndex((box) => cropBoxToHalf(box, half)))
      : 0
    manualOperationRef.current += 1
    setManualRecognizing(false)
    setManualCleaning(false)
    setManualEditingId(target.id)
    setManualBoxes(boxes)
    setManualBoxIndex(visibleIndex)
    setManualBox(boxes[visibleIndex])
    setManualText(target.enText)
    setManualTextBeforeClean(null)
    setManualMode(true)
    setManualError('')
    setManualRecognitionNote(
      boxes.length > 1
        ? `该翻译段有 ${boxes.length} 个坐标框。点击框或下方编号切换，分别移动和缩放。`
        : '拖动框内任意位置可移动；拖动四角可调整大小。'
    )
    setManualOcrProgress('')
  }

  useEffect(() => {
    if (regionMode) resetManualEditor()
  }, [curPage, viewMode, half, ocrRotation])

  const editCurrentParagraphRegion = () => {
    if (paragraph) editParagraphRegion(paragraph)
  }

  const saveManualParagraph = async () => {
    const boxes = materializeManualBoxes()
    if (manualSaving || manualRecognizing || manualCleaning) return
    if (boxes.length === 0 || !manualText.trim() || curPage < 1) {
      setManualError(!manualText.trim() ? '原文为空，暂时不能加入待译段。请重新识别，或粘贴、输入原文。' : '请先框选有效的 PDF 区域。')
      if (originalDetailsRef.current) originalDetailsRef.current.open = true
      return
    }
    setManualSaving(true)
    setManualError('')
    try {
      const bboxJson = serializeNormalizedBboxes(boxes)
      const saved = manualEditingId === null
        ? await api.createManualParagraph({
          ...recognitionEvidence.current,
          pageIdx: curPage - 1,
          enText: manualText,
          bboxJson,
          insertAfterParagraphId: paragraph?.pageIdx === curPage - 1 ? paragraph.id : undefined
        })
        : await api.updateParagraphRegion({ ...recognitionEvidence.current, id: manualEditingId, enText: manualText, bboxJson })
      resetManualEditor()
      onManualParagraphSaved(saved)
    } catch (error) {
      setManualError(error instanceof Error ? error.message : '补录失败，请重试。')
    } finally {
      setManualSaving(false)
    }
  }

  const displayWidth = quarterTurn ? pageSize.height : pageSize.width
  const displayHeight = quarterTurn ? pageSize.width : pageSize.height
  const requiredWidth = displayWidth + VIEW_PADDING
  const requiredHeight = displayHeight + VIEW_PADDING
  let overflowsY = requiredHeight > containerSize.height + OVERFLOW_EPSILON
  let overflowsX = requiredWidth > containerSize.width - (overflowsY ? SCROLLBAR_RESERVE : 0) + OVERFLOW_EPSILON
  if (overflowsX) {
    overflowsY = requiredHeight > containerSize.height - SCROLLBAR_RESERVE + OVERFLOW_EPSILON
  }
  if (overflowsY && !overflowsX) {
    overflowsX = requiredWidth > containerSize.width - SCROLLBAR_RESERVE + OVERFLOW_EPSILON
  }
  const contentWidth: number | string = overflowsX ? Math.ceil(requiredWidth) : '100%'
  const contentHeight: number | string = overflowsY ? Math.ceil(requiredHeight) : '100%'
  const displayedScale = previewScale ?? renderedScale
  const displayedPercent = Math.round(displayedScale * 1000) / 10
  const firstBookPage = (curPage - 1) * pagesPerPdf + 1 + bookPageOffset
  useEffect(() => {
    if (!pageMappingOpen) return
    setMappingPdfPage(String(curPage || 1))
    setMappingBookPage(String(Math.max(1, firstBookPage)))
    setMappingError('')
  }, [curPage, firstBookPage, pageMappingOpen])
  const bookPageLabel = firstBookPage > 0
    ? pagesPerPdf === 1 ? `书页 ${firstBookPage}`
      : viewMode === 'full' ? `书页 ${firstBookPage}–${firstBookPage + 1}`
        : `书页 ${firstBookPage + ((half === 'right') !== rightFirst ? 1 : 0)}`
    : ''

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-white">
      <div className="flex min-h-10 flex-none flex-wrap items-center gap-2 border-b border-neutral-300 bg-neutral-100 px-3 py-1 text-xs text-neutral-700">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={boxesVisible}
            onChange={(event) => setBoxesVisible(event.target.checked)}
          />
          <span>显示翻译段区域</span>
          <span className="text-neutral-400">（共{visiblePageBoxes.length}个）</span>
        </label>
        <button
          type="button"
          onClick={() => {
            if (manualMode) {
              resetManualEditor()
              return
            }
            setRegionMode(false)
            setRegionDrafts([])
            setRegionPreview(false)
            setSelectionMode(false)
            setManualMode(true)
            setManualEditingId(null)
            setManualBoxes([])
            setManualBoxIndex(0)
            setManualBox(null)
            setManualError('')
            setManualRecognitionNote('')
            setManualText('')
            setManualTextBeforeClean(null)
            setManualOcrProgress('')
          }}
          className={`rounded border px-2 py-1 text-xs ${manualMode ? 'border-amber-500 bg-amber-50 text-amber-800' : 'hover:bg-neutral-200'}`}
          title="在 PDF 上拖出 OCR 漏识别区域并补录原文"
        >
          {manualMode ? '退出补录' : '+ 补录区域'}
        </button>
        {paragraph && parseNormalizedBbox(paragraph.bboxJson) && paragraph.pageIdx === curPage - 1 && !manualMode && !selectionMode && (
          <button
            type="button"
            onClick={editCurrentParagraphRegion}
            className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
            title="调整当前段落的识别范围，并重新识别或修订 OCR 原文"
          >
            调整识别区域
          </button>
        )}
        {paragraph && paragraph.pageIdx === curPage - 1 && !manualMode && !selectionMode && (
          <button type="button" disabled={batchDeleting} onClick={() => void deleteBoxParagraph(paragraph.id)} title="删除选中的翻译段及其全部区域" className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-40"><Trash2 size={13} />删除翻译段</button>
        )}

        <label className="flex items-center gap-1">
          <input type="checkbox" checked={selectionMode} disabled={manualMode || batchDeleting} onChange={event => {
            setSelectionMode(event.target.checked)
            setBoxesVisible(true)
          }} />
          框选多选
        </label>
        {selectionMode && <>
          <span aria-live="polite">已选 {selectedIds.length} 段</span>
          <button type="button" disabled={!selectedIds.length || batchDeleting} onClick={() => setSelectedIds([])} className="rounded border px-2 py-1 disabled:opacity-40">取消选择</button>
          <button type="button" disabled={!selectedIds.length || batchDeleting} onClick={() => void deleteSelected()} className="rounded border border-red-200 px-2 py-1 text-red-700 disabled:opacity-40">{batchDeleting ? '删除中…' : '删除选中段'}</button>
        </>}

        <div className="ml-auto flex items-center gap-1" aria-label="PDF 缩放">
          {([-90, 90] as const).map((angle) => (
            <button key={angle} type="button" title={angle < 0 ? '本页向左旋转 90°' : '本页向右旋转 90°'} aria-label={angle < 0 ? '本页向左旋转' : '本页向右旋转'} disabled={manualRecognizing || manualCleaning || !overlayReady} onClick={() => {
              if (zoomCommitTimerRef.current) clearTimeout(zoomCommitTimerRef.current)
              gestureAnchorRef.current = null
              pendingZoomRef.current = null
              setPreviewScale(null)
              setPageRotations((rotations) => ({ ...rotations, [curPage]: ((rotations[curPage] ?? 0) + angle + 360) % 360 }))
            }} className="h-7 w-7 rounded text-base hover:bg-neutral-200 disabled:opacity-30">
              {angle < 0 ? '↶' : '↷'}
            </button>
          ))}
          <button
            type="button"
            title="缩小"
            aria-label="缩小 PDF"
            disabled={displayedScale <= MIN_SCALE + 0.001}
            onClick={() => setCustomZoom(renderedScale / ZOOM_STEP)}
            className="h-7 w-7 rounded text-base hover:bg-neutral-200 disabled:opacity-30"
          >
            −
          </button>
          <div className="relative flex flex-none items-center">
            <input
              aria-label="PDF 缩放百分比"
              title="缩放百分比（25%–400%）"
              inputMode="decimal"
              value={zoomDraft ?? String(displayedPercent)}
              onFocus={event => { setZoomPresetsOpen(false); setZoomDraft(event.target.value); event.target.select() }}
              onChange={event => setZoomDraft(event.target.value)}
              onBlur={event => {
                const value = event.target.value.trim().replace(/%$/, '')
                const percent = Number(value)
                if (value && Number.isFinite(percent) && percent > 0 && percent !== displayedPercent && zoomDraft !== null) setCustomZoom(percent / 100)
                setZoomDraft(null)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
                if (event.key === 'Escape') {
                  event.currentTarget.value = String(displayedPercent)
                  setZoomDraft(null)
                  event.currentTarget.blur()
                }
              }}
              className="h-7 w-10 rounded bg-transparent text-right tabular-nums focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="pl-0.5">%</span>
            <button type="button" aria-label="常用缩放比例" title="常用缩放比例" aria-expanded={zoomPresetsOpen} onClick={() => setZoomPresetsOpen(open => !open)} className="flex h-7 w-5 items-center justify-center rounded hover:bg-neutral-200"><ChevronDown size={12} /></button>
            {zoomPresetsOpen && <>
              <button type="button" tabIndex={-1} aria-label="关闭缩放选项" onClick={() => setZoomPresetsOpen(false)} className="fixed inset-0 z-40 cursor-default" />
              <div className="absolute right-0 top-full z-50 mt-1 min-w-24 rounded border bg-white py-1 shadow-md">
                {[100, 75, 50, 25].map(percent => <button key={percent} type="button" onClick={() => { setCustomZoom(percent / 100); setZoomPresetsOpen(false) }} className="block w-full px-3 py-1.5 text-right tabular-nums hover:bg-blue-50">{percent}%</button>)}
              </div>
            </>}
          </div>
          <button
            type="button"
            title="放大"
            aria-label="放大 PDF"
            disabled={displayedScale >= MAX_SCALE - 0.001}
            onClick={() => setCustomZoom(renderedScale * ZOOM_STEP)}
            className="h-7 w-7 rounded text-base hover:bg-neutral-200 disabled:opacity-30"
          >
            +
          </button>
          <div className="ml-1 inline-flex overflow-hidden rounded border border-neutral-300 bg-white">
            <button
              type="button"
              title="让整页适合当前区域"
              aria-pressed={zoomMode === 'fit-page'}
              onClick={() => changeZoomMode('fit-page')}
              className={`px-2 py-1 ${zoomMode === 'fit-page' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-100'}`}
            >
              适页
            </button>
            <button
              type="button"
              title="让页面宽度适合当前区域"
              aria-pressed={zoomMode === 'fit-width'}
              onClick={() => changeZoomMode('fit-width')}
              className={`border-l border-neutral-300 px-2 py-1 ${zoomMode === 'fit-width' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-100'}`}
            >
              适宽
            </button>
          </div>
        </div>

      </div>




      <div
        ref={viewportRef}
        aria-label="PDF 阅读区域"
        tabIndex={0}
        onKeyDown={handleViewportKeyDown}
        onKeyUp={handleViewportKeyUp}
        onBlur={() => { spacePressedRef.current = false }}
        onPointerDown={handlePanStart}
        onPointerMove={handlePanMove}
        onPointerUp={handlePanEnd}
        onPointerCancel={handlePanEnd}
        onClick={(event) => {
          const start = blankClickStart.current
          if (manualMode || selectionMode || !start || event.button !== 0 || spacePressedRef.current) return
          if ((event.target as HTMLElement).closest('button, input, textarea, select, a')) return
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return
          setSelectedIds([])
          void onClearSelection()
        }}
        style={{
          overflowX: overflowsX ? 'auto' : 'hidden',
          overflowY: overflowsY ? 'auto' : 'hidden'
        }}
        className={`min-h-0 flex-1 overflow-auto bg-neutral-300 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${isPanning ? 'cursor-grabbing' : ''}`}
      >
        {state === 'loading' && (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">加载 PDF...</div>
        )}
        {state === 'error' && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-neutral-500">
            <div className="text-4xl opacity-30">PDF</div>
            <p className="mt-2">PDF 加载失败</p>
            <p className="text-xs">请确认项目已关联原书 PDF</p>
            <button type="button" disabled={relinking} onClick={() => {
              setRelinking(true); setRelinkError('')
              void onRelinkPdf().catch(error => setRelinkError(String(error))).finally(() => setRelinking(false))
            }} className="mt-3 flex items-center gap-1.5 rounded border bg-white px-3 py-2 text-blue-700 disabled:opacity-40"><FolderOpen size={16} />重新关联原书 PDF</button>
            {relinkError && <p role="alert" className="mt-2 text-xs text-red-700">{relinkError}</p>}
          </div>
        )}
        {state === 'ready' && (
          <div
            className="flex items-center justify-center"
            style={{ width: contentWidth, height: contentHeight }}
          >
            <div className="relative flex-none" style={{ width: displayWidth, height: displayHeight }}>
            <div
              ref={pageRef}
              className="relative flex-none bg-white shadow-lg"
              style={{
                width: pageSize.width,
                height: pageSize.height,
                left: (displayWidth - pageSize.width) / 2,
                top: (displayHeight - pageSize.height) / 2,
                transform: `rotate(${ocrRotation}deg) scale(${previewScale === null ? 1 : previewScale / renderedScale})`,
                transformOrigin: ocrRotation === 0 ? `${(gestureAnchorRef.current ?? pendingZoomRef.current)?.pageX ?? pageSize.width / 2}px ${(gestureAnchorRef.current ?? pendingZoomRef.current)?.pageY ?? pageSize.height / 2}px` : 'center center',
                willChange: previewScale === null ? undefined : 'transform'
              }}
            >
              <canvas ref={canvasRef} className="block bg-white" />
              {boxesVisible && !manualMode && overlayReady && (
                <div className="pointer-events-none absolute inset-0">
                  {visiblePageBoxes.map(({ item, box }, boxIndex) => {
                    const active = selectionMode ? selectedIds.includes(item.id) : item.id === paragraph?.id
                    return (
                      <button
                        key={`${curPage}:${viewMode}:${half}:${item.id}:${boxIndex}`}
                        type="button"
                        title={`#${item.id} ${item.enText}\n选中后按 Delete 或 Backspace 删除翻译段`}
                        aria-label={`选中段落 ${item.id}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          event.currentTarget.focus()
                          onSelect(item.id)
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Delete' && event.key !== 'Backspace') return
                          event.preventDefault()
                          event.stopPropagation()
                          if (event.repeat || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
                          void deleteBoxParagraph(item.id)
                        }}
                        onDoubleClick={() => {
                          onSelect(item.id)
                          editParagraphRegion(item)
                        }}
                        className={`pointer-events-auto absolute transition-colors ${active
                          ? 'z-10 border-2 border-blue-600 bg-blue-400/25 ring-2 ring-blue-100'
                          : 'border border-cyan-500/70 bg-cyan-300/10 hover:border-blue-600 hover:bg-blue-300/20'
                        }`}
                        style={{
                          left: `${box.left * 100}%`,
                          top: `${box.top * 100}%`,
                          width: `${box.width * 100}%`,
                          height: `${box.height * 100}%`
                        }}
                      />
                    )
                  })}
                </div>
              )}
              {selectionMode && !manualMode && overlayReady && boxesVisible && (
                <div className="absolute inset-0 z-20 cursor-crosshair touch-none"
                  onPointerDown={event => {
                    if (event.button !== 0 || batchDeleting) return
                    event.preventDefault()
                    event.stopPropagation()
                    viewportRef.current?.focus({ preventScroll: true })
                    selectionStart.current = selectionPoint(event)
                    setSelectedIds([])
                    setSelectionBox(null)
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={updateSelection}
                  onPointerUp={event => {
                    updateSelection(event)
                    const start = selectionStart.current
                    const point = selectionPoint(event)
                    if (start && point && Math.hypot(start.x - point.x, start.y - point.y) < 0.005 && !visiblePageBoxes.some(({ box }) => point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height)) {
                      setSelectedIds([])
                      void onClearSelection()
                    }
                    selectionStart.current = null
                    setSelectionBox(null)
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                  }}
                  onPointerCancel={() => { selectionStart.current = null; setSelectionBox(null); setSelectedIds([]) }}
                >
                  {selectionBox && <div className="pointer-events-none absolute border border-blue-600 bg-blue-400/20" style={{ left: `${selectionBox.left * 100}%`, top: `${selectionBox.top * 100}%`, width: `${selectionBox.width * 100}%`, height: `${selectionBox.height * 100}%` }} />}
                </div>
              )}
              {regionMode && regionDrafts.map((item, index) => {
                const box = viewMode === 'split' ? cropBoxToHalf(item.box, half) : item.box
                return box ? <div key={index} className={`pointer-events-none absolute z-30 border-2 ${item.selected ? 'border-blue-600' : 'border-amber-600'}`} style={{ left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}><span className="bg-white text-xs">{index + 1}</span></div> : null
              })}
              {manualMode && (
                <div
                  className="absolute inset-0 z-20 cursor-crosshair"
                  onPointerDown={handleManualStart}
                  onPointerMove={handleManualMove}
                  onPointerUp={handleManualEnd}
                  onPointerCancel={handleManualEnd}
                >
                  {manualBoxes.map((box, index) => {
                    if (index === manualBoxIndex) return null
                    const visible = viewMode === 'split' ? cropBoxToHalf(box, half) : box
                    if (!visible) return null
                    return (
                      <button
                        key={`manual-box:${index}`}
                        type="button"
                        title={`选择第 ${index + 1} 个坐标框`}
                        aria-label={`选择第 ${index + 1} 个坐标框`}
                        onPointerDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          selectManualBox(index)
                        }}
                        className="absolute border-2 border-amber-400 bg-amber-200/10 hover:bg-amber-300/25"
                        style={{ left: `${visible.left * 100}%`, top: `${visible.top * 100}%`, width: `${visible.width * 100}%`, height: `${visible.height * 100}%` }}
                      />
                    )
                  })}
                  {manualBox && (() => {
                    const visible = viewMode === 'split' ? cropBoxToHalf(manualBox, half) : manualBox
                    if (!visible) return null
                    return (
                      <div
                        className="absolute border-2 border-amber-600 bg-amber-300/25 ring-2 ring-white/80"
                        onPointerDown={(event) => startManualAdjustment(event, 'move')}
                        style={{ left: `${visible.left * 100}%`, top: `${visible.top * 100}%`, width: `${visible.width * 100}%`, height: `${visible.height * 100}%`, cursor: 'move' }}
                      >
                        <span className="pointer-events-none absolute -top-6 left-0 rounded bg-amber-700 px-1.5 py-0.5 text-[10px] text-white">
                          框 {manualBoxIndex + 1}
                        </span>
                        {(['nw', 'ne', 'sw', 'se'] as ResizeCorner[]).map((corner) => {
                          const positions: Record<ResizeCorner, string> = {
                            nw: '-left-2 -top-2 cursor-nwse-resize',
                            ne: '-right-2 -top-2 cursor-nesw-resize',
                            sw: '-bottom-2 -left-2 cursor-nesw-resize',
                            se: '-bottom-2 -right-2 cursor-nwse-resize'
                          }
                          return (
                            <button
                              key={corner}
                              type="button"
                              aria-label="调整识别区域大小"
                              onPointerDown={(event) => startManualAdjustment(event, 'resize', corner)}
                              className={`absolute h-4 w-4 rounded-sm border-2 border-amber-800 bg-white shadow ${positions[corner]}`}
                            />
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
            </div>
          </div>
        )}
      </div>

      {pageMappingOpen && <form className="flex flex-none flex-wrap items-center gap-2 border-t bg-white px-3 py-2 text-xs" onSubmit={async event => {
        event.preventDefault()
        if (mappingSaving) return
        const pdfPage = Number(mappingPdfPage), bookPage = Number(mappingBookPage)
        if (!Number.isSafeInteger(pdfPage) || pdfPage < 1 || pdfPage > pageCount || !Number.isSafeInteger(bookPage) || bookPage < 1) {
          setMappingError('请输入有效的 PDF 页码和书页码。')
          return
        }
        setMappingSaving(true)
        setMappingError('')
        try {
          const offset = bookPage - ((pdfPage - 1) * mappingPagesPerPdf + 1)
          await api.updateBookPageMapping(offset, mappingPagesPerPdf, mappingRightFirst)
          setPagesPerPdf(mappingPagesPerPdf)
          setRightFirst(mappingRightFirst)
          onBookPageOffsetChange(offset)
          setPageMappingOpen(false)
        } catch (error) {
          setMappingError(error instanceof Error ? error.message : '保存失败，请重试。')
        } finally { setMappingSaving(false) }
      }}>
        <label className="flex items-center gap-1">PDF 第<input aria-label="对应的 PDF 页码" type="number" min={1} max={pageCount} value={mappingPdfPage} onChange={event => setMappingPdfPage(event.target.value)} className="w-16 rounded border px-2 py-1" />页</label>
        <label className="flex items-center gap-1">对应首个书页第<input aria-label="书中页码" type="number" min={1} value={mappingBookPage} onChange={event => setMappingBookPage(event.target.value)} className="w-16 rounded border px-2 py-1" />页</label>
        <label className="flex items-center gap-1">每张 PDF<select aria-label="每张 PDF 对应书页数" value={mappingPagesPerPdf} onChange={event => setMappingPagesPerPdf(Number(event.target.value))} className="rounded border px-2 py-1"><option value={1}>一页</option><option value={2}>两页</option></select></label>
        {mappingPagesPerPdf === 2 && <select aria-label="书页阅读顺序" value={mappingRightFirst ? "right" : "left"} onChange={event => setMappingRightFirst(event.target.value === "right")} className="rounded border px-2 py-1"><option value="left">左页在前</option><option value="right">右页在前</option></select>}
        <button type="submit" disabled={mappingSaving} className="rounded bg-blue-600 px-2 py-1 text-white disabled:opacity-50">{mappingSaving ? '保存中…' : '保存页码'}</button>
        <button type="button" disabled={mappingSaving} onClick={() => setPageMappingOpen(false)} className="rounded border px-2 py-1">取消</button>
        {mappingError && <span role="alert" className="text-red-700">{mappingError}</span>}
      </form>}

  

      <div className="flex min-h-12 flex-none flex-wrap items-center justify-between gap-2 border-t border-neutral-300 bg-neutral-100 px-3 py-1 text-sm text-neutral-700">
        <div className="flex justify-start">
          <div className="inline-flex overflow-hidden rounded border border-neutral-300 bg-white" aria-label="PDF 阅读模式">
            <button
              type="button"
              aria-pressed={viewMode === 'full'}
              onClick={() => changeViewMode('full')}
              className={`px-3 py-1.5 text-xs ${viewMode === 'full' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-100'}`}
            >
              完整页
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'split'}
              onClick={() => changeViewMode('split')}
              className={`border-l border-neutral-300 px-3 py-1.5 text-xs ${viewMode === 'split' ? 'bg-blue-600 text-white' : 'hover:bg-neutral-100'}`}
            >
              左右单页
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            title="上一页"
            aria-label="上一页"
            onClick={() => move(-1)}
            disabled={viewIndex <= 1}
            className="h-8 w-8 rounded text-base hover:bg-neutral-400/30 disabled:opacity-30"
          >
            ◀
          </button>
          <div className="flex items-center gap-1 tabular-nums">
            <input type="text" inputMode="numeric" aria-label="PDF 页码跳转" aria-invalid={Boolean(pageJumpError)}
              title={pageJumpError || '输入 PDF 页码，按回车跳转'} value={pageJumpValue}
              onChange={event => { setPageJumpValue(event.target.value); setPageJumpError('') }}
              onKeyDown={event => {
                if (event.key === 'Escape') { setPageJumpValue(String(curPage || 1)); setPageJumpError(''); event.currentTarget.blur() }
                if (event.key !== 'Enter') return
                event.preventDefault()
                const page = Number(pageJumpValue)
                if (!Number.isInteger(page) || page < 1 || page > pageCount) { setPageJumpError(`请输入 1-${pageCount} 之间的 PDF 页码`); return }
                setPageJumpError('')
                setTargetPage(page)
                event.currentTarget.blur()
              }}
              disabled={!pageCount} className={`h-8 w-14 rounded border bg-white px-1 text-center ${pageJumpError ? 'border-red-500' : 'border-neutral-300'}`} />
            <span>/ {pageCount}</span>
          </div>
          <button
            type="button"
            title="下一页"
            aria-label="下一页"
            onClick={() => move(1)}
            disabled={viewIndex >= viewCount}
            className="h-8 w-8 rounded text-base hover:bg-neutral-400/30 disabled:opacity-30"
          >
            ▶
          </button>
        </div>

        <div className="flex items-center justify-self-end gap-2 text-xs text-neutral-500">
          <span>{viewMode === "split" ? `${half === "left" ? "左" : "右"} · PDF ${curPage}` : `PDF ${curPage} / ${pageCount}`}{bookPageLabel && ` · ${bookPageLabel}`}</span>
        <button type="button" title="设置书中页码" aria-label="设置书中页码" aria-expanded={pageMappingOpen} className="flex h-7 w-7 flex-none items-center justify-center rounded hover:bg-neutral-200" onClick={() => {
          setMappingPdfPage(String(curPage || 1))
          setMappingBookPage(String(Math.max(1, firstBookPage)))
          setMappingPagesPerPdf(pagesPerPdf)
          setMappingRightFirst(rightFirst)
          setMappingError('')
          setPageMappingOpen(open => !open)
        }}><BookOpen size={14} /></button>
        </div>
        {pageJumpError && <div role="alert" className="col-span-full text-center text-xs text-red-600">{pageJumpError}</div>}
      </div>

    {manualMode && (!manualBox || manualIsDrawing) && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-30 -translate-x-1/2 rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shadow">
          在 PDF 页面上按住并拖动，{manualEditingId === null ? '框选补录区域' : `重画第 ${manualBoxIndex + 1} 个坐标框`}
        </div>
      )}
      {regionMode && manualBox && !manualIsDrawing && !regionPreview && <div className="flex max-h-[30%] flex-none flex-wrap items-center gap-2 overflow-y-auto border-t border-amber-300 bg-white p-3">
        {supplementModes}
        <span className="text-xs">{manualError || manualOcrProgress || (manualRecognizing ? '正在识别分块…' : '区域识别分块')}</span>
        <button type="button" disabled={manualRecognizing} onClick={() => void recognizeRegions(manualBox)} className="rounded border px-2 py-1 text-xs disabled:opacity-40">重新识别</button>
        <button type="button" disabled={manualRecognizing} onClick={() => { setManualBox(null); setManualBoxes([]); setManualError('') }} className="rounded border px-2 py-1 text-xs disabled:opacity-40">重新框选</button>
        {!!regionDrafts.length && <button type="button" onClick={() => setRegionPreview(true)} className="rounded border px-2 py-1 text-xs">查看分块结果</button>}
        <button type="button" onClick={resetManualEditor} className="rounded border px-2 py-1 text-xs">取消</button>
      </div>}
      {regionMode && regionPreview && <section role="dialog" aria-modal="true" aria-label="识别分块预览" className="absolute inset-0 z-50 flex min-h-0 flex-col bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b p-3 text-sm">
          {supplementModes}
          <strong>分块预览 · PDF {curPage}</strong>
          <span>{regionDrafts.filter(item => item.selected).length} / {regionDrafts.length} 段已选</span>
          <button type="button" disabled={manualSaving} onClick={() => setRegionPreview(false)} className="ml-auto rounded border px-2 py-1">查看坐标</button>
          <button type="button" disabled={manualSaving} onClick={resetManualEditor} className="rounded border px-2 py-1">取消</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {regionDrafts.map((item, index) => <div key={index} className="mb-3 rounded border p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1"><input type="checkbox" checked={item.selected} disabled={manualSaving} onChange={event => setRegionDrafts(items => items.map((entry, i) => i === index ? { ...entry, selected: event.target.checked } : entry))} />第 {index + 1} 段</label>
              {item.duplicate && <span className="text-amber-700">疑似重复区域</span>}
              {([-1, 1] as const).map(direction => <button key={direction} type="button" title={direction < 0 ? '上移' : '下移'} aria-label={direction < 0 ? '上移' : '下移'} disabled={manualSaving || index + direction < 0 || index + direction >= regionDrafts.length} className="rounded border px-2 py-1 disabled:opacity-30" onClick={() => setRegionDrafts(items => {
                const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next
              })}>{direction < 0 ? '↑' : '↓'}</button>)}
              <button type="button" disabled={manualSaving || index === regionDrafts.length - 1} className="rounded border px-2 py-1 disabled:opacity-30" onClick={() => setRegionDrafts(items => {
                const next = items[index + 1]
                const left = Math.min(item.box.left, next.box.left), top = Math.min(item.box.top, next.box.top)
                const merged = { ...item, text: `${item.text}\n\n${next.text}`, duplicate: item.duplicate || next.duplicate, box: { left, top, width: Math.max(item.box.left + item.box.width, next.box.left + next.box.width) - left, height: Math.max(item.box.top + item.box.height, next.box.top + next.box.height) - top } }
                return [...items.slice(0, index), merged, ...items.slice(index + 2)]
              })}>合并下一段</button>
              <button type="button" disabled={manualSaving || item.text.split(/\n\s*\n/).filter(text => text.trim()).length < 2} className="rounded border px-2 py-1 disabled:opacity-30" onClick={() => setRegionDrafts(items => {
                const parts = item.text.split(/\n\s*\n/).filter(text => text.trim())
                return [...items.slice(0, index), ...parts.map((text, i) => ({ ...item, text: text.trim(), box: { ...item.box, top: item.box.top + item.box.height * i / parts.length, height: item.box.height / parts.length } })), ...items.slice(index + 1)]
              })}>按空行拆分</button>
            </div>
            <textarea aria-label={`第 ${index + 1} 段原文`} rows={4} disabled={manualSaving} value={item.text} onChange={event => setRegionDrafts(items => items.map((entry, i) => i === index ? { ...entry, text: event.target.value } : entry))} className="w-full resize-y rounded border p-2 text-sm" />
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {(['left', 'top', 'width', 'height'] as const).map((key, k) => <label key={key} className="flex items-center gap-1">{['左', '上', '宽', '高'][k]} %<input type="number" min="0" max="100" step="0.1" disabled={manualSaving} value={Math.round(item.box[key] * 10000) / 100} onChange={event => {
                const value = Math.max(0, Math.min(100, Number(event.target.value))) / 100
                setRegionDrafts(items => items.map((entry, i) => i === index ? { ...entry, box: { ...entry.box, [key]: value } } : entry))
              }} className="w-16 rounded border px-1 py-1" /></label>)}
            </div>
          </div>)}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t p-3 text-sm">
          {manualError && <span role="alert" className="basis-full text-red-700">{manualError}</span>}
          <button type="button" disabled={manualSaving} onClick={() => setRegionDrafts(items => items.map(item => ({ ...item, selected: !item.duplicate })))} className="rounded border px-2 py-1">只选补漏</button>
          <button type="button" disabled={manualSaving || !regionDrafts.some(item => item.selected)} onClick={() => void saveRegions()} className="ml-auto rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40">{manualSaving ? '加入中…' : `加入 ${regionDrafts.filter(item => item.selected).length} 个待译段`}</button>
        </div>
      </section>}
      {manualMode && !regionMode && !manualIsDrawing && (manualBox || manualBoxes.length > 0) && (
        <div aria-label="区域原文编辑" className="flex max-h-[35%] min-h-0 min-w-0 flex-none flex-wrap items-center gap-2 overflow-y-auto overscroll-contain border-t border-amber-300 bg-white px-3 py-2">
          {supplementModes}
          <span className="text-xs font-medium text-neutral-800">{manualEditingId === null ? '补录区域' : '调整识别区域'}</span>
          <span className="text-xs text-neutral-500">拖框内移动，拖四角缩放</span>
          {manualBoxes.length > 1 && (
            <div className="inline-flex overflow-hidden rounded border border-amber-300 bg-white" aria-label="选择要调整的坐标框">
              {manualBoxes.map((_box, index) => (
                <button
                  key={index}
                  type="button"
                  aria-pressed={index === manualBoxIndex}
                  onClick={() => selectManualBox(index)}
                  className={`border-r border-amber-200 px-2 py-1 text-xs last:border-r-0 ${index === manualBoxIndex ? 'bg-amber-600 text-white' : 'hover:bg-amber-50'}`}
                >
                  框 {index + 1}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              manualOperationRef.current += 1
              setManualBox(null)
              setManualRecognizing(false)
              setManualCleaning(false)
              setManualError('')
              setManualRecognitionNote('')
              setManualOcrProgress('')
              setManualTextBeforeClean(null)
            }}
            className="rounded border px-2 py-1 text-xs hover:bg-neutral-50"
          >
            {manualBoxes.length > 1 ? '重画当前框' : '重新框选'}
          </button>
          <button type="button" onClick={() => void recognizeManualBoxes(materializeManualBoxes())} disabled={!manualBox || manualRecognizing || manualCleaning} className="rounded border px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50">
            {manualRecognizing ? '识别中…' : manualCleaning ? 'AI 整理中…' : manualBoxes.length > 1 ? '重新识别全部' : '重新识别'}
          </button>
          <label
            className={`flex items-center gap-1.5 rounded border border-blue-200 px-2 py-1 text-xs text-blue-700 ${manualRecognizing || manualCleaning ? 'opacity-60' : 'cursor-pointer hover:bg-blue-50'}`}
            title="勾选后，每次重新识别都会自动调用 AI 合并意外断行"
          >
            <input
              type="checkbox"
              checked={manualAutoClean}
              disabled={manualRecognizing || manualCleaning}
              onChange={(event) => setManualAutoClean(event.target.checked)}
            />
            <span>{manualCleaning ? 'AI 整理中…' : '识别后 AI 整理断行'}</span>
          </label>
          {manualTextBeforeClean !== null && (
            <button
              type="button"
              onClick={() => {
                setManualText(manualTextBeforeClean)
                setManualTextBeforeClean(null)
                setManualRecognitionNote('已撤销断行整理。')
              }}
              className="rounded border px-2 py-1 text-xs hover:bg-neutral-50"
            >
              撤销整理
            </button>
          )}
          <details ref={originalDetailsRef} open={manualEditingId === null ? true : undefined} className="min-w-0 open:basis-full">
            <summary className={manualEditingId === null ? 'hidden' : 'cursor-pointer rounded border px-2 py-1 text-xs hover:bg-neutral-50'}>修订原文</summary>
            <div className="mt-2 w-full min-w-0 rounded border border-amber-300 bg-white p-2">
              {manualEditingId === null && <div className="mb-2 text-xs text-neutral-600">识别原文（未加入）</div>}
              <textarea
                rows={3}
                value={manualText}
                disabled={manualRecognizing || manualCleaning || manualSaving}
                onChange={(event) => setManualText(event.target.value)}
                placeholder="输入这块区域的英文原文…"
                className="selectable min-h-[72px] max-h-40 w-full resize-y rounded border p-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </div>
          </details>
          {!manualText.trim() && !manualRecognizing && !manualCleaning && <span className="basis-full text-xs text-amber-800">原文为空，尚不能加入。请在原文文本框中粘贴或输入；旋转文字可先旋转 PDF 页面再重新识别。</span>}
          {(manualRecognitionNote || manualOcrProgress || manualError) && (
            <span className={`basis-full text-xs ${manualError ? 'text-red-700' : manualOcrProgress ? 'text-amber-700' : 'text-neutral-500'}`}>
              {manualError || manualOcrProgress || manualRecognitionNote}
            </span>
          )}
          <div aria-label="区域原文操作" className="sticky bottom-0 flex w-full flex-none flex-nowrap justify-end gap-2 bg-white py-1">
            <button type="button" disabled={manualRecognizing || manualCleaning || manualSaving} onClick={() => void pasteManualText()} className="rounded border px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50">从剪贴板粘贴</button>
            <button type="button" onClick={saveManualParagraph} disabled={manualSaving || manualRecognizing || manualCleaning} className="rounded bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-50">
              {manualSaving ? '保存中…' : manualEditingId === null ? '加入待译段' : '保存调整'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
