import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Paragraph } from '@shared/types'
import { searchParagraphs, type ParagraphSearchScope } from '@shared/paragraph-search'
import { formatParagraphNumbers, getParagraphSequenceNumbers } from '@shared/paragraph-numbering'

interface Props {
  paragraphs: Paragraph[]
  currentId: number | null
  onClose: () => void
  onSelect: (id: number) => void
}

const scopes: { value: ParagraphSearchScope; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'en', label: '英文原文' },
  { value: 'zh', label: '中文译稿' }
]

function excerpt(text: string, query: string) {
  const needle = query.trim()
  if (!needle) return text.slice(0, 140)
  const lower = text.toLocaleLowerCase()
  const index = lower.indexOf(needle.toLocaleLowerCase())
  if (index < 0) return text.slice(0, 140)
  const start = Math.max(0, index - 52)
  const end = Math.min(text.length, index + needle.length + 72)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const needle = query.trim()
  if (!needle) return <>{text}</>
  const lower = text.toLocaleLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let match = lower.indexOf(needle.toLocaleLowerCase())
  while (match >= 0) {
    parts.push(text.slice(cursor, match))
    parts.push(<mark key={match} className="bg-yellow-200 text-inherit">{text.slice(match, match + needle.length)}</mark>)
    cursor = match + needle.length
    match = lower.indexOf(needle.toLocaleLowerCase(), cursor)
  }
  parts.push(text.slice(cursor))
  return <>{parts}</>
}

export default function SearchDialog({ paragraphs, currentId, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ParagraphSearchScope>('all')
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => searchParagraphs(paragraphs, query, scope), [paragraphs, query, scope])
  const sequenceNumbers = getParagraphSequenceNumbers(paragraphs)

  useEffect(() => {
    inputRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 px-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-neutral-300 bg-white shadow-2xl">
        <header className="flex flex-none items-center gap-3 border-b px-4 py-3">
          <h2 id="search-title" className="text-sm font-medium text-neutral-800">全文搜索</h2>
          <span className="text-xs text-neutral-400">原文与译稿</span>
          <button type="button" onClick={onClose} aria-label="关闭搜索" title="关闭" className="ml-auto h-8 w-8 rounded text-xl text-neutral-500 hover:bg-neutral-100">×</button>
        </header>

        <div className="flex-none border-b bg-neutral-50 p-4">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入英文或中文关键词…"
            className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
          />
          <div className="mt-3 flex items-center gap-3">
            <div className="inline-flex overflow-hidden rounded border border-neutral-300 bg-white">
              {scopes.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={scope === item.value}
                  onClick={() => setScope(item.value)}
                  className={`border-l px-3 py-1.5 text-xs first:border-l-0 ${scope === item.value ? 'bg-blue-600 text-white' : 'hover:bg-neutral-100'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-neutral-500">{query.trim() ? `${results.length} 条结果` : `共 ${paragraphs.length} 段`}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!query.trim() && <div className="py-16 text-center text-sm text-neutral-400">输入关键词开始搜索</div>}
          {query.trim() && results.length === 0 && <div className="py-16 text-center text-sm text-neutral-400">没有找到匹配内容</div>}
          {results.map(({ paragraph, enMatched, zhMatched }) => (
            <button
              key={paragraph.id}
              type="button"
              onClick={() => onSelect(paragraph.id)}
              className={`block w-full border-b px-4 py-3 text-left hover:bg-blue-50 ${paragraph.id === currentId ? 'bg-blue-50/60' : ''}`}
            >
              <div className="mb-1.5 flex items-center gap-2 text-[11px] text-neutral-400">
                <span>{formatParagraphNumbers(sequenceNumbers.get(paragraph.id)!, paragraph.id)}</span>
                <span>第{paragraph.pageIdx + 1}页</span>
                <span>{paragraph.status === 'done' ? '已完成' : paragraph.status === 'review' ? '存疑' : paragraph.status === 'doing' ? '翻译中' : '待翻译'}</span>
              </div>
              {enMatched && (
                <div className="flex gap-2 text-xs leading-relaxed text-neutral-700">
                  <span className="w-9 shrink-0 text-neutral-400">原文</span>
                  <span><HighlightedText text={excerpt(paragraph.enText, query)} query={query} /></span>
                </div>
              )}
              {zhMatched && (
                <div className="mt-1 flex gap-2 text-xs leading-relaxed text-neutral-700">
                  <span className="w-9 shrink-0 text-neutral-400">译稿</span>
                  <span><HighlightedText text={excerpt(paragraph.zhText, query)} query={query} /></span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
