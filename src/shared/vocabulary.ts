import type { VocabularySuggestion } from './types'

export interface VocabularyTextPart {
  text: string
  suggestionIndex?: number
}

interface MatchRange {
  start: number
  end: number
  suggestionIndex: number
}

function isWordBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''
  return !/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after)
}

export function splitVocabularyText(
  text: string,
  suggestions: VocabularySuggestion[]
): VocabularyTextPart[] {
  const lowerText = text.toLowerCase()
  const ranges: MatchRange[] = []

  suggestions.forEach((suggestion, suggestionIndex) => {
    const needle = (suggestion.matchedText || suggestion.en).trim().toLowerCase()
    if (!needle) return
    let start = lowerText.indexOf(needle)
    while (start >= 0) {
      const end = start + needle.length
      if (isWordBoundary(text, start, end)) ranges.push({ start, end, suggestionIndex })
      start = lowerText.indexOf(needle, start + needle.length)
    }
  })

  ranges.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const accepted: MatchRange[] = []
  for (const range of ranges) {
    if (accepted.some((item) => range.start < item.end && range.end > item.start)) continue
    accepted.push(range)
  }
  accepted.sort((a, b) => a.start - b.start)

  const parts: VocabularyTextPart[] = []
  let cursor = 0
  for (const range of accepted) {
    if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start) })
    parts.push({ text: text.slice(range.start, range.end), suggestionIndex: range.suggestionIndex })
    cursor = range.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts.length > 0 ? parts : [{ text }]
}
