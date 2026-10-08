import { highlightTerms } from '@shared/glossary-presentation'

export function HighlightedTerm({ text, terms, source = false, warnings = [] }: { text: string; terms: string[]; source?: boolean; warnings?: string[] }) {
  if (!source && warnings.length) return <>{highlightTerms(text, warnings).map((part, index) => part.highlighted
    ? <mark key={index} className="rounded-sm bg-orange-200 text-orange-950">{part.text}</mark>
    : <HighlightedTerm key={index} text={part.text} terms={terms} />)}</>
  return <>{highlightTerms(text, terms, source).map((part, index) => part.highlighted
    ? <mark key={index} className={source ? 'rounded-sm bg-yellow-200 text-neutral-900' : 'rounded-sm bg-blue-100 text-blue-900'}>{part.text}</mark>
    : part.text)}</>
}

export default function GlossaryReplacementControls({ suggestions, selected, onSelect, custom, onCustom, disabled = false }: {
  suggestions: { text: string; count: number }[]
  selected: string[]
  onSelect: (names: string[]) => void
  custom: string
  onCustom: (name: string) => void
  disabled?: boolean
}) {
  return <div className="mt-2 space-y-2 text-xs">
    {suggestions.length > 0 && <fieldset disabled={disabled}>
      <legend className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-neutral-700">旧译名备选（{suggestions.length} 个）</span>
        <button type="button" onClick={() => onSelect(suggestions.map(item => item.text))} className="text-blue-700 hover:underline">全选</button>
        <button type="button" onClick={() => { onSelect([]); onCustom('') }} className="text-neutral-500 hover:underline">取消选择</button>
      </legend>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {suggestions.map(item => <label key={item.text} className="flex max-w-full items-start gap-1.5">
          <input type="checkbox" checked={selected.includes(item.text)} onChange={event => onSelect(event.target.checked ? [...selected, item.text] : selected.filter(name => name !== item.text))} className="mt-0.5 flex-none" />
          <span className="break-words">{item.text}<span className="ml-1 text-neutral-500">（{item.count} 段）</span></span>
        </label>)}
      </div>
    </fieldset>}
    <input id="impact-old-translation" aria-label="要替换的旧译名" placeholder={suggestions.length ? '其他旧译名（可选）' : '输入实际译文中要替换的旧译名'} value={custom} disabled={disabled} onChange={event => onCustom(event.target.value)} className="w-full min-w-0 rounded border px-2 py-1.5" />
  </div>
}
