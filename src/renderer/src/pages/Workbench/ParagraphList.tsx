import { Fragment, memo, useEffect, useRef, useState, type DragEvent, type MutableRefObject } from 'react'
import { Check, ChevronUp, Copy, LoaderCircle, Sparkles, Trash2, TriangleAlert, Ungroup } from 'lucide-react'
import { getMergedParagraphParts } from '@shared/paragraph-structure'
import { api } from '@renderer/lib/ipc'
import type { Paragraph, ParaStatus, VocabularySuggestion } from '@shared/types'
import type { TranslationOption } from '@shared/ipc-api'
import { splitVocabularyText } from '@shared/vocabulary'
import { formatParagraphNumbers, getParagraphSequenceNumbers, nextParagraphInQueue } from '@shared/paragraph-numbering'
import ParagraphNotes from './ParagraphNotes'
import RevisionPanel from './RevisionPanel'

interface CollapsedActions {
  select: (id: number) => void
  dragStart: (event: DragEvent<HTMLButtonElement>, paragraph: Paragraph) => void
  dragOver: (event: DragEvent<HTMLDivElement>, paragraph: Paragraph) => void
  drop: (event: DragEvent<HTMLDivElement>, paragraph: Paragraph) => void
  dragEnd: () => void
}

const CollapsedParagraph = memo(function CollapsedParagraph({ paragraph: p, sequence, bookLabel, dragClass, dragDisabled, filtered, actions }: {
  paragraph: Paragraph; sequence: number; bookLabel: string; dragClass: string; dragDisabled: boolean; filtered: boolean; actions: MutableRefObject<CollapsedActions>
}) {
  return <div onDragOver={event => actions.current.dragOver(event, p)} onDrop={event => actions.current.drop(event, p)} className={`relative ${dragClass}`} style={{ contentVisibility: 'auto', containIntrinsicSize: '40px' }}>
    <button type="button" draggable={!dragDisabled} onDragStart={event => actions.current.dragStart(event, p)} onDragEnd={() => actions.current.dragEnd()} title={filtered ? '仅在查看全部翻译段时可排序' : '拖动颜色条调整本页翻译段顺序'} aria-label={`拖动翻译段 #${p.id} 的状态颜色条调整顺序`} className={`absolute inset-y-0 left-0 z-20 w-3 ${dragDisabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}><span className={`block h-full w-1 rounded-l ${STATUS_HANDLE_COLOR[p.status]}`} /></button>
    <button type="button" onClick={() => actions.current.select(p.id)} className="flex w-full items-center gap-2 rounded bg-white py-2 pl-4 pr-3 text-left text-xs hover:bg-neutral-100">
      <span className="flex-none text-neutral-400">{formatParagraphNumbers(sequence, p.id)}</span><span>{STATUS_ICON[p.status]}</span><span className="text-neutral-500">PDF {p.pageIdx + 1}{bookLabel}</span><span className="flex-1 truncate text-neutral-600">{p.enText.slice(0, 70)}{p.enText.length > 70 ? '...' : ''}</span>
    </button>
  </div>
})

interface Props {
  bookPageOffset: number
  bookPagesPerPdf: number
  paragraphs: Paragraph[]
  currentId: number | null
  originalPreview?: { id: number; text: string } | null
  onPreviewEdit: (text: string) => void
  filterStatus?: ParaStatus
  navigationRevision?: number
  onSelect: (id: number) => void | Promise<void>
  onCollapse: () => Promise<void>
  onCompleteNext: (id: number | null) => void | Promise<void>
  /** 译文/状态变化后回调，触发进度刷新 */
  onTranslated: () => void | Promise<void>
  onSaveReady?: (saveCurrent: () => Promise<void>) => void
  onDeleted: (id: number) => Promise<void>
}

const STATUS_HANDLE_COLOR: Record<ParaStatus, string> = {
  todo: 'bg-para-todo',
  doing: 'bg-para-doing',
  done: 'bg-para-done',
  review: 'bg-para-review'
}

const STATUS_ICON: Record<ParaStatus, string> = {
  todo: '○',
  doing: '✎',
  done: '✓',
  review: '⚠'
}

type OrganizerDropPosition = 'before' | 'after'

const VOCABULARY_SOURCE = {
  glossary: {
    label: '术语表',
    className: 'border-blue-400 text-blue-700 hover:bg-blue-50',
    activeClassName: 'bg-blue-100',
    legendClassName: 'text-blue-700'
  },
  dictionary: {
    label: '离线词典',
    className: 'border-rose-300 text-rose-700 hover:bg-rose-50',
    activeClassName: 'bg-rose-100',
    legendClassName: 'text-rose-700'
  }
} as const

function getVocabularySource(suggestion: VocabularySuggestion) {
  return VOCABULARY_SOURCE[suggestion.source === 'glossary' ? 'glossary' : 'dictionary']
}

/**
 * 段落列表（聚焦模式）：只展开当前段，其余折叠为单行摘要。
 * - 译文编辑后防抖自动保存（600ms）
 * - ⌘↵ 完成→折叠当前段→展开下一段→PDF 同步翻页
 */
export default function ParagraphList({ bookPageOffset, bookPagesPerPdf, paragraphs, currentId, originalPreview, onPreviewEdit, filterStatus, navigationRevision, onSelect, onCollapse, onCompleteNext, onTranslated, onSaveReady, onDeleted }: Props) {
  const bookLabel = (pageIdx: number) => {
    const first = pageIdx * bookPagesPerPdf + 1 + bookPageOffset
    return first > 0 ? ` · 书页 ${first}${bookPagesPerPdf === 2 ? `–${first + 1}` : ''}` : ''
  }
  const currentRef = useRef<HTMLDivElement>(null)
  const organizerScrollRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const originalCleanOperation = useRef(0)
  const originalGeneration = useRef<number | undefined>(undefined)
  const selectedIdRef = useRef(currentId)
  selectedIdRef.current = currentId
  const copyOperation = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef('')
  const draftRef = useRef('')
  const completingRef = useRef(false)
  const [completing, setCompleting] = useState(false)
  const [completionError, setCompletionError] = useState('')
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<string>('')
  const [vocabulary, setVocabulary] = useState<VocabularySuggestion[]>([])
  const [activeVocabulary, setActiveVocabulary] = useState<VocabularySuggestion | null>(null)
  const [referenceOptions, setReferenceOptions] = useState<TranslationOption[]>([])
  const [referenceGenerationId, setReferenceGenerationId] = useState<number | undefined>()
  const [referenceSaving, setReferenceSaving] = useState(false)
  const [adoptedDraft, setAdoptedDraft] = useState<string | null>(null)
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [referenceError, setReferenceError] = useState('')
  const [editingOriginal, setEditingOriginal] = useState(false)
  const [originalDraft, setOriginalDraft] = useState('')
  const [originalSaving, setOriginalSaving] = useState(false)
  const [originalCleaning, setOriginalCleaning] = useState(false)
  const [originalError, setOriginalError] = useState('')
  const [originalNote, setOriginalNote] = useState('')
  const [organizerPage, setOrganizerPage] = useState<number | null>(null)
  const [organizerSelected, setOrganizerSelected] = useState<number[]>([])
  const [structureBusy, setStructureBusy] = useState(false)
  const [structureError, setStructureError] = useState('')
  const [draggingParagraphId, setDraggingParagraphId] = useState<number | null>(null)
  const [organizerDropTarget, setOrganizerDropTarget] = useState<{
    id: number
    position: OrganizerDropPosition
  } | null>(null)
  const [directDraggingId, setDirectDraggingId] = useState<number | null>(null)
  const [directDropTarget, setDirectDropTarget] = useState<{
    id: number
    position: OrganizerDropPosition
  } | null>(null)
  const [directOrderError, setDirectOrderError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (organizerPage === null) return
    const selected = paragraphs.find(paragraph => paragraph.id === currentId)
    if (selected && selected.pageIdx !== organizerPage) {
      setOrganizerPage(selected.pageIdx)
      setOrganizerSelected([])
      setStructureError('')
      return
    }
    const frame = requestAnimationFrame(() => {
      const container = organizerScrollRef.current
      const row = container?.querySelector('[aria-current="true"]')?.parentElement
      if (!container || !row) return
      const viewport = container.getBoundingClientRect(), bounds = row.getBoundingClientRect()
      if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) {
        container.scrollTop += bounds.top - viewport.top - (container.clientHeight - bounds.height) / 2
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [currentId, organizerPage, paragraphs])

  useEffect(() => {
    setCopyState('idle')
    return () => {
      copyOperation.current++
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [currentId])

  const copyOriginal = async (text: string) => {
    const operation = ++copyOperation.current
    if (copyTimer.current) clearTimeout(copyTimer.current)
    setCopyState('copying')
    try {
      if (!navigator.clipboard) throw new Error('剪贴板不可用')
      await navigator.clipboard.writeText(text)
      if (operation !== copyOperation.current) return
      setCopyState('copied')
      copyTimer.current = setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      if (operation === copyOperation.current) setCopyState('failed')
    }
  }

  const deleteCurrentParagraph = async () => {
    if (currentId === null || deleting) return
    if (!window.confirm(`删除翻译段 #${currentId}？该段原文、译文和全部 PDF 坐标框将一并删除，无法撤销。`)) return
    setDeleting(true)
    setDirectOrderError('')
    try {
      await api.deleteParagraph(currentId)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      lastSaved.current = draftRef.current
      setDirty(false)
      setOrganizerSelected((ids) => ids.filter((id) => id !== currentId))
      await onDeleted(currentId)
    } catch (error) {
      setDirectOrderError(error instanceof Error ? error.message : '删除失败，请重试。')
    } finally {
      setDeleting(false)
    }
  }

  const current = paragraphs.find((p) => p.id === currentId) ?? null
  const sequenceNumbers = getParagraphSequenceNumbers(paragraphs)

  useEffect(() => {
    if (draggingParagraphId === null) return
    let frame = 0
    let speed = 0
    let previousTime = 0
    const stop = () => {
      speed = 0
      cancelAnimationFrame(frame)
      frame = 0
      previousTime = 0
    }
    const tick = (time: number) => {
      const container = organizerScrollRef.current
      if (!container || speed === 0) { stop(); return }
      const elapsed = previousTime ? Math.min(32, time - previousTime) : 16
      previousTime = time
      container.scrollTop += speed * elapsed / 1000
      frame = requestAnimationFrame(tick)
    }
    const track = (event: globalThis.DragEvent) => {
      const container = organizerScrollRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const edge = Math.min(48, rect.height / 3)
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top - 12 || event.clientY > rect.bottom + 12) {
        stop()
        return
      }
      const topDistance = event.clientY - rect.top
      const bottomDistance = rect.bottom - event.clientY
      speed = topDistance < edge
        ? -480 * Math.min(1, (edge - topDistance) / edge)
        : bottomDistance < edge ? 480 * Math.min(1, (edge - bottomDistance) / edge) : 0
      if (speed === 0) { stop(); return }
      event.preventDefault()
      if (!frame) frame = requestAnimationFrame(tick)
    }
    document.addEventListener('dragover', track)
    document.addEventListener('drop', stop)
    document.addEventListener('dragend', stop)
    return () => {
      stop()
      document.removeEventListener('dragover', track)
      document.removeEventListener('drop', stop)
      document.removeEventListener('dragend', stop)
    }
  }, [draggingParagraphId])

  // 切换段落时，载入该段译文到本地草稿
  useEffect(() => {
    originalCleanOperation.current += 1
    originalGeneration.current = undefined
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const text = current?.zhText ?? ''
    setDraft(text)
    draftRef.current = text
    lastSaved.current = text
    setDirty(false)
    setCompletionError('')
    setReferenceOptions([])
    setReferenceLoading(false)
    setReferenceGenerationId(undefined)
    setAdoptedDraft(null)
    setReferenceError('')
    setOriginalDraft(current?.enText ?? '')
    setEditingOriginal(false)
    setOriginalCleaning(false)
    setOriginalError('')
    setOriginalNote('')
  }, [currentId, current?.zhText])

  // 坐标重新识别只更新原文，不会改变段号或译文。
  useEffect(() => {
    originalCleanOperation.current += 1
    setOriginalDraft(current?.enText ?? '')
    setEditingOriginal(false)
    setOriginalCleaning(false)
    setOriginalError('')
    setOriginalNote('')
    setReferenceOptions([])
    setReferenceError('')
  }, [currentId, current?.enText])

  // 在“仅看存疑”和“查看全部”之间切换时，当前段 id 不变，但列表会重新排布。
  // 等新列表完成渲染后重新定位，保持当前存疑段展开并露出上下文。
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      currentRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [currentId, filterStatus, navigationRevision])

  useEffect(() => {
    let cancelled = false
    if (!current) {
      setVocabulary([])
      setActiveVocabulary(null)
      return
    }
    api.getVocabularySuggestions(current.id).then((suggestions) => {
      if (cancelled) return
      setVocabulary(suggestions)
      setActiveVocabulary(suggestions[0] ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [current?.id, current?.enText])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    const flushBeforeClose = () => {
      if (currentId === null || draftRef.current === lastSaved.current) return
      api.flushTranslation(currentId, draftRef.current)
      lastSaved.current = draftRef.current
    }
    window.addEventListener('beforeunload', flushBeforeClose)
    return () => window.removeEventListener('beforeunload', flushBeforeClose)
  }, [currentId])

  useEffect(() => {
    onSaveReady?.(async () => {
      if (currentId === null || draftRef.current === lastSaved.current) return
      const textToSave = draftRef.current
      await api.updateTranslation(currentId, textToSave)
      lastSaved.current = textToSave
      setDirty(false)
    })
  }, [currentId, onSaveReady])

  // 草稿变化 → 防抖保存
  useEffect(() => {
    if (!dirty || currentId === null || referenceSaving) return
    if (saveTimer.current) clearTimeout(saveTimer.current)

    saveTimer.current = setTimeout(async () => {
      const textToSave = draftRef.current
      if (textToSave === lastSaved.current) {
        setDirty(false)
        return
      }

      await api.updateTranslation(currentId, textToSave)
      lastSaved.current = textToSave
      const now = new Date()
      setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
      setDirty(draftRef.current !== textToSave)
    }, 600)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [draft, dirty, currentId, referenceSaving])

  /** 完成当前段并跳到下一段 */
  const completeAndNext = async () => {
    if (!current || completingRef.current) return
    const next = nextParagraphInQueue(paragraphs, current.id, filterStatus)
    completingRef.current = true
    setCompleting(true)
    setCompletionError('')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    try {
      const text = draftRef.current
      await api.updateTranslation(current.id, text)
      if (selectedIdRef.current === current.id) {
        lastSaved.current = text
        setDirty(draftRef.current !== text)
      }
      await api.updateStatus(current.id, 'done')
      await onTranslated()
      if (selectedIdRef.current === current.id && (next || filterStatus)) await onCompleteNext(next?.id ?? null)
    } catch (error) {
      if (selectedIdRef.current === current.id) setCompletionError(`完成失败：${String(error)}`)
    } finally {
      completingRef.current = false
      setCompleting(false)
    }
  }

  /** 标记/取消存疑 */
  const toggleReview = async () => {
    if (!current) return
    await api.updateTranslation(current.id, draft)
    const newStatus: ParaStatus = current.status === 'review' ? 'doing' : 'review'
    await api.updateStatus(current.id, newStatus)
    onTranslated()
  }

  const getTranslationReference = async () => {
    if (!current || referenceLoading) return
    if (referenceOptions.length > 0) {
      setReferenceOptions([])
      setAdoptedDraft(null)
      return
    }
    setReferenceLoading(true)
    setReferenceError('')
    const result = await api.getTranslationOptions(current.id)
    if (selectedIdRef.current !== current.id) return
    setReferenceLoading(false)
    if (!result.ok) {
      setReferenceError(result.error ?? '获取翻译参考失败')
      return
    }
    setReferenceOptions(result.translationOptions ?? [])
    setReferenceGenerationId(result.generationId)
  }

  const saveOriginal = async () => {
    if (!current || originalSaving) return
    const text = originalDraft.trim()
    if (!text) {
      setOriginalError('英文原文不能为空。')
      return
    }
    setOriginalSaving(true)
    setOriginalError('')
    try {
      await api.updateOriginalText(current.id, text, originalGeneration.current)
      setEditingOriginal(false)
      setReferenceOptions([])
      onTranslated()
    } catch (error) {
      setOriginalError(error instanceof Error ? error.message : '保存原文失败，请重试。')
    } finally {
      setOriginalSaving(false)
    }
  }

  const cleanOriginalLineBreaks = async () => {
    if (!current || originalCleaning) return
    const previewing = originalPreview?.id === current.id
    const before = previewing ? originalPreview.text : editingOriginal ? originalDraft : current.enText
    if (!before.trim()) return
    const operation = ++originalCleanOperation.current
    if (!editingOriginal) {
      setOriginalDraft(before)
      setEditingOriginal(true)
    }
    setOriginalCleaning(true)
    setOriginalError('')
    setOriginalNote('')
    try {
      const result = await api.cleanOcrLineBreaks(before, current.id)
      if (operation !== originalCleanOperation.current) return
      originalGeneration.current = result.generationId
      if (!result.ok || !result.text) {
        setOriginalError(result.error ?? '整理断行失败，请重试。')
        return
      }
      setOriginalDraft(result.text)
      if (previewing) onPreviewEdit(result.text)
      setEditingOriginal(true)
      setOriginalNote(result.text === before
        ? 'AI 判断这段原文没有需要合并的意外断行。'
        : '已整理意外断行。请确认结果后保存原文。')
    } catch (error) {
      if (operation !== originalCleanOperation.current) return
      setOriginalError(error instanceof Error ? error.message : '整理断行失败，请重试。')
    } finally {
      if (operation === originalCleanOperation.current) setOriginalCleaning(false)
    }
  }

  /** 快捷键：⌘↵ 完成 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        // 只在当前段译文框聚焦时响应
        const active = document.activeElement
        if (active && active.tagName === 'TEXTAREA') {
          e.preventDefault()
          completeAndNext()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [current, draft])

  const organizerParagraphs = organizerPage === null
    ? []
    : paragraphs.filter((paragraph) => paragraph.pageIdx === organizerPage)

  const openOrganizer = () => {
    if (!current) return
    setOrganizerPage(current.pageIdx)
    setOrganizerSelected([])
    setStructureError('')
    setDraggingParagraphId(null)
    setOrganizerDropTarget(null)
  }

  const closeOrganizer = () => {
    if (structureBusy) return
    setOrganizerPage(null)
    setOrganizerSelected([])
    setStructureError('')
    setDraggingParagraphId(null)
    setOrganizerDropTarget(null)
  }

  const saveOrganizerOrder = async (ids: number[]) => {
    if (organizerPage === null || structureBusy) return
    setStructureBusy(true)
    setStructureError('')
    try {
      await api.reorderParagraphs(organizerPage, ids)
      await onTranslated()
    } catch (error) {
      setStructureError(error instanceof Error ? error.message : '调整顺序失败，请重试。')
    } finally {
      setStructureBusy(false)
    }
  }

  const moveOrganizerParagraph = async (id: number, offset: -1 | 1) => {
    const ids = organizerParagraphs.map((paragraph) => paragraph.id)
    const index = ids.indexOf(id)
    const targetIndex = index + offset
    if (index < 0 || targetIndex < 0 || targetIndex >= ids.length) return
    ;[ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]]
    await saveOrganizerOrder(ids)
  }

  const startOrganizerDrag = (event: DragEvent<HTMLButtonElement>, id: number) => {
    if (structureBusy) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(id))
    setDraggingParagraphId(id)
    setOrganizerDropTarget(null)
    setStructureError('')
  }

  const updateOrganizerDropTarget = (event: DragEvent<HTMLDivElement>, id: number) => {
    if (draggingParagraphId === null || draggingParagraphId === id || structureBusy) return
    if (organizerSelected.includes(draggingParagraphId) && organizerSelected.includes(id)) {
      setOrganizerDropTarget(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const position: OrganizerDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setOrganizerDropTarget((current) => (
      current?.id === id && current.position === position ? current : { id, position }
    ))
  }

  const dropOrganizerParagraph = async (event: DragEvent<HTMLDivElement>, targetId: number) => {
    event.preventDefault()
    const draggedId = draggingParagraphId ?? Number(event.dataTransfer.getData('text/plain'))
    const position = organizerDropTarget?.id === targetId ? organizerDropTarget.position : 'before'
    setDraggingParagraphId(null)
    setOrganizerDropTarget(null)
    if (!Number.isInteger(draggedId) || draggedId === targetId || structureBusy) return

    const ids = organizerParagraphs.map((paragraph) => paragraph.id)
    if (!ids.includes(draggedId) || !ids.includes(targetId)) return
    const movingIds = organizerSelected.includes(draggedId)
      ? ids.filter((id) => organizerSelected.includes(id))
      : [draggedId]
    if (movingIds.includes(targetId)) return
    const reordered = ids.filter((id) => !movingIds.includes(id))
    let insertionIndex = reordered.indexOf(targetId)
    if (position === 'after') insertionIndex += 1
    reordered.splice(insertionIndex, 0, ...movingIds)
    if (reordered.every((id, index) => id === ids[index])) return
    await saveOrganizerOrder(reordered)
  }

  const mergeOrganizerParagraphs = async () => {
    if (structureBusy || organizerSelected.length < 2) return
    const selectedIds = organizerParagraphs
      .filter((paragraph) => organizerSelected.includes(paragraph.id))
      .map((paragraph) => paragraph.id)
    const positions = selectedIds.map((id) => organizerParagraphs.findIndex((paragraph) => paragraph.id === id))
    const contiguous = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1)
    if (!contiguous) {
      setStructureError('请选择顺序相邻的翻译段；如有需要，请先拖拽或用上下箭头调整顺序。')
      return
    }
    if (!window.confirm(`将翻译段 ${selectedIds.map((id) => `#${id}`).join('、')} 合并为一个翻译段？原文和现有译文都会保留。`)) return

    setStructureBusy(true)
    setStructureError('')
    try {
      if (current && selectedIds.includes(current.id) && draftRef.current !== lastSaved.current) {
        await api.updateTranslation(current.id, draftRef.current)
        lastSaved.current = draftRef.current
      }
      const merged = await api.mergeParagraphs(selectedIds)
      setOrganizerSelected([])
      await onTranslated()
      onSelect(merged.id)
    } catch (error) {
      setStructureError(error instanceof Error ? error.message : '合并翻译段失败，请重试。')
    } finally {
      setStructureBusy(false)
    }
  }

  const unmergeParagraph = async (paragraph: Paragraph) => {
    if (structureBusy) return
    const parts = getMergedParagraphParts(paragraph.rawBlock)
    if (!parts.length || !window.confirm(`解散翻译段 #${paragraph.id}，恢复合并前的 ${parts.length} 个翻译段及其原文、译文、状态和坐标框？合并后的修改保留在修订记录中。`)) return
    setStructureBusy(true)
    setStructureError('')
    setDirectOrderError('')
    try {
      if (current?.id === paragraph.id && draftRef.current !== lastSaved.current) {
        await api.updateTranslation(paragraph.id, draftRef.current)
        lastSaved.current = draftRef.current
      }
      const restored = await api.unmergeParagraph(paragraph.id)
      setOrganizerSelected([])
      await onTranslated()
      await onSelect(restored[0].id)
    } catch (error) {
      const message = error instanceof Error ? error.message : '解散合并失败，请重试。'
      if (organizerPage === null) setDirectOrderError(message)
      else setStructureError(message)
    } finally { setStructureBusy(false) }
  }

  const startDirectDrag = (event: DragEvent<HTMLButtonElement>, paragraph: Paragraph) => {
    if (filterStatus || structureBusy) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(paragraph.id))
    setDirectDraggingId(paragraph.id)
    setDirectDropTarget(null)
    setDirectOrderError('')
  }

  const updateDirectDropTarget = (event: DragEvent<HTMLDivElement>, target: Paragraph) => {
    if (directDraggingId === null || filterStatus || structureBusy) return
    if (directDraggingId === target.id) {
      setDirectDropTarget(null)
      return
    }
    const source = paragraphs.find((paragraph) => paragraph.id === directDraggingId)
    if (!source || source.pageIdx !== target.pageIdx) {
      setDirectDropTarget(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const position: OrganizerDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDirectDropTarget((current) => (
      current?.id === target.id && current.position === position ? current : { id: target.id, position }
    ))
  }

  const dropDirectParagraph = async (event: DragEvent<HTMLDivElement>, target: Paragraph) => {
    event.preventDefault()
    const draggedId = directDraggingId ?? Number(event.dataTransfer.getData('text/plain'))
    const position = directDropTarget?.id === target.id ? directDropTarget.position : 'before'
    setDirectDraggingId(null)
    setDirectDropTarget(null)
    if (!Number.isInteger(draggedId) || draggedId === target.id || filterStatus || structureBusy) return

    const source = paragraphs.find((paragraph) => paragraph.id === draggedId)
    if (!source || source.pageIdx !== target.pageIdx) return
    const pageIds = paragraphs
      .filter((paragraph) => paragraph.pageIdx === source.pageIdx)
      .map((paragraph) => paragraph.id)
    const reordered = pageIds.filter((id) => id !== draggedId)
    let insertionIndex = reordered.indexOf(target.id)
    if (insertionIndex < 0) return
    if (position === 'after') insertionIndex += 1
    reordered.splice(insertionIndex, 0, draggedId)
    if (reordered.every((id, index) => id === pageIds[index])) return

    setStructureBusy(true)
    setDirectOrderError('')
    try {
      await api.reorderParagraphs(source.pageIdx, reordered)
      await onTranslated()
    } catch (error) {
      setDirectOrderError(error instanceof Error ? error.message : '调整顺序失败，请重试。')
    } finally {
      setStructureBusy(false)
    }
  }

  const directDragHandle = (paragraph: Paragraph) => (
    <button
      type="button"
      draggable={!filterStatus && !structureBusy}
      onDragStart={(event) => startDirectDrag(event, paragraph)}
      onDragEnd={() => {
        setDirectDraggingId(null)
        setDirectDropTarget(null)
      }}
      title={filterStatus ? '仅在查看全部翻译段时可排序' : '拖动颜色条调整本页翻译段顺序'}
      aria-label={`拖动翻译段 #${paragraph.id} 的状态颜色条调整顺序`}
      className={`absolute inset-y-0 left-0 z-20 w-3 ${filterStatus || structureBusy ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
    >
      <span className={`block h-full w-1 rounded-l ${STATUS_HANDLE_COLOR[paragraph.status]}`} />
    </button>
  )

  const collapsedActions = useRef<CollapsedActions>(null!)
  collapsedActions.current = {
    select: onSelect, dragStart: startDirectDrag, dragOver: updateDirectDropTarget,
    drop: (event, paragraph) => { void dropDirectParagraph(event, paragraph) },
    dragEnd: () => { setDirectDraggingId(null); setDirectDropTarget(null) }
  }
  const displayedParagraphs = filterStatus ? paragraphs.filter((paragraph) => paragraph.status === filterStatus) : paragraphs
  const directTargetIndex = directDropTarget ? displayedParagraphs.findIndex(p => p.id === directDropTarget.id) : -1
  const directInsertionIndex = directTargetIndex < 0 ? -1 : directTargetIndex + (directDropTarget?.position === 'after' ? 1 : 0)
  const organizerTargetIndex = organizerDropTarget ? organizerParagraphs.findIndex(p => p.id === organizerDropTarget.id) : -1
  const organizerInsertionIndex = organizerTargetIndex < 0 ? -1 : organizerTargetIndex + (organizerDropTarget?.position === 'after' ? 1 : 0)

  if (displayedParagraphs.length === 0) {
    return <div className="p-8 text-center text-sm text-neutral-400">{filterStatus === 'review' ? '暂无存疑段落' : filterStatus === 'todo' ? '暂无待译段落' : filterStatus === 'doing' ? '暂无待审段落' : '暂无段落'}</div>
  }

  return (
    <div className="space-y-1 p-2">
      {savedAt && (
        <div className="px-2 pb-1 text-right text-[10px] text-neutral-400">
          已保存于 {savedAt}
        </div>
      )}
      {directOrderError && (
        <div className="px-2 pb-1 text-xs text-red-700">{directOrderError}</div>
      )}
      {organizerPage !== null && (
        <section className="sticky top-0 z-20 mb-2 border-y border-blue-200 bg-blue-50 px-3 py-2 shadow-sm">
          <div className="flex items-center gap-2">
            <strong className="text-sm text-neutral-800">第{organizerPage + 1}页 · 翻译段排序与合并</strong>
            <span className="text-xs text-neutral-500">拖动手柄调整顺序，勾选相邻段后合并</span>
            <button
              type="button"
              onClick={closeOrganizer}
              className="ml-auto rounded px-2 py-1 text-xs hover:bg-blue-100"
            >
              收起
            </button>
          </div>
          <div ref={organizerScrollRef} className="mt-2 max-h-64 overflow-y-auto overscroll-contain border-y border-blue-100 bg-white">
            {organizerParagraphs.map((paragraph, index) => {
              const dropTarget = organizerInsertionIndex === index ? 'before'
                : organizerInsertionIndex === organizerParagraphs.length && index === organizerParagraphs.length - 1 ? 'after' : null
              return (
              <div
                key={paragraph.id}
                onDragOver={(event) => updateOrganizerDropTarget(event, paragraph.id)}
                onDrop={(event) => void dropOrganizerParagraph(event, paragraph.id)}
                className={`relative flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0 ${draggingParagraphId === paragraph.id ? 'bg-blue-50 opacity-50' : 'border-neutral-100'} ${dropTarget === 'before' ? 'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-blue-600' : ''} ${dropTarget === 'after' ? 'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-blue-600' : ''}`}
              >
                <button
                  type="button"
                  draggable={!structureBusy}
                  onDragStart={(event) => startOrganizerDrag(event, paragraph.id)}
                  onDragEnd={() => {
                    setDraggingParagraphId(null)
                    setOrganizerDropTarget(null)
                  }}
                  title="拖动调整顺序"
                  aria-label={`拖动翻译段 #${paragraph.id} 调整顺序`}
                  className="h-7 w-6 shrink-0 cursor-grab rounded text-base leading-none text-neutral-400 hover:bg-neutral-100 hover:text-blue-700 active:cursor-grabbing"
                >
                  ⠿
                </button>
                <input
                  type="checkbox"
                  checked={organizerSelected.includes(paragraph.id)}
                  onChange={() => {
                    setStructureError('')
                    setOrganizerSelected((selected) => selected.includes(paragraph.id)
                      ? selected.filter((id) => id !== paragraph.id)
                      : [...selected, paragraph.id])
                  }}
                  aria-label={`选择翻译段 #${paragraph.id}`}
                />
                <button
                  type="button"
                  onClick={() => onSelect(paragraph.id)}
                  aria-current={paragraph.id === currentId ? 'true' : undefined}
                  className={`min-w-0 flex-1 truncate text-left text-xs hover:text-blue-700 ${paragraph.id === currentId ? 'font-medium text-blue-600' : 'text-neutral-700'}`}
                  title={paragraph.enText}
                >
                  <span className={`mr-2 font-medium ${paragraph.id === currentId ? 'text-blue-600' : 'text-neutral-500'}`}>{formatParagraphNumbers(sequenceNumbers.get(paragraph.id)!, paragraph.id)}</span>
                  {paragraph.enText || '（空原文）'}
                </button>
                {getMergedParagraphParts(paragraph.rawBlock).length > 0 && <button type="button" disabled={structureBusy} onClick={() => void unmergeParagraph(paragraph)} title="解散合并，恢复原翻译段" aria-label={`解散翻译段 #${paragraph.id} 的合并`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-white text-neutral-600 hover:text-blue-700 disabled:opacity-30"><Ungroup size={14} /></button>}
                <button
                  type="button"
                  onClick={() => void moveOrganizerParagraph(paragraph.id, -1)}
                  disabled={structureBusy || index === 0}
                  title="上移"
                  aria-label={`上移翻译段 #${paragraph.id}`}
                  className="h-7 w-7 rounded border bg-white text-sm hover:bg-neutral-50 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => void moveOrganizerParagraph(paragraph.id, 1)}
                  disabled={structureBusy || index === organizerParagraphs.length - 1}
                  title="下移"
                  aria-label={`下移翻译段 #${paragraph.id}`}
                  className="h-7 w-7 rounded border bg-white text-sm hover:bg-neutral-50 disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
              )
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOrganizerSelected([])
                setOrganizerDropTarget(null)
                setStructureError('')
              }}
              disabled={structureBusy || organizerSelected.length === 0}
              className="rounded border bg-white px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-40"
            >
              取消选择
            </button>
            <button
              type="button"
              onClick={() => void mergeOrganizerParagraphs()}
              disabled={structureBusy || organizerSelected.length < 2}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {structureBusy ? '处理中…' : `合并所选（${organizerSelected.length}）`}
            </button>
            <span className="text-[11px] text-neutral-500">合并后保留最前一段的段号，并联动所有原坐标框。</span>
          </div>
          {structureError && <div className="mt-2 text-xs text-red-700">{structureError}</div>}
        </section>
      )}
      {displayedParagraphs.map((p, index) => {
        const previous = displayedParagraphs[index - 1]
        const pageSeparator = !filterStatus && previous && previous.pageIdx !== p.pageIdx ? (
          <div className="flex items-center gap-3 px-1 py-2 text-[11px] text-neutral-500">
            <span className="h-px flex-1 bg-neutral-300" />
            <span>PDF 第 {previous.pageIdx + 1} 页结束{bookLabel(previous.pageIdx)}</span>
            <span className="h-px flex-1 bg-neutral-300" />
          </div>
        ) : null
        const isCurrent = p.id === currentId
        const directDrop = directInsertionIndex === index ? 'before'
          : directInsertionIndex === displayedParagraphs.length && index === displayedParagraphs.length - 1 ? 'after' : null
        const directDragClass = `${directDraggingId === p.id ? 'opacity-50' : ''} ${directDrop === 'before' ? 'before:absolute before:inset-x-0 before:-top-0.5 before:z-30 before:h-0.5 before:bg-blue-600' : ''} ${directDrop === 'after' ? 'after:absolute after:inset-x-0 after:-bottom-0.5 after:z-30 after:h-0.5 after:bg-blue-600' : ''}`

        if (isCurrent) {
          const previewingOriginal = originalPreview?.id === p.id
          const displayedOriginal = previewingOriginal ? originalPreview.text : p.enText
          const originalParts = splitVocabularyText(displayedOriginal, vocabulary)
          return (
            <Fragment key={p.id}>
              {pageSeparator}
            <div
              key={p.id}
              ref={currentRef}
              onDragOver={(event) => updateDirectDropTarget(event, p)}
              onDrop={(event) => void dropDirectParagraph(event, p)}
              className={`relative rounded bg-white py-3 pl-4 pr-3 shadow-sm ${directDragClass}`}
            >
              {directDragHandle(p)}
              <div
                role="button"
                tabIndex={0}
                aria-label="收起翻译段"
                aria-expanded={true}
                onClick={() => void onCollapse()}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void onCollapse()
                  }
                }}
                className="mb-1 flex flex-wrap cursor-pointer items-center gap-2 text-xs text-neutral-500"
              >
                <span>{formatParagraphNumbers(sequenceNumbers.get(p.id)!, p.id)}</span>
                <span>[{p.type}]</span>
                <span>PDF {p.pageIdx + 1}{bookLabel(p.pageIdx)}</span>
                <span>{STATUS_ICON[p.status]}</span>
                {previewingOriginal && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">坐标调整预览 · 尚未保存</span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                  {getMergedParagraphParts(p.rawBlock).length > 0 && <button type="button" disabled={structureBusy} onClick={() => void unmergeParagraph(p)} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"><Ungroup size={12} />解散合并</button>}
                  <button
                    type="button"
                    onClick={openOrganizer}
                    title="调整当前 PDF 页的翻译段顺序，或合并相邻段落"
                    className="rounded border border-blue-200 px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-50"
                  >
                    排序与合并
                  </button>
                  {!editingOriginal && (
                    <button
                      type="button"
                      onClick={() => {
                        setOriginalDraft(displayedOriginal)
                        setOriginalError('')
                        setOriginalNote('')
                        setEditingOriginal(true)
                      }}
                      className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] hover:bg-neutral-100"
                    >
                      编辑原文
                    </button>
                  )}
                  <button type="button" onClick={() => void cleanOriginalLineBreaks()} disabled={originalCleaning || originalSaving} className="inline-flex items-center gap-1 rounded border border-blue-200 px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                    {originalCleaning ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} />}{originalCleaning ? 'AI 整理中…' : 'AI 整理断行'}
                  </button>
                </div>
              </div>
              {editingOriginal ? (
                <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-2">
                  <textarea
                    autoFocus
                    rows={4}
                    value={previewingOriginal ? displayedOriginal : originalDraft}
                    onChange={(event) => previewingOriginal ? onPreviewEdit(event.target.value) : setOriginalDraft(event.target.value)}
                    className="selectable w-full resize-y rounded border border-neutral-300 bg-white p-2 text-sm leading-relaxed focus:border-amber-500 focus:outline-none"
                    aria-label="英文原文"
                  />
                  {originalError && <div className="mt-1 text-xs text-red-700">{originalError}</div>}
                  {originalNote && <div className="mt-1 text-xs text-blue-700">{originalNote}</div>}
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        originalCleanOperation.current++
                        setOriginalCleaning(false)
                        setOriginalDraft(p.enText)
                        setOriginalError('')
                        setOriginalNote('')
                        setEditingOriginal(false)
                      }}
                      className="rounded border bg-white px-2 py-1 text-xs hover:bg-neutral-50"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={previewingOriginal ? () => setEditingOriginal(false) : saveOriginal}
                      disabled={originalSaving || originalCleaning}
                      className="rounded bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {previewingOriginal ? '完成编辑（待保存调整）' : originalSaving ? '保存中…' : '保存原文'}
                    </button>
                  </div>
                </div>
              ) : (
                <div data-ai-selection-paragraph={p.id} className="selectable mb-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">
                  {originalParts.map((part, index) => {
                    if (part.suggestionIndex === undefined) return <span key={index}>{part.text}</span>
                    const suggestion = vocabulary[part.suggestionIndex]
                    const active = suggestion === activeVocabulary
                    const source = getVocabularySource(suggestion)
                    const multipleSources = new Set(vocabulary.filter((item) => (item.matchedText || item.en).toLowerCase() === (suggestion.matchedText || suggestion.en).toLowerCase()).map((item) => item.source)).size > 1
                    return (
                      <button
                        type="button"
                        key={index}
                        title={suggestion.note || suggestion.zh}
                        onClick={() => setActiveVocabulary(suggestion)}
                        className={`inline border-b px-0.5 font-medium transition-colors ${multipleSources ? 'border-neutral-500 text-neutral-800 hover:bg-neutral-100' : source.className} ${active ? multipleSources ? 'bg-neutral-200' : source.activeClassName : ''}`}
                      >
                        {part.text}
                      </button>
                    )
                  })}
                </div>
              )}
              {!editingOriginal && vocabulary.length > 0 && (
                <div className="mb-1 flex flex-wrap justify-end gap-x-3 gap-y-1 text-[10px]">
                  {[VOCABULARY_SOURCE.glossary, VOCABULARY_SOURCE.dictionary].map((source) => (
                    <span key={source.label} className={source.legendClassName}>
                      <span className="mr-1 border-b border-current">Aa</span>{source.label}
                    </span>
                  ))}
                </div>
              )}
              {!editingOriginal && activeVocabulary && (
                <div className="mb-3 min-h-10 space-y-2 border-y border-neutral-200 bg-neutral-50 px-2 py-2 text-xs">
                  <span className="text-[10px] text-neutral-400">词汇</span>
                  <span className="text-sm font-medium text-neutral-800">{activeVocabulary.matchedText || activeVocabulary.en}</span>
                  {activeVocabulary.phonetic && (
                    <span className="font-mono text-[11px] text-neutral-400">/{activeVocabulary.phonetic}/</span>
                  )}
                  {vocabulary.filter((item) => (item.matchedText || item.en).toLowerCase() === (activeVocabulary.matchedText || activeVocabulary.en).toLowerCase()).map((item, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <span className={`w-16 shrink-0 ${getVocabularySource(item).legendClassName}`}>{getVocabularySource(item).label}</span>
                      <span className="selectable whitespace-pre-wrap break-words text-sm text-neutral-700">{item.source === 'dictionary' ? item.note || item.zh : item.zh}</span>
                    </div>
                  ))}
                </div>
              )}
              <hr className="my-2 border-dashed border-neutral-200" />
              <textarea
                disabled={referenceSaving || completing}
                className="selectable h-40 min-h-[160px] w-full resize-y rounded border border-neutral-300 p-3 text-sm leading-relaxed focus:border-para-doing focus:outline-none"
                placeholder="在此输入中文译文..."
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setDirty(true)
                }}
              />
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <button
                  onClick={completeAndNext}
                  disabled={completing}
                  title="完成并下一段（⌘↵）"
                  className="inline-flex items-center gap-1.5 rounded bg-emerald-700 px-2 py-1 text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <Check size={14} aria-hidden="true" />完成并下一段
                </button>
                <button
                  type="button"
                  onClick={getTranslationReference}
                  disabled={referenceLoading}
                  aria-expanded={referenceOptions.length > 0}
                  className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 disabled:opacity-50 ${referenceOptions.length > 0
                    ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                    : 'border-blue-300 text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  {referenceLoading ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : referenceOptions.length > 0 ? <ChevronUp size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                  {referenceLoading ? 'AI 生成中...' : referenceOptions.length > 0 ? '收起译文参考' : '生成译文参考'}
                </button>
                <button
                  onClick={toggleReview}
                  aria-pressed={current?.status === 'review'}
                  className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 ${current?.status === 'review' ? 'border-orange-700 bg-orange-700 text-white hover:bg-orange-800' : 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100'}`}
                >
                  <TriangleAlert size={14} aria-hidden="true" />
                  {current?.status === 'review' ? '取消存疑' : '标为存疑'}
                </button>
                <button
                  type="button"
                  onClick={() => void copyOriginal(p.enText)}
                  disabled={copyState === 'copying'}
                  title={copyState === 'failed' ? '复制失败，点击重试' : '复制这段外文原文'}
                  aria-live="polite"
                  className={`inline-flex min-w-[112px] items-center justify-center gap-1.5 rounded border px-2 py-1 disabled:opacity-50 ${copyState === 'copied' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : copyState === 'failed' ? 'border-red-300 bg-red-50 text-red-700' : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'}`}
                >
                  {copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copyState === 'copied' ? '已复制原文' : copyState === 'copying' ? '复制中…' : copyState === 'failed' ? '重试复制' : '复制原文'}
                </button>
                <button type="button" onClick={() => void deleteCurrentParagraph()} disabled={deleting || referenceLoading || originalSaving || originalCleaning || originalPreview?.id === p.id} className="ml-auto inline-flex items-center gap-1.5 rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-40">
                  <Trash2 size={14} aria-hidden="true" />
                  {deleting ? '删除中…' : '删除翻译段'}
                </button>
              </div>
              {completionError && <p role="alert" className="selectable mt-2 text-xs text-red-700">{completionError}</p>}
              <ParagraphNotes key={p.id} id={p.id} />
              <RevisionPanel key={`revision-${p.id}`} paragraphId={p.id} onBeforeRestore={async () => {
                if (saveTimer.current) clearTimeout(saveTimer.current)
                if (draftRef.current !== lastSaved.current) {
                  await api.updateTranslation(p.id, draftRef.current)
                  lastSaved.current = draftRef.current
                  setDirty(false)
                }
              }} onChanged={onTranslated} />
              {referenceError && <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{referenceError}</div>}
              {referenceOptions.length > 0 && (
                <div className="mt-2 rounded border border-blue-200 bg-blue-50 p-2">
                  <div className="mb-1 flex items-center justify-between text-xs text-blue-800">
                    <span>AI 翻译参考 · 选择一版采用</span>
                  </div>
                  {referenceOptions.some((option) => /(?:…|\.\.\.)\s*$/.test(option.text)) && (
                    <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                      候选译文以省略号结束。模型收到的英文原文可能不完整，请先检查并修订原文后重新生成。
                    </div>
                  )}
                  <div className="space-y-2">
                    {referenceOptions.map((option, index) => (
                      <div key={`${option.label}-${index}`} className="rounded border border-blue-100 bg-white p-2">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <span className="text-xs font-medium text-blue-800">{option.label}</span>
                          <button
                            type="button"
                            disabled={referenceSaving || referenceGenerationId === undefined}
                            onClick={async () => {
                              if (referenceGenerationId === undefined || referenceSaving) return
                              const previous = draftRef.current
                              setReferenceSaving(true)
                              if (saveTimer.current) clearTimeout(saveTimer.current)
                              try {
                                await api.updateTranslation(p.id, previous)
                                const adopted = await api.adoptTranslationCandidate({ paragraphId: p.id, generationId: referenceGenerationId, candidateIndex: index, expectedDraft: previous })
                                if (selectedIdRef.current !== p.id) return
                                setAdoptedDraft(previous)
                                setDraft(adopted)
                                draftRef.current = adopted
                                lastSaved.current = adopted
                                setDirty(false)
                              } catch (error) { if (selectedIdRef.current === p.id) setReferenceError(String(error)) }
                              finally { setReferenceSaving(false) }
                            }}
                            className="shrink-0 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            采用此译文
                          </button>
                        </div>
                        <p className="selectable whitespace-pre-wrap text-xs leading-relaxed text-neutral-700">{option.text}</p>
                      </div>
                    ))}
                  </div>
                  {adoptedDraft !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(adoptedDraft)
                        setDirty(true)
                        setAdoptedDraft(null)
                      }}
                      className="mt-2 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                    >
                      撤销刚才采用
                    </button>
                  )}
                </div>
              )}
            </div>
            </Fragment>
          )
        }

        return (
          <Fragment key={p.id}>
            {pageSeparator}
          <CollapsedParagraph paragraph={p} sequence={sequenceNumbers.get(p.id)!} bookLabel={bookLabel(p.pageIdx)} dragClass={directDragClass} dragDisabled={!!filterStatus || structureBusy} filtered={!!filterStatus} actions={collapsedActions} />
          </Fragment>
        )
      })}
    </div>
  )
}
