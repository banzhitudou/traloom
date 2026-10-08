import { useEffect, useRef, useState } from 'react'
import { api } from '@renderer/lib/ipc'
import { filterParagraphNotes, type ParagraphNoteSummary } from '@shared/notes'
import { formatParagraphNumbers } from '@shared/paragraph-numbering'
import ParagraphNotes from './ParagraphNotes'
import { NOTE_CHANGED } from './note-events'

export default function NotesPanel({ active, currentId, onSelectParagraph }: {
  active: boolean
  currentId: number | null
  onSelectParagraph?: (id: number) => void
}) {
  const [mode, setMode] = useState<'paragraph' | 'project'>('paragraph')
  const [notes, setNotes] = useState<ParagraphNoteSummary[]>([])
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const revision = useRef(0)
  const refresh = async () => {
    const version = ++revision.current
    try {
      const next = await api.listParagraphNotes()
      if (version === revision.current) { setNotes(next); setError('') }
    } catch (error) {
      if (version === revision.current) setError(error instanceof Error ? error.message : '读取备注失败')
    }
  }
  useEffect(() => {
    if (!active) return
    void refresh()
    const changed = () => void refresh()
    window.addEventListener(NOTE_CHANGED, changed)
    return () => { revision.current++; window.removeEventListener(NOTE_CHANGED, changed) }
  }, [active, currentId])
  const visible = filterParagraphNotes(notes, query)
  return <div className="min-h-full">
    <header className="sticky -top-3 z-10 -mx-3 -mt-3 border-b bg-white px-3 py-3">
      <div className="flex gap-2 border-b text-sm">
        <button type="button" aria-pressed={mode === 'paragraph'} onClick={() => setMode('paragraph')} className={`px-2 py-2 ${mode === 'paragraph' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-neutral-500'}`}>段落备注（{notes.length}）</button>
        <button type="button" aria-pressed={mode === 'project'} onClick={() => setMode('project')} className={`px-2 py-2 ${mode === 'project' ? 'border-b-2 border-blue-600 text-blue-700' : 'text-neutral-500'}`}>项目备注</button>
      </div>
      {mode === 'paragraph' && <div className="mt-2 flex flex-wrap gap-2">
        <input aria-label="搜索段落备注" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索备注、原文、译文或编号" className="min-w-0 flex-1 rounded border px-2 py-1 text-xs" />
        <button type="button" onClick={() => void refresh()} className="rounded border px-2 py-1 text-xs">刷新</button>
        <button type="button" disabled={currentId === null} onClick={() => setEditingId(currentId)} className="rounded border px-2 py-1 text-xs text-blue-700 disabled:opacity-35">当前段备注</button>
      </div>}
    </header>
    {error && <p role="alert" className="my-2 text-xs text-red-700">{error}</p>}
    {mode === 'project' ? <ParagraphNotes id={null} defaultOpen /> : <>
      {editingId !== null && <section className="border-b py-3">
        <div className="flex items-center justify-between text-xs">
          <span>编辑段 #{editingId} 的备注</span>
          <button type="button" onClick={() => setEditingId(null)} className="rounded border px-2 py-1">收起</button>
        </div>
        <ParagraphNotes key={editingId} id={editingId} defaultOpen />
      </section>}
      <div className="divide-y">{visible.map(note => <section key={note.id} className="py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => onSelectParagraph?.(note.id)} className="text-blue-700 hover:underline">{formatParagraphNumbers(note.sequence, note.id)} · PDF {note.pageIdx + 1}</button>
          <button type="button" onClick={() => setEditingId(note.id)} className="ml-auto rounded border px-2 py-1">编辑备注</button>
        </div>
        <p className="mt-2 break-words text-xs text-neutral-500">{note.enText.slice(0, 140)}{note.enText.length > 140 ? '…' : ''}</p>
        <p className="selectable mt-2 whitespace-pre-wrap break-words bg-neutral-50 p-2 text-sm leading-relaxed">{note.content}</p>
      </section>)}</div>
      {!visible.length && <p className="py-10 text-center text-xs text-neutral-500">{query.trim() ? '没有符合条件的备注' : '暂无段落备注'}</p>}
    </>}
  </div>
}
