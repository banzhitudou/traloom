import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, History, RefreshCw, RotateCcw } from 'lucide-react'
import { api, REVISION_CHANGED } from '@renderer/lib/ipc'
import { changedRevisionFields, REVISION_FIELDS, REVISION_SOURCES, revisionTextDifference, type RevisionDetail, type RevisionEntry, type RevisionFilter } from '@shared/revisions'

interface Props { paragraphId?: number; active?: boolean; onBeforeRestore?: () => Promise<void>; onChanged?: () => void | Promise<void>; onSelectParagraph?: (id: number) => void }
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function groups(entries: RevisionEntry[]): RevisionEntry[][] {
  const result: RevisionEntry[][] = []
  for (const entry of entries) {
    const last = result[result.length - 1], previous = last?.[last.length - 1]
    const continuous = previous && entry.source === 'human' && previous.source === 'human' && entry.entityUuid === previous.entityUuid && entry.kind === previous.kind && entry.action === previous.action && ['修改译文','修改段落备注','修改项目备注'].includes(entry.action) && Math.abs(Date.parse(previous.createdAt) - Date.parse(entry.createdAt)) < 120000
    if (previous && (previous.operationId === entry.operationId || continuous)) last.push(entry)
    else result.push([entry])
  }
  return result
}

function Difference({ before, after }: { before: unknown; after: unknown }) {
  const a = before == null ? '' : typeof before === 'object' ? JSON.stringify(before, null, 2) : String(before)
  const b = after == null ? '' : typeof after === 'object' ? JSON.stringify(after, null, 2) : String(after)
  const diff = revisionTextDifference(a, b)
  return <div className="grid min-w-0 gap-2 sm:grid-cols-2">
    <div className="min-w-0 bg-neutral-50 p-2"><div className="mb-1 text-neutral-500">修改前</div><div className="selectable whitespace-pre-wrap break-words">{diff.prefix}<del className="bg-red-100 text-red-800">{diff.removed}</del>{diff.suffix}{!a && <span className="text-neutral-400">空</span>}</div></div>
    <div className="min-w-0 bg-neutral-50 p-2"><div className="mb-1 text-neutral-500">修改后</div><div className="selectable whitespace-pre-wrap break-words">{diff.prefix}<ins className="bg-emerald-100 text-emerald-900 no-underline">{diff.added}</ins>{diff.suffix}{!b && <span className="text-neutral-400">空</span>}</div></div>
  </div>
}

function fieldValue(key: string, value: unknown): unknown {
  if (key === 'status' && typeof value === 'string') return ({todo:'待译',doing:'待审',done:'通过',review:'存疑',pending:'待确认',replaced:'已替换',kept:'保留原译'} as Record<string,string>)[value] ?? value
  if (key === 'page_idx' && typeof value === 'number') return value + 1
  return value
}

