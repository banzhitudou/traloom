import { containsWholeTerm, inferCurrentTranslations, termForms } from './glossary-check'

export interface TextPart { text: string; highlighted: boolean }

export function highlightTerms(text: string, terms: string[], wholeTerm = false): TextPart[] {
  const offsets: { start: number; end: number }[] = []
  let normalized = ''
  for (const match of text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const value = match[0].normalize('NFC').toLocaleLowerCase()
    normalized += value
    for (let i = 0; i < value.length; i++) offsets.push({ start: match.index!, end: match.index! + match[0].length })
  }
  const ranges: { start: number; end: number }[] = []
  for (const term of terms.filter(term => term.trim()).flatMap(term => wholeTerm ? termForms(term.normalize('NFC').trim().toLocaleLowerCase()).sort((a, b) => b.length - a.length) : [term])) {
    const escaped = term.normalize('NFC').trim().toLocaleLowerCase().split(/\s+/u)
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    for (const match of normalized.matchAll(new RegExp(escaped, 'gu'))) {
      const start = match.index!
      const end = start + match[0].length
      const before = Array.from(normalized.slice(Math.max(0, start - 2), start)).at(-1) ?? ''
      const after = String.fromCodePoint(normalized.codePointAt(end) ?? 0)
      if (wholeTerm && ((/[\p{L}\p{M}\p{N}_]/u.test(match[0][0]) && /[\p{L}\p{M}\p{N}_]/u.test(before)) ||
        (/[\p{L}\p{M}\p{N}_]/u.test(match[0].at(-1)!) && /[\p{L}\p{M}\p{N}_]/u.test(after)))) continue
      ranges.push({ start: offsets[start].start, end: offsets[end - 1].end })
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: typeof ranges = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  const parts: TextPart[] = []
  let cursor = 0
  for (const range of merged) {
    if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start), highlighted: false })
    parts.push({ text: text.slice(range.start, range.end), highlighted: true })
    cursor = range.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false })
  return parts
}

export function suggestOldTranslations(
  rows: { enText: string; zhText: string }[], entry: { en: string; zh: string }, history: string[] = []
): { text: string; count: number }[] {
  const matching = rows.filter(row => containsWholeTerm(row.enText, entry.en))
  const candidates = [...new Set([...history.map(text => text.trim()), ...matching.flatMap(row => inferCurrentTranslations(row.enText, row.zhText, entry))])]
  return candidates.filter(text => text && text !== entry.zh.trim()).map(text => ({
    text, count: matching.filter(row => replaceOldTranslations(row.zhText, [text], entry.zh) !== row.zhText).length
  })).filter(candidate => candidate.count > 0).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
}

// Match against the original text once; preserve existing standard names and prefer longer old names.
export function replaceOldTranslations(text: string, oldNames: string[], standard: string): string {
  const names = [...new Set([standard, ...oldNames.map(name => name.trim())].filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!names.length) return text
  const expression = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return text.replace(new RegExp(expression, 'gu'), match => match === standard ? match : standard)
}
