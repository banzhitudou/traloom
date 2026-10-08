import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { VocabularySuggestion } from '@shared/types'

type DictionaryEntry = [
  phonetic: string,
  translation: string,
  rank: number,
  collins: number,
  oxford: number,
  pos: string
]

interface DictionaryPayload {
  version: number
  entries: Record<string, DictionaryEntry>
}

export interface KnownVocabularyEntry {
  en: string
  zh: string
  note?: string
  matchedText?: string
  source: 'glossary' | 'name' | 'place'
}

interface Candidate extends VocabularySuggestion {
  index: number
  end: number
  score: number
}

const STOP_WORDS = new Set(`
  a an and are as at be been being but by can could did do does doing done for from
  had has have having he her hers herself him himself his how i if in into is it its
  itself may me might mine more most my myself no nor not of on once only or other our
  ours ourselves out over own same she should so some such than that the their theirs
  them themselves then there these they this those through to too under until up very
  was we were what when where which while who whom why will with would you your yours
  yourself yourselves also all any both each few further here many much must now off
  again against before below between during above after am because down just over
`.trim().split(/\s+/))

let dictionary: Record<string, DictionaryEntry> | null = null

function loadDictionary(): Record<string, DictionaryEntry> {
  if (dictionary) return dictionary
  const assetPath = [
    join(__dirname, 'ecdict-core.json'),
    join(process.cwd(), 'src/main/assets/ecdict-core.json')
  ].find((candidate) => existsSync(candidate))
  if (!assetPath) return {}
  const payload = JSON.parse(readFileSync(assetPath, 'utf-8')) as DictionaryPayload
  dictionary = payload.entries
  return dictionary
}

function findTermIndex(text: string, term: string): number {
  const lowerText = text.toLowerCase()
  const lowerTerm = term.toLowerCase()
  let index = lowerText.indexOf(lowerTerm)
  while (index >= 0) {
    const before = index === 0 ? '' : text[index - 1]
    const after = text[index + term.length] ?? ''
    if (!/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after)) return index
    index = lowerText.indexOf(lowerTerm, index + 1)
  }
  return -1
}

/** Candidate names and places from capitalized spans, longest phrases first. */
export function extractProperNounCandidates(text: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const spans = text.matchAll(/[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]*(?:\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’-]*)*/g)

  for (const match of spans) {
    const words = match[0].split(/\s+/).filter(Boolean)
    const maxLength = Math.min(4, words.length)
    for (let length = maxLength; length >= 1; length -= 1) {
      for (let start = 0; start + length <= words.length; start += 1) {
        const candidate = words.slice(start, start + length).join(' ')
        const key = candidate.toLowerCase()
        if (seen.has(key) || (length === 1 && (candidate.length < 3 || STOP_WORDS.has(key)))) continue
        seen.add(key)
        result.push(candidate)
      }
    }
  }
  return result.slice(0, 30)
}

function wordForms(word: string): string[] {
  const lower = word.toLowerCase().replace(/'s$/, '')
  const forms = [lower]
  if (lower.endsWith('ies') && lower.length > 4) forms.push(`${lower.slice(0, -3)}y`)
  if (lower.endsWith('ves') && lower.length > 4) {
    forms.push(`${lower.slice(0, -3)}f`, `${lower.slice(0, -3)}fe`)
  }
  if (lower.endsWith('es') && lower.length > 4) forms.push(lower.slice(0, -2), lower.slice(0, -1))
  else if (lower.endsWith('s') && lower.length > 3) forms.push(lower.slice(0, -1))
  if (lower.endsWith('ing') && lower.length > 5) {
    const stem = lower.slice(0, -3)
    forms.push(stem, `${stem}e`, stem.replace(/([b-df-hj-np-tv-z])\1$/, '$1'))
  }
  if (lower.endsWith('ed') && lower.length > 4) {
    const stem = lower.slice(0, -2)
    forms.push(stem, `${stem}e`, stem.replace(/([b-df-hj-np-tv-z])\1$/, '$1'))
  }
  return [...new Set(forms)]
}

function lookupEntry(word: string): { lemma: string; entry: DictionaryEntry } | null {
  const entries = loadDictionary()
  for (const form of wordForms(word)) {
    if (entries[form]) return { lemma: form, entry: entries[form] }
  }
  return null
}

function simpleChinese(translation: string): string {
  const withoutLabel = translation
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^[a-z]{1,5}\.\s*/i, '')
    .trim()
  return withoutLabel.split(/[,，;；]/)[0]?.trim() || withoutLabel
}

export function lookupOfflineDictionary(word: string): VocabularySuggestion | null {
  const matchedText = word.trim()
  if (!matchedText) return null
  const found = lookupEntry(matchedText.toLowerCase())
  if (!found) return null
  const [phonetic, translation] = found.entry
  return {
    en: found.lemma,
    matchedText,
    zh: simpleChinese(translation),
    note: translation,
    phonetic,
    source: 'dictionary'
  }
}

export function getReaderVocabulary(
  text: string,
  knownEntries: KnownVocabularyEntry[],
  limit = 10
): VocabularySuggestion[] {
  if (!text.trim() || limit <= 0) return []
  const candidates: Candidate[] = []
  const claimed = new Set<string>()

  const sortedKnownEntries = [...knownEntries]

  for (const term of sortedKnownEntries) {
    const needle = term.matchedText || term.en
    const index = findTermIndex(text, needle)
    const key = needle.toLowerCase()
    const end = index + needle.length
    if (!needle || !term.zh || index < 0) continue
    if (candidates.some((item) => item.source === term.source && item.matchedText?.toLowerCase() === key && item.zh === term.zh && item.note === (term.note ?? ''))) continue
    claimed.add(key)
    const matchedText = text.slice(index, end)
    candidates.push({
      en: term.en,
      matchedText,
      zh: term.zh,
      note: term.note ?? '',
      source: term.source,
      index,
      end,
      score: Number.MAX_SAFE_INTEGER - index
    })
  }

  for (const match of text.matchAll(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)) {
    const matchedText = match[0]
    const key = matchedText.toLowerCase()
    const hasKnown = claimed.has(key)
    if (candidates.some((item) => item.source === 'dictionary' && item.matchedText?.toLowerCase() === key)) continue
    if (!hasKnown && (key.length < 3 || STOP_WORDS.has(key))) continue
    const index = match.index ?? 0
    const end = index + matchedText.length
    const found = lookupEntry(key)
    if (!found) continue
    const [phonetic, translation, rank] = found.entry
    if (!hasKnown && rank < 1200 && key.length < 8) continue

    claimed.add(key)
    candidates.push({
      en: matchedText,
      matchedText,
      zh: simpleChinese(translation),
      note: found.lemma === key ? translation : `${translation}（原形：${found.lemma}）`,
      phonetic,
      source: 'dictionary',
      index,
      end,
      score: Math.log10(Math.max(rank, 1)) * 100 + Math.min(key.length, 12) * 4
    })
  }

  const known = candidates.filter((candidate) => candidate.source !== 'dictionary')
  const general = candidates
    .filter((candidate) => candidate.source === 'dictionary')
    .sort((a, b) => b.score - a.score)
  const selectedWords = new Set(known.map((item) => item.matchedText?.toLowerCase()))
  for (const item of general) {
    if (selectedWords.size >= limit) break
    selectedWords.add(item.matchedText?.toLowerCase())
  }
  return candidates.filter((item) => selectedWords.has(item.matchedText?.toLowerCase()))
    .sort((a, b) => a.index - b.index)
    .map(({ index: _index, end: _end, score: _score, ...suggestion }) => suggestion)
}
