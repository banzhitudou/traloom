import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { api } from '@renderer/lib/ipc'
import type { GlossaryEntry } from '@shared/types'
import type { GlossaryAuditApply, GlossaryAuditGroup, GlossaryAuditMatch, GlossaryAuditReport, GlossaryAuditState } from '@shared/glossary-audit'
import { formatParagraphNumbers } from '@shared/paragraph-numbering'
import { HighlightedTerm } from './GlossaryReplacementControls'

interface Props {
  bookLabel: (pageIdx: number) => string
  onClose: () => void
  onOpenTerm: (entry: GlossaryEntry) => void
  onEditTerm: (entry: GlossaryEntry) => void
  onOpenImpacts: (changeId: number) => void
  onSelectParagraph?: (id: number) => void
  onProjectChanged?: () => void
}

const LABELS: Record<GlossaryAuditState, string> = { different: '明确不一致', uncertain: '需要核对', untranslated: '尚未翻译' }
const keyOf = (group: GlossaryAuditGroup, match: GlossaryAuditMatch) => `${group.entry.id}:${match.paragraph.id}`

export default function GlossaryAuditPanel({ bookLabel, onClose, onOpenTerm, onEditTerm, onOpenImpacts, onSelectParagraph, onProjectChanged }: Props) {
  const [report, setReport] = useState<GlossaryAuditReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState<'all' | GlossaryAuditState>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [oldNames, setOldNames] = useState<Record<string, string>>({})
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set())
  const [records, setRecords] = useState<{ entryId: number; changeId: number; label: string }[]>([])

  const scan = async () => {
    setLoading(true)
    setError('')
    try {
      const next = await api.auditGlossary()
      setReport(next)
      setSelected(new Set())
      setOldNames({})
      setOpenGroups(new Set(next.groups.slice(0, 1).map(group => group.entry.id)))
    } catch (error) {
      setError(error instanceof Error ? error.message : '全书检查失败')
    } finally { setLoading(false) }
  }
  useEffect(() => { void scan() }, [])

  const all = report?.groups.flatMap(group => group.matches.map(match => ({ group, match, key: keyOf(group, match) }))) ?? []
  const visible = all.filter(({ group, match }) => (filter === 'all' || match.auditState === filter) &&
    (!query.trim() || `${group.entry.en} ${group.entry.zh} ${group.entry.category} ${match.oldTranslations.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())))
  const chosen = all.filter(row => selected.has(row.key))
  const oldName = (key: string, match: GlossaryAuditMatch) => oldNames[key] ?? (match.oldTranslations.length === 1 ? match.oldTranslations[0] : '')
  const counts = { different: 0, uncertain: 0, untranslated: 0 }
  all.forEach(({ match }) => counts[match.auditState]++)
  const replaceReady = chosen.length > 0 && chosen.every(({ key, group, match }) => {
    const old = oldName(key, match).trim()
    return old && old !== group.entry.zh && match.paragraph.zhText.includes(old)
  })
  const toggle = (key: string) => setSelected(current => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const apply = async (action: GlossaryAuditApply['action'], rows = chosen) => {
    if (busy || !rows.length) return
    const paragraphCount = new Set(rows.map(row => row.match.paragraph.id)).size
    const label = action === 'replace' ? '替换已确认的旧译名并标为待审' : action === 'review' ? '标为存疑（不修改译文）' : '标为待审（不修改译文）'
    if (!window.confirm(`将对 ${rows.length} 处术语结果、${paragraphCount} 个翻译段${label}。确定继续？`)) return
    setBusy(true)
    setError('')
    try {
      const requests: GlossaryAuditApply['requests'] = []
      for (const { key, group, match } of rows) {
        const oldZh = action === 'replace' ? oldName(key, match).trim() : ''
        let request = requests.find(item => item.entry.id === group.entry.id && item.oldZh === oldZh)
        if (!request) {
          request = { entry: group.entry, oldZh, paragraphs: [] }
          requests.push(request)
        }
        const paragraph = match.paragraph
        request.paragraphs.push({ id: paragraph.id, enText: paragraph.enText, zhText: paragraph.zhText, status: paragraph.status })
      }
      const result = await api.applyGlossaryAudit({ action, requests })
      if (!result.ok) { setError(result.error ?? '处理失败'); return }
      setMessage(`已处理 ${result.count} 个翻译段。`)
      if (result.changes?.length) {
        setRecords(current => [...result.changes!.slice().reverse().map(change => ({ ...change, label: report?.groups.find(group => group.entry.id === change.entryId)?.entry.en ?? '术语' })), ...current])
      }
      onProjectChanged?.()
      await scan()
    } catch (error) { setError(error instanceof Error ? error.message : '处理失败') }
    finally { setBusy(false) }
  }
  const accept = async (group: GlossaryAuditGroup, match: GlossaryAuditMatch) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await api.setGlossaryAcceptance({ entry: group.entry, paragraph: match.paragraph, accepted: true })
      if (!result.ok) throw new Error(result.error ?? '认可失败')
      setMessage('已认可此处译名，译文与翻译段状态未修改。')
      onProjectChanged?.()
      await scan()
    } catch (error) { setError(error instanceof Error ? error.message : '认可失败') }
    finally { setBusy(false) }
  }

  return <div className="min-h-full">
    <header className="sticky -top-3 z-10 -mx-3 -mt-3 border-b bg-white px-3 py-3">
      <div className="flex items-center gap-2">
        <button type="button" title="返回术语表" aria-label="返回术语表" onClick={onClose} className="h-8 w-8 flex-none rounded hover:bg-neutral-100">←</button>
        <strong className="min-w-0 text-sm">全书术语一致性检查</strong>
        <button type="button" disabled={loading || busy} onClick={() => void scan()} className="ml-auto flex-none rounded border px-2 py-1 text-xs disabled:opacity-35">{loading ? '检查中…' : '重新检查'}</button>
      </div>
      {report && <p className="mt-2 text-xs text-neutral-500">已检查 {report.termCount} 条术语 · {report.paragraphCount} 段 · 命中 {report.matchedTermCount} 条 · 已采用标准译名 {report.standardCount} 处</p>}
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <select aria-label="检查结果类型" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="max-w-full rounded border px-2 py-1">
          <option value="all">全部问题（{all.length} 处）</option>
          {Object.entries(LABELS).map(([state, label]) => <option key={state} value={state}>{label}（{counts[state as GlossaryAuditState]} 处）</option>)}
        </select>
        <input aria-label="筛选检查结果" placeholder="筛选术语、译名或分类" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 rounded border px-2 py-1" />
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <button type="button" disabled={busy || loading} onClick={() => setSelected(new Set(visible.filter(row => row.match.auditState === 'different').map(row => row.key)))} className="rounded border px-2 py-1">选择明确不一致</button>
        <button type="button" disabled={busy || loading} onClick={() => setSelected(new Set(visible.map(row => row.key)))} className="rounded border px-2 py-1">选择当前结果</button>
        <button type="button" disabled={busy} onClick={() => setSelected(new Set())} className="rounded border px-2 py-1">取消选择</button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">已选 {chosen.length} 处 · {new Set(chosen.map(row => row.match.paragraph.id)).size} 段</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <button type="button" disabled={busy || loading || !replaceReady} onClick={() => void apply('replace')} className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-35">替换已选</button>
        <button type="button" disabled={busy || loading || !chosen.length} onClick={() => void apply('review')} className="rounded border px-2 py-1 text-amber-700 disabled:opacity-35">已选标为存疑</button>
        <button type="button" disabled={busy || loading || !chosen.length} onClick={() => void apply('doing')} className="rounded border px-2 py-1 text-blue-700 disabled:opacity-35">已选标为待审</button>
      </div>
    </header>
    {error && <p role="alert" className="my-2 selectable text-xs text-red-700">{error}</p>}
    {message && <p role="status" className="my-2 text-xs text-emerald-700">{message}</p>}
    {records.length > 0 && <div className="border-b py-2 text-xs">
      <strong>替换记录</strong>
      {records.map(record => <button type="button" key={record.changeId} onClick={() => onOpenImpacts(record.changeId)} className="ml-2 text-blue-700 hover:underline">{record.label} · 查看／撤销</button>)}
    </div>}
    {loading && <p role="status" className="py-8 text-center text-xs text-neutral-500">正在检查全部项目术语…</p>}
    {!loading && report?.groups.map(group => {
      const rows = visible.filter(row => row.group.entry.id === group.entry.id)
      if (!rows.length) return null
      return <section key={group.entry.id} className="border-b py-3">
        <div className="flex items-start gap-2">
          <button type="button" aria-expanded={openGroups.has(group.entry.id)} onClick={() => setOpenGroups(current => {
            const next = new Set(current)
            if (next.has(group.entry.id)) next.delete(group.entry.id); else next.add(group.entry.id)
            return next
          })} className="min-w-0 flex-1 text-left text-sm">
            <span className="mr-1">{openGroups.has(group.entry.id) ? '▾' : '▸'}</span>
            <strong className="break-words">{group.entry.en} → {group.entry.zh}</strong>
            <span className="mt-1 block text-xs text-neutral-500">{group.entry.category} · {rows.length} 处 · {rows.filter(row => row.match.auditState === 'different').length} 处明确不一致</span>
          </button>
          <div className="flex flex-none flex-wrap justify-end gap-1">
            <button type="button" disabled={busy || loading} onClick={() => onEditTerm(group.entry)} title={`编辑术语：${group.entry.en}`} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-35"><Pencil size={13} />编辑术语</button>
            <button type="button" disabled={busy || loading} onClick={() => onOpenTerm(group.entry)} className="rounded border px-2 py-1 text-xs text-blue-700 disabled:opacity-35">检查此术语</button>
          </div>
        </div>
        {openGroups.has(group.entry.id) && rows.map(row => {
          const { match, key } = row
          const old = oldName(key, match)
          const canReplace = old.trim() && old.trim() !== group.entry.zh && match.paragraph.zhText.includes(old.trim())
          return <div key={key} className="mt-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input type="checkbox" aria-label={`选择术语 ${group.entry.en} 段 #${match.paragraph.id}`} checked={selected.has(key)} disabled={busy} onChange={() => toggle(key)} />
              <button type="button" onClick={() => onSelectParagraph?.(match.paragraph.id)} className="text-blue-700 hover:underline">{formatParagraphNumbers(match.sequence, match.paragraph.id)} · PDF {match.paragraph.pageIdx + 1}{bookLabel(match.paragraph.pageIdx)}</button>
              <span className={match.auditState === 'different' ? 'text-red-700' : 'text-neutral-500'}>{LABELS[match.auditState]}</span>
            </div>
            <p className="selectable mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-600"><HighlightedTerm text={match.paragraph.enText} terms={[group.entry.en]} source /></p>
            <p onMouseUp={event => {
              const selection = window.getSelection()
              if (selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode &&
                  event.currentTarget.contains(selection.anchorNode) && event.currentTarget.contains(selection.focusNode)) {
                const value = selection.toString().trim()
                if (value) setOldNames(current => ({ ...current, [key]: value }))
              }
            }} className="selectable mt-2 whitespace-pre-wrap break-words bg-neutral-50 p-2 text-xs leading-relaxed"><HighlightedTerm text={match.paragraph.zhText || '（尚无译文）'} terms={[group.entry.zh]} warnings={[...match.oldTranslations, old].filter(name => name && name !== group.entry.zh)} /></p>
            {match.auditState !== 'untranslated' && <div className="mt-2 flex flex-wrap gap-2">
              <input aria-label={`段 #${match.paragraph.id} 要替换的旧译名`} value={old} placeholder="要替换的旧译名" onChange={event => setOldNames(current => ({ ...current, [key]: event.target.value }))} className="min-w-0 flex-1 rounded border px-2 py-1 text-xs" />
              {match.oldTranslations.length > 1 && <select aria-label={`段 #${match.paragraph.id} 选择旧译名`} value={match.oldTranslations.includes(old) ? old : ''} onChange={event => setOldNames(current => ({ ...current, [key]: event.target.value }))} className="max-w-full rounded border px-2 py-1 text-xs">
                <option value="">选择旧译名</option>
                {match.oldTranslations.map(name => <option key={name} value={name}>{name}</option>)}
              </select>}
            </div>}
            {canReplace && <div className="mt-2 border-l-2 border-blue-500 bg-blue-50 p-2 text-xs">
              <span className="text-blue-700">替换预览：{old.trim()} → {group.entry.zh}</span>
              <p className="selectable mt-1 whitespace-pre-wrap break-words leading-relaxed">{match.paragraph.zhText.split(old.trim()).join(group.entry.zh)}</p>
            </div>}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <button type="button" disabled={busy || !match.paragraph.zhText.trim()} onClick={() => void accept(group, match)} className="rounded border px-2 py-1 text-emerald-700 disabled:opacity-35">认可此处译名</button>
              <button type="button" disabled={busy || !canReplace} onClick={() => void apply('replace', [row])} className="rounded border px-2 py-1 text-blue-700 disabled:opacity-35">替换此处</button>
              <button type="button" disabled={busy} onClick={() => void apply('review', [row])} className="rounded border px-2 py-1 text-amber-700">标为存疑</button>
              <button type="button" disabled={busy} onClick={() => void apply('doing', [row])} className="rounded border px-2 py-1 text-blue-700">标为待审</button>
            </div>
          </div>
        })}
      </section>
    })}
    {!loading && report && !visible.length && <p className="py-10 text-center text-xs text-neutral-500">{all.length ? '没有符合条件的检查结果' : '未发现术语一致性问题'}</p>}
  </div>
}
