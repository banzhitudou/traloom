import { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { api, REVISION_CHANGED } from '@renderer/lib/ipc'
import type { GlossaryEntry, GlossaryImpact, GlossaryInput, Paragraph, VocabularySuggestion } from '@shared/types'
import { checkGlossaryConsistency, glossaryCategoryOptions, isGlossaryAccepted, type GlossaryAcceptance, type GlossaryConsistencyMatch } from '@shared/glossary-check'
import { formatParagraphNumbers } from '@shared/paragraph-numbering'
import { formatBookPageLabel } from '@shared/book-page-label'
import GlossaryAuditPanel from './GlossaryAuditPanel'
import ParagraphStatusBadge from './ParagraphStatusBadge'
import GlossaryReplacementControls, { HighlightedTerm } from './GlossaryReplacementControls'
import { replaceOldTranslations, suggestOldTranslations } from '@shared/glossary-presentation'

interface Props {
  onSelectParagraph?: (id: number) => void
  onProjectChanged?: () => void
}

type SourceTab = 'project' | 'dictionary'

const EMPTY_INPUT: GlossaryInput = { en: '', zh: '', category: '其他', note: '' }
const SOURCE_TABS: { id: SourceTab; label: string }[] = [
  { id: 'project', label: '项目术语' },
  { id: 'dictionary', label: '离线词典' }
]

export default function GlossaryPanel({ onSelectParagraph, onProjectChanged }: Props) {
  const [source, setSource] = useState<SourceTab>('project')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [entries, setEntries] = useState<GlossaryEntry[]>([])
  const [onlyNonstandard, setOnlyNonstandard] = useState(false)
  const [termOccurrences, setTermOccurrences] = useState<Record<number, number>>({})
  const [bookMapping, setBookMapping] = useState<{ offset: number; pages: number } | null>(null)
  const bookLabel = (pageIdx: number) => bookMapping ? formatBookPageLabel(pageIdx, bookMapping.offset, bookMapping.pages) : ''
  const [termCounts, setTermCounts] = useState<Record<number, { inconsistent: number; untranslated: number }> | null>(null)
  const [countsError, setCountsError] = useState(false)
  const countsRequest = useRef(0)
  const [dictionaryResult, setDictionaryResult] = useState<VocabularySuggestion | null>(null)
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deletingTerm, setDeletingTerm] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<GlossaryInput>(EMPTY_INPUT)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [impactChangeId, setImpactChangeId] = useState<number | null>(null)
  const [impacts, setImpacts] = useState<GlossaryImpact[]>([])
  const impactScope = useRef<{ root: number; replacements: number[] } | null>(null)
  const [checkingId, setCheckingId] = useState<number | null>(null)
  const [consistencyEntry, setConsistencyEntry] = useState<GlossaryEntry | null>(null)
  const [consistencyMatches, setConsistencyMatches] = useState<GlossaryConsistencyMatch[]>([])
  const [acceptances, setAcceptances] = useState<GlossaryAcceptance[]>([])
  const [onlyInconsistent, setOnlyInconsistent] = useState(false)
  const [oldTranslation, setOldTranslation] = useState('')
  const [oldSuggestions, setOldSuggestions] = useState<{ text: string; count: number }[]>([])
  const [selectedOldTranslations, setSelectedOldTranslations] = useState<string[]>([])
  const replacementNames = [...new Set([...selectedOldTranslations, oldTranslation.trim()].filter(Boolean))]
  const [applyingConsistency, setApplyingConsistency] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [editFromAudit, setEditFromAudit] = useState(false)
  const categoryOptions = glossaryCategoryOptions(categories)
  const impactApproved = (impact: GlossaryImpact) => isGlossaryAccepted({ id: impact.paragraphId, enText: impact.enText, zhText: impact.zhText }, { en: impact.newEn, zh: impact.newZh }, acceptances)
  const impactUsesStandard = (impact: GlossaryImpact) => checkGlossaryConsistency([
    { id: impact.paragraphId, enText: impact.enText, zhText: impact.zhText } as Paragraph
  ], { en: impact.newEn, zh: impact.newZh })[0]?.state === 'standard'

  const checkTerm = async (entry: GlossaryEntry, onlyPending = false) => {
    if (checkingId !== null) return
    setCheckingId(entry.id)
    setError('')
    try {
      const paragraphs = await api.listParagraphs()
      const approved = await api.listGlossaryAcceptances()
      setAcceptances(approved)
      const matches = checkGlossaryConsistency(paragraphs, entry, approved, await api.listGlossary({}))
      const suggestions = suggestOldTranslations(matches.filter(match => match.state === 'check').map(match => match.paragraph), entry, await api.listGlossaryOldTranslations(entry.id))
      setConsistencyMatches(matches)
      setConsistencyEntry(entry)
      setOnlyInconsistent(onlyPending)
      setOldSuggestions(suggestions)
      setSelectedOldTranslations(suggestions.length === 1 ? [suggestions[0].text] : [])
      setOldTranslation('')
      setMessage('')
    } catch (error) {
      setError(error instanceof Error ? error.message : '全文检查失败')
    } finally {
      setCheckingId(null)
    }
  }

  const loadCategories = useCallback(async () => {
    setCategories(await api.listGlossaryCategories())
  }, [])

  const refreshTermCounts = useCallback(async () => {
    const request = ++countsRequest.current
    try {
      const [report, meta] = await Promise.all([api.auditGlossary(), api.getProjectMeta()])
      if (request !== countsRequest.current) return
      const counts: Record<number, { inconsistent: number; untranslated: number }> = {}
      for (const group of report.groups) {
        counts[group.entry.id] = {
          inconsistent: group.matches.filter(match => match.state === 'check').length,
          untranslated: group.matches.filter(match => match.state === 'untranslated').length
        }
      }
      setTermCounts(counts)
      setTermOccurrences(report.termOccurrences)
      const offset = Number(meta.book_page_offset ?? 0)
      setBookMapping(meta.book_page_offset !== undefined && Number.isSafeInteger(offset) ? { offset, pages: meta.book_pages_per_pdf === '2' ? 2 : 1 } : null)
      setCountsError(false)
    } catch {
      if (request === countsRequest.current) { setTermCounts(null); setCountsError(true) }
    }
  }, [])

  useEffect(() => {
    if (source !== 'project' || consistencyEntry || impactChangeId !== null || showForm || auditOpen) return
    void refreshTermCounts()
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refreshTermCounts(), 350)
    }
    window.addEventListener(REVISION_CHANGED, changed)
    return () => {
      clearTimeout(timer)
      countsRequest.current++
      window.removeEventListener(REVISION_CHANGED, changed)
    }
  }, [source, consistencyEntry, impactChangeId, showForm, auditOpen, refreshTermCounts])

  const selectOldTranslation = (element: HTMLElement) => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode ||
        !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return
    const selected = selection.toString().trim()
    if (!selected) return
    setOldTranslation(selected)
    setError('')
  }

  const loadProjectTerms = useCallback(async (nextQuery = query, nextCategory = category) => {
    setLoading(true)
    setEntries(await api.listGlossary({ query: nextQuery, category: nextCategory }))
    setLoading(false)
  }, [query, category])

  useEffect(() => {
    void loadCategories()
    void loadProjectTerms('', '')
  }, [loadCategories])

  const selectSource = (next: SourceTab) => {
    setSource(next)
    setQuery('')
    setDictionaryResult(null)
    setMessage('')
    setError('')
    setImpactChangeId(null)
    if (next === 'project') void loadProjectTerms('', category)
  }

  const search = async () => {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      if (source === 'project') {
        await loadProjectTerms()
      } else if (!query.trim()) {
        setDictionaryResult(null)
      } else {
        setDictionaryResult(await api.searchOfflineDictionary(query))
      }
    } finally {
      setLoading(false)
    }
  }

  const openCreate = (preset?: Partial<GlossaryInput>) => {
    setEditFromAudit(false)
    setEditingId(null)
    setForm({ ...EMPTY_INPUT, ...preset })
    setShowForm(true)
    setImpactChangeId(null)
    setError('')
  }

  const openEdit = (entry: GlossaryEntry, fromAudit = false) => {
    setEditFromAudit(fromAudit)
    setConsistencyEntry(null)
    setAuditOpen(false)
    setSource('project')
    setEditingId(entry.id)
    setForm({ en: entry.en, zh: entry.zh, category: entry.category, note: entry.note })
    setShowForm(true)
    setImpactChangeId(null)
    setMessage('')
    setError('')
  }

  const loadImpacts = async (changeId: number, appendReplacement = false) => {
    if (appendReplacement && impactScope.current) {
      if (changeId !== impactScope.current.root && !impactScope.current.replacements.includes(changeId)) impactScope.current.replacements.push(changeId)
    } else if (impactScope.current?.root !== changeId) {
      impactScope.current = { root: changeId, replacements: [] }
    }
    const scope = impactScope.current!
    setImpactChangeId(scope.root)
    let next = await api.getGlossaryImpacts(scope.root)
    for (const replacementId of scope.replacements) {
      const replacements = await api.getGlossaryImpacts(replacementId)
      next = next.map(impact => {
        const replacement = replacements.find(row => row.paragraphId === impact.paragraphId)
        return replacement && (replacement.reviewStatus !== 'pending' || !impact.canUndo) ? replacement : impact
      })
      next.push(...replacements.filter(row => !next.some(impact => impact.paragraphId === row.paragraphId)))
    }
    const approved = await api.listGlossaryAcceptances()
    setAcceptances(approved)
    next = next.map(impact => ({ ...impact, reviewStatus: isGlossaryAccepted({ id: impact.paragraphId, enText: impact.enText, zhText: impact.zhText }, { en: impact.newEn, zh: impact.newZh }, approved) ? 'kept' : impact.reviewStatus === 'kept' ? 'pending' : impact.reviewStatus }))
    setImpacts(next)
    if (!appendReplacement) {
      const first = next[0]
      const entries = first ? await api.listGlossary({ query: first.newEn }) : []
      const entry = entries.find(item => item.en === first.newEn && item.zh === first.newZh)
      const history = entry ? await api.listGlossaryOldTranslations(entry.id) : []
      const suggestions = first ? suggestOldTranslations(next, { en: first.newEn, zh: first.newZh }, [...history, first.oldZh]) : []
      setOldSuggestions(suggestions)
      setSelectedOldTranslations(suggestions.length === 1 ? [suggestions[0].text] : [])
      setOldTranslation('')
    }
  }

  const save = async () => {
    setError('')
    const result = editingId === null
      ? await api.createGlossary(form)
      : await api.updateGlossary(editingId, form)
    if (!result.ok) {
      setError(result.error ?? '保存失败')
      return
    }
    setShowForm(false)
    setEditingId(null)
    setMessage(result.impactCount
      ? `术语已保存，全文发现 ${result.impactCount} 处需要确认。`
      : '术语已保存。')
    await Promise.all([loadProjectTerms(), loadCategories()])
    onProjectChanged?.()
    if (editFromAudit) {
      setEditFromAudit(false)
      setAuditOpen(true)
    } else if (result.changeId && result.impactCount) await loadImpacts(result.changeId)
  }

  const remove = async (entry: GlossaryEntry) => {
    if (deletingTerm) return
    if (!window.confirm(`确定删除术语“${entry.en} → ${entry.zh}”吗？`)) return
    setDeletingTerm(true)
    setError('')
    try {
      const result = await api.deleteGlossary(entry.id)
      if (!result.ok) {
        setError(result.error ?? '删除失败')
        return
      }
      if (editingId === entry.id) {
        setShowForm(false)
        setEditingId(null)
        setForm(EMPTY_INPUT)
        if (editFromAudit) { setEditFromAudit(false); setAuditOpen(true) }
      }
      setMessage('术语已删除，原有译文不会自动修改。')
      await Promise.all([loadProjectTerms(), loadCategories()])
      onProjectChanged?.()
    } catch (error) {
      setError(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeletingTerm(false)
    }
  }

  const removeEditingTerm = async () => {
    if (editingId === null || deletingTerm) return
    try {
      const entry = (await api.listGlossary({})).find(item => item.id === editingId)
      if (!entry) { setError('术语已不存在，请返回术语表。'); return }
      await remove(entry)
    } catch (error) { setError(error instanceof Error ? error.message : '读取术语失败') }
  }

  const undoImpact = async (impact: GlossaryImpact) => {
    const result = await api.undoGlossaryImpact(impact.id)
    if (!result.ok) {
      setError(result.error ?? '撤销失败')
      return
    }
    await loadImpacts(impactChangeId ?? impact.changeId)
    onProjectChanged?.()
  }

  const acceptTranslation = async (accepted: boolean, paragraph: { id: number; enText: string; zhText: string }, impact?: GlossaryImpact) => {
    if (applyingConsistency) return
    setApplyingConsistency(true)
    setError('')
    try {
      const entry = consistencyEntry ?? (await api.listGlossary({ query: impact?.newEn })).find(item => item.en === impact?.newEn && item.zh === impact?.newZh)
      if (!entry) throw new Error('术语已变化，请重新检查。')
      const result = await api.setGlossaryAcceptance({ entry, paragraph, accepted })
      if (!result.ok) throw new Error(result.error ?? '处理失败')
      const approved = await api.listGlossaryAcceptances()
      setAcceptances(approved)
      if (consistencyEntry) setConsistencyMatches(checkGlossaryConsistency(await api.listParagraphs(), consistencyEntry, approved, await api.listGlossary({})))
      if (impactChangeId !== null) await loadImpacts(impactChangeId)
      setMessage(accepted ? (impact && impactUsesStandard(impact) ? '已确认无须修改，待确认提示已消除。译文和翻译段状态未修改。' : '已认可此处译名，译文和翻译段状态未修改。') : '已取消认可，此处将重新参与术语检查。')
      onProjectChanged?.()
    } catch (error) { setError(error instanceof Error ? error.message : '处理失败') }
    finally { setApplyingConsistency(false) }
  }

  const confirmAllImpacts = async () => {
    if (applyingConsistency || impactChangeId === null) return
    const pending = impacts.filter(impact => impact.reviewStatus === 'pending' && impact.zhText.trim())
    if (!pending.length || !window.confirm(`确认当前术语的 ${pending.length} 处译文均无需修改？将保留现有译名并消除待确认提示，不修改译文或段落状态。尚无译文的段落不参与确认。`)) return
    setApplyingConsistency(true)
    setError('')
    try {
      const first = pending[0]
      const entry = (await api.listGlossary({ query: first.newEn })).find(item => item.en === first.newEn && item.zh === first.newZh)
      if (!entry || pending.some(impact => impact.newEn !== entry.en || impact.newZh !== entry.zh)) throw new Error('术语已变化，请重新检查。')
      const result = await api.setGlossaryAcceptances({ entry, paragraphs: pending.map(impact => ({ id: impact.paragraphId, enText: impact.enText, zhText: impact.zhText })), accepted: true })
      if (!result.ok) throw new Error(result.error ?? '确认失败')
      await loadImpacts(impactChangeId)
      setMessage(`已确认 ${result.count} 处无需修改，译文和翻译段状态未修改。`)
      onProjectChanged?.()
    } catch (error) { setError(error instanceof Error ? error.message : '确认失败') }
    finally { setApplyingConsistency(false) }
  }

  const applyImpactAction = async (action: 'replace' | 'review' | 'doing', selected?: GlossaryImpact) => {
    if (impactChangeId === null) return
    if (applyingConsistency) return
    const names = replacementNames.length ? replacementNames : selected ? suggestOldTranslations([selected], { en: selected.newEn, zh: selected.newZh }, [selected.oldZh]).map(item => item.text) : []
    if (action === 'replace' && !names.length) {
      setError('请选择旧译名备选，或输入实际译文中的旧译名。')
      document.getElementById('impact-old-translation')?.focus()
      return
    }
    const rows = (selected ? [selected] : impacts.filter(impact => impact.reviewStatus === 'pending'))
      .filter(impact => action !== 'replace' || (!impactApproved(impact) && replaceOldTranslations(impact.zhText, names, impact.newZh) !== impact.zhText))
    if (!rows.length) { setError('当前译文没有找到指定的旧译名，请检查输入。'); return }
    const description = action === 'replace' ? `将 ${names.length} 个旧译名（${names.join('、')}）替换为“${rows[0].newZh}”，并标为待审` : action === 'review' ? '标为存疑' : '标为待审'
    if (!window.confirm(`对 ${rows.length} 个翻译段${description}？`)) return
    setApplyingConsistency(true)
    setError('')
    try {
      const entries = await api.listGlossary({ query: rows[0].newEn })
      const entry = entries.find(item => item.en === rows[0].newEn && item.zh === rows[0].newZh)
      if (!entry) { setError('术语已发生变化，请返回术语表重新检查。'); return }
      const paragraphs = rows.map(impact => ({ id: impact.paragraphId, enText: impact.enText, zhText: impact.zhText, status: impact.paragraphStatus }))
      const result = await api.applyGlossaryAudit({ action, requests: action === 'replace'
        ? names.filter(name => name !== entry.zh).map(oldZh => ({ entry, oldZh, paragraphs: paragraphs.filter(paragraph => replaceOldTranslations(paragraph.zhText, [oldZh], entry.zh) !== paragraph.zhText) })).filter(request => request.paragraphs.length)
        : [{ entry, paragraphs }] })
      if (!result.ok) { setError(result.error ?? '处理失败'); return }
      setMessage(`已处理 ${result.count} 个翻译段。`)
      if (action === 'review') {
        for (const impact of rows) await api.resolveGlossaryImpact(impact.id, 'review')
      }
      for (const change of result.changes ?? []) await loadImpacts(change.changeId, true)
      await loadImpacts(impactChangeId, true)
      onProjectChanged?.()
    } catch (error) {
      setError(error instanceof Error ? error.message : '处理失败')
    } finally {
      setApplyingConsistency(false)
    }
  }

  const applyConsistency = async (action: 'replace' | 'review' | 'doing', paragraphId?: number) => {
    if (!consistencyEntry || applyingConsistency) return
    const displayed = consistencyMatches.filter(match => paragraphId !== undefined ? match.paragraph.id === paragraphId : !onlyInconsistent || match.state === 'check')
    const single = paragraphId !== undefined ? displayed[0] : undefined
    const names = replacementNames.length ? replacementNames : single?.currentTranslations ?? []
    const targets = action === 'replace' ? displayed.filter(match => match.state !== 'accepted' && replaceOldTranslations(match.paragraph.zhText, names, consistencyEntry.zh) !== match.paragraph.zhText) : displayed
    if (!targets.length) return
    const description = action === 'replace' ? `将 ${names.length} 个旧译名（${names.join('、')}）替换为“${consistencyEntry.zh}”，并标为待审` : action === 'review' ? '标为存疑' : '标为待审'
    if (!window.confirm(`对当前列表中的 ${targets.length} 个翻译段${description}？`)) return
    setApplyingConsistency(true)
    setError('')
    try {
      const entry = consistencyEntry
      const paragraphs = targets.map(({ paragraph }) => ({ id: paragraph.id, enText: paragraph.enText, zhText: paragraph.zhText, status: paragraph.status }))
      const result = await api.applyGlossaryAudit({ action, requests: action === 'replace'
        ? names.filter(name => name !== entry.zh).map(oldZh => ({ entry, oldZh, paragraphs: paragraphs.filter(paragraph => replaceOldTranslations(paragraph.zhText, [oldZh], entry.zh) !== paragraph.zhText) })).filter(request => request.paragraphs.length)
        : [{ entry, paragraphs }] })
      if (!result.ok) { setError(result.error ?? '批量处理失败'); return }
      setMessage(`已处理 ${result.count} 个翻译段。`)
      const refreshed = await api.listParagraphs()
      setConsistencyMatches(checkGlossaryConsistency(refreshed, consistencyEntry, await api.listGlossaryAcceptances(), await api.listGlossary({})))
      onProjectChanged?.()
      if (result.changes?.length) {
        await loadImpacts(result.changes[0].changeId)
        for (const change of result.changes.slice(1)) await loadImpacts(change.changeId, true)
        setConsistencyEntry(null)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '批量处理失败')
    } finally {
      setApplyingConsistency(false)
    }
  }

  if (consistencyEntry) {
    const counts = { standard: 0, check: 0, untranslated: 0, accepted: 0 }
    consistencyMatches.forEach(match => { counts[match.state] += 1 })
    const displayed = onlyInconsistent ? consistencyMatches.filter(match => match.state === 'check') : consistencyMatches
    const suggestions = suggestOldTranslations(displayed.filter(match => match.state === 'check').map(match => match.paragraph), consistencyEntry, oldSuggestions.map(item => item.text))
    const replacementCount = displayed.filter(match => match.state !== 'accepted' && replaceOldTranslations(match.paragraph.zhText, replacementNames, consistencyEntry.zh) !== match.paragraph.zhText).length
    return <div className="min-h-full">
      <header className="sticky -top-3 z-10 -mx-3 -mt-3 border-b bg-white px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setConsistencyEntry(null)} title="返回术语表" aria-label="返回术语表" className="h-8 w-8 flex-none rounded hover:bg-neutral-100">←</button>
          <strong className="min-w-0 break-words text-sm">{consistencyEntry.en} → {consistencyEntry.zh}</strong>
          <button type="button" disabled={applyingConsistency || checkingId !== null} onClick={() => openEdit(consistencyEntry)} title="编辑当前术语的标准译名、分类和备注" className="flex flex-none items-center gap-1 rounded border px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-40"><Pencil size={13} />编辑术语</button>
          <button type="button" disabled={checkingId !== null} onClick={() => void checkTerm(consistencyEntry)} className="ml-auto flex-none rounded border px-2 py-1 text-xs">{checkingId !== null ? '检查中…' : '重新检查'}</button>
        </div>
        <div className="mt-2 text-xs text-neutral-500">共 {consistencyMatches.length} 段 · 含标准译名 {counts.standard} · 此处已认可 {counts.accepted} · 待确认 {counts.check} · 未译 {counts.untranslated}</div>
        <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyInconsistent} onChange={event => setOnlyInconsistent(event.target.checked)} />仅看待确认</label>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span>当前列表 {displayed.length} 段</span>
          <button type="button" disabled={applyingConsistency || !displayed.length} onClick={() => void applyConsistency('review')} className="rounded border px-2 py-1 text-amber-700 disabled:opacity-35">全部标为存疑</button>
          <button type="button" disabled={applyingConsistency || !displayed.length} onClick={() => void applyConsistency('doing')} className="rounded border px-2 py-1 text-blue-700 disabled:opacity-35">全部标为待审</button>
        </div>
        <div className="mt-2">
          <GlossaryReplacementControls suggestions={suggestions} selected={selectedOldTranslations} onSelect={setSelectedOldTranslations} custom={oldTranslation} onCustom={setOldTranslation} disabled={applyingConsistency} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={applyingConsistency || !replacementCount} onClick={() => void applyConsistency('replace')} className="flex-none rounded bg-blue-600 px-3 py-1.5 text-xs text-white disabled:opacity-35">全部替换（{replacementCount} 段）</button>
          </div>
        </div>
      </header>
      {error && <p role="alert" className="my-2 text-xs text-red-700">{error}</p>}
      {message && <p role="status" className="my-2 text-xs text-emerald-700">{message}</p>}
      <div className="divide-y">{displayed.map(({ paragraph, sequence, state, currentTranslations }) => <section key={paragraph.id} className="py-3" style={{ contentVisibility: 'auto', containIntrinsicSize: '240px' }}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => onSelectParagraph?.(paragraph.id)} className="text-blue-600 hover:underline">{formatParagraphNumbers(sequence, paragraph.id)} · PDF {paragraph.pageIdx + 1}{bookLabel(paragraph.pageIdx)}</button>
          <span className={state === 'standard' || state === 'accepted' ? 'text-emerald-700' : state === 'check' ? 'text-amber-700' : 'text-neutral-500'}>{state === 'standard' ? '已采用标准译名' : state === 'accepted' ? '已认可此处译名' : state === 'check' ? '译文未采用标准译名' : '尚无译文'}</span>
        </div>
        <p className="selectable mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-600"><HighlightedTerm text={paragraph.enText} terms={[consistencyEntry.en]} source /></p>
        <p onMouseUp={event => selectOldTranslation(event.currentTarget)} onKeyUp={event => { if (event.key === 'Shift') selectOldTranslation(event.currentTarget) }} className="selectable mt-2 whitespace-pre-wrap break-words bg-neutral-50 p-2 text-xs leading-relaxed"><HighlightedTerm text={paragraph.zhText || '（尚无译文）'} terms={[consistencyEntry.zh, ...(state === 'accepted' ? currentTranslations : [])]} warnings={state === 'accepted' ? [] : [...oldSuggestions.map(item => item.text), ...replacementNames, ...currentTranslations].filter(name => name !== consistencyEntry.zh)} /></p>
        {state !== 'accepted' && currentTranslations.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
          <span>识别到当前译名：</span>
          {currentTranslations.map(current => <label key={current} className="flex items-center gap-1"><input type="checkbox" checked={selectedOldTranslations.includes(current)} disabled={applyingConsistency} onChange={event => setSelectedOldTranslations(names => event.target.checked ? [...new Set([...names, current])] : names.filter(name => name !== current))} />{current}</label>)}
        </div>}
        {state !== 'accepted' && replaceOldTranslations(paragraph.zhText, replacementNames, consistencyEntry.zh) !== paragraph.zhText && <div className="mt-2 border-l-2 border-blue-500 bg-blue-50 p-2 text-xs">
          <span className="text-blue-700">替换预览</span>
          <p className="selectable mt-1 whitespace-pre-wrap break-words leading-relaxed"><HighlightedTerm text={replaceOldTranslations(paragraph.zhText, replacementNames, consistencyEntry.zh)} terms={[consistencyEntry.zh]} /></p>
        </div>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <ParagraphStatusBadge status={paragraph.status} />
          <button type="button" disabled={applyingConsistency || state === 'accepted' || replaceOldTranslations(paragraph.zhText, replacementNames.length ? replacementNames : currentTranslations, consistencyEntry.zh) === paragraph.zhText} onClick={() => void applyConsistency('replace', paragraph.id)} className="rounded border px-2 py-1 text-blue-700 disabled:opacity-35">替换此处</button>
          {(state === 'check' || state === 'accepted') && <button type="button" disabled={applyingConsistency} onClick={() => void acceptTranslation(state !== 'accepted', paragraph)} className="rounded border px-2 py-1 text-emerald-700 disabled:opacity-35">{state === 'accepted' ? '取消认可' : '认可此处译名'}</button>}
          <button type="button" disabled={applyingConsistency} onClick={() => void applyConsistency('review', paragraph.id)} className="rounded border px-2 py-1 text-amber-700 disabled:opacity-35">标为存疑</button>
          <button type="button" disabled={applyingConsistency} onClick={() => void applyConsistency('doing', paragraph.id)} className="rounded border px-2 py-1 text-blue-700 disabled:opacity-35">标为待审</button>
        </div>
      </section>)}</div>
      {!displayed.length && <p className="py-10 text-center text-xs text-neutral-400">{onlyInconsistent ? '没有待确认的译文' : '全文没有找到对应外文术语'}</p>}
    </div>
  }

  if (impactChangeId !== null) {
    const pending = impacts.filter((impact) => impact.reviewStatus === 'pending').length
    const safe = impacts.filter(impact => impact.reviewStatus === 'pending' && replaceOldTranslations(impact.zhText, replacementNames, impact.newZh) !== impact.zhText).length
    const suggestions = impacts[0] ? suggestOldTranslations(impacts.filter(impact => impact.reviewStatus === 'pending'), { en: impacts[0].newEn, zh: impacts[0].newZh }, oldSuggestions.map(item => item.text)) : []
    return (
      <div className="min-h-full">
        <div className="sticky -top-3 z-10 -mx-3 -mt-3 border-b bg-white px-3 py-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setImpactChangeId(null)} className="h-8 w-8 rounded hover:bg-neutral-100" title="返回术语表">←</button>
            <div>
              <div className="text-sm font-medium text-neutral-800">术语变更影响</div>
              <div className="text-[11px] text-neutral-400">共 {impacts.length} 处 · 待确认 {pending} 处</div>
            </div>
          </div>
          <div className="mt-2 break-words text-xs text-neutral-600">{impacts[0]?.newEn} → <strong>{impacts[0]?.newZh}</strong></div>
          <GlossaryReplacementControls suggestions={suggestions} selected={selectedOldTranslations} onSelect={setSelectedOldTranslations} custom={oldTranslation} onCustom={setOldTranslation} disabled={applyingConsistency} />
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <button type="button" disabled={safe === 0 || applyingConsistency} onClick={() => void applyImpactAction('replace')} className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-35">全部替换（{safe} 段）</button>
            <button type="button" disabled={applyingConsistency || !impacts.some(impact => impact.reviewStatus === 'pending' && impact.zhText.trim())} onClick={() => void confirmAllImpacts()} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700 hover:bg-emerald-100 disabled:opacity-35">全部确认无需修改</button>
            <button type="button" disabled={applyingConsistency || !pending} onClick={() => void applyImpactAction('review')} className="rounded border px-2 py-1 text-amber-700 disabled:opacity-35">全部标为存疑</button>
            <button type="button" disabled={applyingConsistency || !pending} onClick={() => void applyImpactAction('doing')} className="rounded border px-2 py-1 text-blue-700 disabled:opacity-35">全部标为待审</button>
          </div>
        </div>

        {error && <div className="my-2 border-l-2 border-red-500 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
        {message && <div className="my-2 border-l-2 border-emerald-500 bg-emerald-50 p-2 text-xs text-emerald-700">{message}</div>}

        <div className="divide-y">
          {impacts.map((impact) => (
            <div key={impact.id} className="py-3" style={{ contentVisibility: 'auto', containIntrinsicSize: '240px' }}>
              <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                <button type="button" onClick={() => onSelectParagraph?.(impact.paragraphId)} className="text-blue-600 hover:underline">
                  第 {impact.pageIdx + 1} 页 · 段 #{impact.paragraphId}{bookLabel(impact.pageIdx)}
                </button>
                <span className={`ml-auto ${impactApproved(impact) || impactUsesStandard(impact) ? 'text-emerald-700' : ''}`}>{impactApproved(impact) ? (impactUsesStandard(impact) ? '已确认无须修改' : '已认可此处译名') : impact.reviewStatus === 'pending' ? (impactUsesStandard(impact) ? '已采用标准译名，待确认' : '待确认') : impact.reviewStatus === 'replaced' ? '已替换' : impact.reviewStatus === 'kept' ? '已保留' : '已标疑'}</span>
              </div>
              <p className="selectable mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-600"><HighlightedTerm text={impact.enText} terms={[impact.oldEn, impact.newEn]} source /></p>
              <p onMouseUp={event => selectOldTranslation(event.currentTarget)} onKeyUp={event => { if (event.key === 'Shift') selectOldTranslation(event.currentTarget) }} className="selectable mt-1 whitespace-pre-wrap break-words bg-neutral-50 p-2 text-xs leading-relaxed text-neutral-800"><HighlightedTerm text={impact.zhText || '（尚无译文）'} terms={[impact.newZh, ...(impactApproved(impact) ? oldSuggestions.map(item => item.text) : [])]} warnings={impactApproved(impact) ? [] : [...oldSuggestions.map(item => item.text), ...replacementNames].filter(name => name !== impact.newZh)} /></p>
              {!impactApproved(impact) && replaceOldTranslations(impact.zhText, replacementNames, impact.newZh) !== impact.zhText && <div className="mt-2 border-l-2 border-blue-500 bg-blue-50 p-2 text-xs">
                <span className="text-blue-700">替换预览</span>
                <p className="selectable mt-1 whitespace-pre-wrap break-words leading-relaxed"><HighlightedTerm text={replaceOldTranslations(impact.zhText, replacementNames, impact.newZh)} terms={[impact.newZh]} /></p>
              </div>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <ParagraphStatusBadge status={impact.paragraphStatus} />
                {impactApproved(impact) && <button type="button" disabled={applyingConsistency} onClick={() => void acceptTranslation(false, { id: impact.paragraphId, enText: impact.enText, zhText: impact.zhText }, impact)} className="rounded border px-2 py-1 text-[11px] text-emerald-700 disabled:opacity-35">取消认可</button>}
                {impact.reviewStatus === 'pending' && (
                  <>
                    {!impactUsesStandard(impact) && <button type="button" disabled={applyingConsistency || replaceOldTranslations(impact.zhText, replacementNames, impact.newZh) === impact.zhText} onClick={() => void applyImpactAction('replace', impact)} className="rounded border px-2 py-1 text-[11px] hover:bg-blue-50 disabled:opacity-35">替换此处</button>}
                    <button type="button" disabled={applyingConsistency || !impact.zhText.trim()} onClick={() => void acceptTranslation(true, { id: impact.paragraphId, enText: impact.enText, zhText: impact.zhText }, impact)} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-100 disabled:opacity-35">{impactUsesStandard(impact) ? '确认无须修改' : '认可此处译名'}</button>
                    <button type="button" disabled={applyingConsistency} onClick={() => void applyImpactAction('review', impact)} className="rounded border px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-50">标为存疑</button>
                    <button type="button" disabled={applyingConsistency} onClick={() => void applyImpactAction('doing', impact)} className="rounded border px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50">标为待审</button>
                  </>
                )}
                {impact.canUndo && (
                  <button type="button" onClick={() => undoImpact(impact)} className="rounded border px-2 py-1 text-[11px] hover:bg-neutral-50">撤销替换</button>
                )}
              </div>
            </div>
          ))}
          {impacts.length === 0 && <p className="py-10 text-center text-xs text-neutral-400">全文没有找到对应外文术语</p>}
        </div>
      </div>
    )
  }


  if (auditOpen) return <GlossaryAuditPanel
    bookLabel={bookLabel}
    onClose={() => setAuditOpen(false)}
    onOpenTerm={entry => void checkTerm(entry)}
    onEditTerm={entry => openEdit(entry, true)}
    onOpenImpacts={changeId => void loadImpacts(changeId)}
    onSelectParagraph={onSelectParagraph}
    onProjectChanged={onProjectChanged}
  />

  return (
    <div className="min-h-full">
      <div className="grid grid-cols-4 border-b">
        {SOURCE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectSource(tab.id)}
            className={`border-b-2 px-1 py-2 text-xs ${source === tab.id ? 'border-blue-600 font-medium text-blue-600' : 'border-transparent text-neutral-500 hover:bg-neutral-50'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void search() }}
          placeholder={source === 'project' ? '筛选外文、中文或备注' : source === 'dictionary' ? '输入要查询的英文' : '输入要查询的外文'}
          className="min-w-0 flex-1 rounded border px-2 py-1.5 text-xs"
        />
        <button type="button" onClick={search} className="rounded border px-3 py-1.5 text-xs hover:bg-neutral-50">搜索</button>
        {source === 'project' && (
          <button type="button" onClick={() => openCreate()} title="新增项目术语" className="h-8 w-8 rounded bg-blue-600 text-lg text-white hover:bg-blue-700">+</button>
        )}
      </div>

      {source === 'project' && (
        <select
          value={category}
          onChange={(event) => {
            const next = event.target.value
            setCategory(next)
            void loadProjectTerms(query, next)
          }}
          className="mt-2 w-full rounded border bg-white px-2 py-1.5 text-xs"
        >
          <option value="">全部分类</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      )}

      {source === 'project' && <button type="button" disabled={loading || checkingId !== null} onClick={() => { setAuditOpen(true); setError(''); setMessage('') }} className="mt-3 w-full rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 disabled:opacity-35">全书术语一致性检查</button>}

      {error && <div className="mt-2 border-l-2 border-red-500 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      {message && <div className="mt-2 border-l-2 border-emerald-500 bg-emerald-50 p-2 text-xs text-emerald-700">{message}</div>}

      {showForm && (
        <div className="mt-3 border-y bg-neutral-50 py-3">
          <div className="mb-2 text-xs font-medium text-neutral-700">{editingId === null ? '新增项目术语' : '编辑项目术语'}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-neutral-500">外文术语
              <input value={form.en} onChange={(event) => setForm((current) => ({ ...current, en: event.target.value }))} className="mt-1 w-full rounded border bg-white px-2 py-1.5 text-xs text-neutral-800" />
            </label>
            <label className="text-[11px] text-neutral-500">中文译名
              <input value={form.zh} onChange={(event) => setForm((current) => ({ ...current, zh: event.target.value }))} className="mt-1 w-full rounded border bg-white px-2 py-1.5 text-xs text-neutral-800" />
            </label>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-neutral-500">分类
              <input aria-label="分类" value={form.category} placeholder="输入分类" onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className="mt-1 w-full rounded border bg-white px-2 py-1.5 text-xs text-neutral-800" />
            </label>
            <label className="block text-[11px] text-neutral-500">选择分类
              <select aria-label="选择分类" value={categoryOptions.includes(form.category) ? form.category : ''} onChange={event => { if (event.target.value) setForm(current => ({ ...current, category: event.target.value })) }} className="mt-1 w-full rounded border bg-white px-2 py-1.5 text-xs text-neutral-800">
                <option value="">自定义分类</option>
                {categoryOptions.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-2 block text-[11px] text-neutral-500">备注
            <textarea rows={2} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} className="mt-1 w-full resize-none rounded border bg-white px-2 py-1.5 text-xs text-neutral-800" />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            {editingId !== null && <button type="button" disabled={deletingTerm} onClick={() => void removeEditingTerm()} className="mr-auto flex items-center gap-1 rounded border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"><Trash2 size={13} />{deletingTerm ? '删除中…' : '删除术语'}</button>}
            <button type="button" disabled={deletingTerm} onClick={() => { setShowForm(false); if (editFromAudit) { setEditFromAudit(false); setAuditOpen(true) } }} className="rounded border px-3 py-1.5 text-xs hover:bg-white disabled:opacity-40">取消</button>
            <button type="button" disabled={deletingTerm} onClick={save} className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-40">保存</button>
          </div>
        </div>
      )}

      {source === 'project' ? (
        <div className="mt-3">
          <label className="mb-2 flex items-center gap-2 text-xs text-neutral-700"><input type="checkbox" checked={onlyNonstandard} onChange={event => setOnlyNonstandard(event.target.checked)} />只看未采用标准译名</label>
          <div className="mb-1 text-[11px] text-neutral-400">{loading ? '载入中...' : `当前显示 ${entries.filter(entry => !onlyNonstandard || !!termCounts?.[entry.id]?.inconsistent).length} 条`}</div>
          <div className="divide-y">
            {entries.filter(entry => !onlyNonstandard || !!termCounts?.[entry.id]?.inconsistent).map((entry) => (
              <div key={entry.id} className="group py-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm"><span className="font-medium text-neutral-800">{entry.en}</span><span className="mx-2 text-neutral-300">→</span><span>{entry.zh}</span></div>
                    <div className="mt-1 text-[10px] text-neutral-400">{entry.category}{entry.note ? ` · ${entry.note}` : ''}</div>
                  </div>
                  <button type="button" onClick={() => openEdit(entry)} title="编辑术语" className="h-7 w-7 rounded text-neutral-400 hover:bg-neutral-100 hover:text-blue-600">✎</button>
                  <button type="button" onClick={() => remove(entry)} title="删除术语" className="h-7 w-7 rounded text-neutral-400 hover:bg-red-50 hover:text-red-600">×</button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <button type="button" disabled={checkingId !== null} onClick={() => void checkTerm(entry)} className="rounded border px-2 py-1 text-blue-700 hover:bg-blue-50 disabled:opacity-40">{checkingId === entry.id ? '检查中…' : '检查全书'}</button>
                  {termCounts ? <>
                    <span className="text-neutral-500">全书出现 {termOccurrences[entry.id] ?? 0} 次</span>
                    <button type="button" disabled={checkingId !== null || !(termCounts[entry.id]?.inconsistent)} onClick={() => void checkTerm(entry, true)} className={`rounded px-2 py-1 ${termCounts[entry.id]?.inconsistent ? 'bg-orange-50 text-orange-700 hover:bg-orange-100' : 'text-neutral-500'} disabled:cursor-default`}>
                      未采用标准译名 {termCounts[entry.id]?.inconsistent ?? 0} 段
                    </button>
                    {!!termCounts[entry.id]?.untranslated && <span className="text-neutral-500">尚无译文 {termCounts[entry.id].untranslated} 段</span>}
                  </> : <span className="text-neutral-400">{countsError ? '数量统计失败' : '正在统计…'}</span>}
                </div>
              </div>
            ))}
            {!loading && (!onlyNonstandard ? entries.length === 0 : termCounts && !entries.some(entry => !!termCounts[entry.id]?.inconsistent)) && <p className="py-10 text-center text-xs text-neutral-400">没有符合条件的项目术语</p>}
          </div>
        </div>
      ) : (
        <div className="mt-3">
          {dictionaryResult ? (
            <div className="border-y py-3">
              <div className="text-sm font-medium">{dictionaryResult.matchedText || dictionaryResult.en}</div>
              <div className="mt-1 text-sm text-neutral-700">{dictionaryResult.zh}</div>
              {dictionaryResult.phonetic && <div className="mt-1 font-mono text-[11px] text-neutral-400">/{dictionaryResult.phonetic}/</div>}
              <p className="mt-2 text-xs leading-relaxed text-neutral-500">{dictionaryResult.note}</p>
              <button type="button" onClick={() => openCreate({ en: dictionaryResult.en, zh: dictionaryResult.zh, note: '来自离线词典' })} className="mt-2 rounded border px-2 py-1 text-xs hover:bg-blue-50">加入项目术语</button>
            </div>
          ) : query && !loading ? <p className="py-10 text-center text-xs text-neutral-400">离线词典没有找到结果</p> : null}
        </div>
      )}
    </div>
  )
}