export default function RevisionPanel({ paragraphId, active = true, onBeforeRestore, onChanged, onSelectParagraph }: Props) {
  const embedded = paragraphId !== undefined
  const [open, setOpen] = useState(!embedded)
  const [entries, setEntries] = useState<RevisionEntry[]>([])
  const [total, setTotal] = useState(0), [nextId, setNextId] = useState<number | null>(null)
  const [query, setQuery] = useState(''), [source, setSource] = useState<RevisionFilter['source']>('')
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [detail, setDetail] = useState<RevisionDetail | null>(null)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [side, setSide] = useState<'before' | 'after'>('after'), [field, setField] = useState('zh_text')
  const [category, setCategory] = useState(''), [reason, setReason] = useState('')
  const request = useRef(0), detailRequest = useRef(0)
  const refresh = useCallback(async (beforeId?: number) => {
    const operation = ++request.current
    try {
      const filter: RevisionFilter = { paragraphId, query, source, limit: open ? 40 : 1, beforeId }
      if (from) filter.from = new Date(`${from}T00:00:00`).toISOString()
      if (to) filter.to = new Date(`${to}T23:59:59.999`).toISOString()
      const page = await api.listRevisions(filter)
      if (operation !== request.current) return
      setEntries(old => beforeId ? [...old, ...page.entries] : page.entries)
      setTotal(page.total); setNextId(page.nextId); setError('')
    } catch (failure) { if (operation === request.current) setError(String(failure)) }
  }, [paragraphId, query, source, from, to, open])
  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout>
    void refresh()
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 250) }
    window.addEventListener(REVISION_CHANGED, changed)
    return () => { request.current++; clearTimeout(timer); window.removeEventListener(REVISION_CHANGED, changed) }
  }, [active, refresh])
  useEffect(() => { detailRequest.current++; setDetail(null) }, [paragraphId])
  const inspect = async (entry: RevisionEntry) => {
    const operation = ++detailRequest.current
    try {
      const data = await api.getRevisionDetail(entry.id)
      if (operation !== detailRequest.current) return
      setDetail(data); setSide(entry.after ? 'after' : 'before')
      setField(entry.kind === 'paragraph' ? entry.liveParagraphId === null ? 'paragraph' : changedRevisionFields(entry).includes('zh_text') ? 'zh_text' : changedRevisionFields(entry).includes('en_text') ? 'en_text' : 'paragraph' : 'content')
      setCategory(data.annotation.category); setReason(data.annotation.reason); setMessage(''); setError('')
    } catch (failure) { setError(String(failure)) }
  }
  const restore = async () => {
    if (!detail || busy) return
    setBusy(true); setError('')
    try {
      await onBeforeRestore?.()
      const fresh = await api.getRevisionDetail(detail.entry.id)
      if (!window.confirm(`恢复 ${time(detail.entry.createdAt)} 的${side === 'before' ? '修改前' : '修改后'}版本？当前对应内容会被替换，并生成一条新的修订记录。`)) return
      const result = await api.restoreRevision({ id: detail.entry.id, side, field, expected: fresh.currentState })
      setMessage('已恢复，恢复操作已记入历史。')
      await onChanged?.()
      if (result.paragraphId !== null) onSelectParagraph?.(result.paragraphId)
      await refresh()
      setDetail(await api.getRevisionDetail(detail.entry.id))
    } catch (failure) { setError(String(failure)) } finally { setBusy(false) }
  }
  const exportRaw = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      await onBeforeRestore?.()
      const result = await api.exportRevisions()
      if (result.ok) setMessage(`已导出：${result.path}`)
      else if (result.error !== '已取消导出。') setError(result.error ?? '导出失败')
    } catch (failure) { setError(String(failure)) } finally { setBusy(false) }
  }
  const selected = detail?.entry
  const restorable = selected && ['paragraph','paragraph_note','glossary','document','project'].includes(selected.kind) && (selected.kind !== 'paragraph_note' || selected.liveParagraphId !== null)
  const content = <div className="min-w-0 text-xs">
    <div className="flex flex-wrap items-center gap-2 border-b pb-2">
      <span className="text-neutral-500">共 {total} 条原始记录</span>
      <button type="button" title="刷新修订记录" onClick={() => void refresh()} className="ml-auto rounded p-1.5 text-neutral-600 hover:bg-neutral-100"><RefreshCw size={15} /></button>
      {!embedded && <button type="button" onClick={() => void exportRaw()} disabled={busy} className="inline-flex items-center gap-1 rounded border px-2 py-1.5 disabled:opacity-50"><Download size={14} />导出原始记录</button>}
    </div>
    {!embedded && <div className="grid grid-cols-2 gap-2 border-b py-2">
      <input aria-label="搜索修订记录" placeholder="段号、内容或操作" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 rounded border px-2 py-1.5" />
      <select aria-label="操作来源" value={source} onChange={event => setSource(event.target.value as RevisionFilter['source'])} className="min-w-0 rounded border px-2 py-1.5"><option value="">全部来源</option>{Object.entries(REVISION_SOURCES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <label className="text-neutral-500">开始日期<input aria-label="开始日期" type="date" value={from} onChange={event => setFrom(event.target.value)} className="mt-1 w-full min-w-0 rounded border p-1 text-neutral-800" /></label>
      <label className="text-neutral-500">结束日期<input aria-label="结束日期" type="date" value={to} onChange={event => setTo(event.target.value)} className="mt-1 w-full min-w-0 rounded border p-1 text-neutral-800" /></label>
    </div>}
    {error && <p role="alert" className="selectable break-words py-2 text-red-700">{error}</p>}
    {message && <p role="status" className="selectable break-words py-2 text-emerald-800">{message}</p>}
    {detail && selected && <section className="border-b py-3">
      <div className="mb-2 flex items-start gap-2"><strong className="min-w-0 flex-1 break-words">{selected.action} · {time(selected.createdAt)}</strong><button type="button" onClick={() => { detailRequest.current++; setDetail(null) }} className="text-blue-700">收起对照</button></div>
      {selected.kind === 'ai_generation' ? <>
        <pre className="selectable max-h-80 overflow-auto whitespace-pre-wrap break-words bg-neutral-50 p-2">{JSON.stringify(selected.after, null, 2)}</pre>
      </> : changedRevisionFields(selected).map(key => <div key={key} className="mb-3"><div className="mb-1 font-medium">{REVISION_FIELDS[key] ?? key}</div><Difference before={fieldValue(key,selected.before?.[key])} after={fieldValue(key,selected.after?.[key])} /></div>)}
      {restorable && <div className="flex flex-wrap gap-2">
        <select aria-label="恢复哪个版本" value={side} onChange={event => setSide(event.target.value as 'before' | 'after')} className="rounded border p-1"><option value="before" disabled={!selected.before}>修改前</option><option value="after" disabled={!selected.after}>修改后</option></select>
        {selected.kind === 'paragraph' && <select aria-label="恢复内容" value={field} onChange={event => setField(event.target.value)} className="rounded border p-1"><option value="paragraph">整段内容</option>{selected.liveParagraphId !== null && <><option value="zh_text">仅译文</option><option value="en_text">仅原文</option><option value="bbox_json">仅坐标</option><option value="status">仅状态</option></>}</select>}
        <button type="button" onClick={() => void restore()} disabled={busy} className="inline-flex items-center gap-1 rounded border border-blue-200 px-2 py-1 text-blue-700 disabled:opacity-50"><RotateCcw size={14} />恢复此版本</button>
      </div>}
      <details className="mt-3"><summary className="cursor-pointer text-neutral-600">修订原因{category || reason ? ' · 已填写' : ''}</summary><div className="mt-2 flex flex-col gap-2">
        <select aria-label="修订分类" value={category} onChange={event => setCategory(event.target.value)} className="rounded border p-1.5">{['','纠正误译','更自然','统一术语','适合儿童','删去增译','OCR 修正','其他'].map(item => <option value={item} key={item}>{item || '未分类'}</option>)}</select>
        <textarea aria-label="修订原因" value={reason} onChange={event => setReason(event.target.value)} rows={2} className="selectable w-full rounded border p-2" />
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await api.annotateRevision(selected.id, category, reason); setMessage('修订说明已保存。') } catch (failure) { setError(String(failure)) } finally { setBusy(false) } }} className="self-start rounded border px-2 py-1.5">保存修订说明</button>
      </div></details>
      <details className="mt-2"><summary className="cursor-pointer text-neutral-600">当时的上下文与操作来源</summary><pre className="selectable mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words bg-neutral-50 p-2">{JSON.stringify({ source: REVISION_SOURCES[selected.source], metadata: selected.metadata, environment: detail.environment, nearby: selected.neighbors, operationRecords: detail.related }, null, 2)}</pre></details>
    </section>}
    {groups(entries).map(group => <details key={group[0].id} className="border-b py-2">
      <summary className="cursor-pointer break-words text-neutral-700">{time(group[0].createdAt)} · {group[0].action}{group.length > 1 ? ` · ${group.length} 条` : ''}<span className="ml-2 text-neutral-400">{REVISION_SOURCES[group[0].source]}</span></summary>
      <div className="mt-1">
        {group.map(entry => {
          const snapshot = entry.after ?? entry.before
          const para = entry.kind === 'ai_generation' ? snapshot?.paragraph as Record<string, unknown> | undefined : snapshot
          return <div key={entry.id} className="flex flex-wrap items-center gap-2 border-t border-neutral-100 py-2">
            <button type="button" onClick={() => void inspect(entry)} className="min-w-0 flex-1 text-left text-blue-700 hover:underline">{entry.kind === 'paragraph' || entry.kind === 'paragraph_note' || entry.kind === 'ai_generation' && entry.entityId ? `#${entry.entityId}${entry.sequenceAfter ?? entry.sequenceBefore ? ` · 第${entry.sequenceAfter ?? entry.sequenceBefore}段` : ''}${para?.page_idx != null ? ` · PDF ${Number(para.page_idx) + 1}` : ''}` : entry.kind === 'glossary' ? `术语：${snapshot?.en ?? entry.entityId}` : entry.kind === 'project' ? String(snapshot?.key === 'project_note' ? '项目备注' : snapshot?.key === 'style_guide_text' ? '风格指南' : entry.entityId) : entry.kind === 'annotation' ? `修订说明 #${entry.entityId}` : '项目记录'} · {changedRevisionFields(entry).filter(key => key in REVISION_FIELDS).map(key => REVISION_FIELDS[key]).join('、') || entry.action}</button>
            {entry.liveParagraphId !== null && onSelectParagraph && <button type="button" onClick={() => onSelectParagraph(entry.liveParagraphId!)} className="text-neutral-500 hover:text-blue-700">查看段落</button>}
            <button type="button" onClick={() => void inspect(entry)} className="text-blue-700">查看差异</button>
          </div>
        })}
      </div>
    </details>)}
    {nextId && <button type="button" onClick={() => void refresh(nextId)} className="mt-2 rounded border px-3 py-1.5">加载更早记录</button>}
    {!entries.length && <p className="py-4 text-neutral-400">暂无符合条件的修订记录</p>}
  </div>
  if (!embedded) return content
  return <details className="mt-2 border-t pt-2" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-neutral-600"><History size={14} />修订记录 · {total}条</summary>
    {open && content}
  </details>
}
