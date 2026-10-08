import type { GlossaryEntry, Paragraph } from './types'

export const DEFAULT_GLOSSARY_CATEGORIES = ['人名', '地名', '机构名', '书名与作品名', '食物名称', '专业术语', '其他']

export function glossaryCategoryOptions(categories: string[]): string[] {
  return [...new Set([...categories.map(category => category.trim()).filter(Boolean), ...DEFAULT_GLOSSARY_CATEGORIES])]
}

export function containsWholeTerm(text: string, term: string): boolean {
  return countWholeTerm(text, term) > 0
}

export function countWholeTerm(text: string, term: string): number {
  return wholeTermSpans(text, term).length
}

const normalizedCache = new Map<string, string>()
function normalized(value: string): string {
  const cached = normalizedCache.get(value)
  if (cached !== undefined) return cached
  const result = value.normalize('NFC').replace(/\s+/gu, ' ').toLocaleLowerCase()
  if (normalizedCache.size >= 4096) normalizedCache.delete(normalizedCache.keys().next().value!)
  normalizedCache.set(value, result)
  return result
}

export function termForms(term: string): string[] {
  const result = [term]
  const last = term.match(/[a-z]+$/)?.[0]
  // Only regular English suffixes; do not stem names, non-Latin words or arbitrary substrings.
  if (last && /^[a-z -]+$/.test(term) && last.length > 2) {
    if (/(s|x|z|ch|sh)$/.test(last)) result.push(term + 'es')
    else if (!/[^aeiou]y$/.test(last)) result.push(term + 's')
  }
  return result
}

function wholeTermSpans(text: string, term: string): { start: number; end: number }[] {
  const normalizedText = normalized(text)
  const normalizedTerm = normalized(term).trim()
  if (!normalizedTerm) return []
  const spans: { start: number; end: number }[] = []
  for (const form of termForms(normalizedTerm)) {
  let index = normalizedText.indexOf(form)
  while (index >= 0) {
    const before = Array.from(normalizedText.slice(Math.max(0, index - 2), index)).at(-1) ?? ''
    const after = String.fromCodePoint(normalizedText.codePointAt(index + form.length) ?? 0)
    if ((!/[\p{L}\p{M}\p{N}_]/u.test(form[0]) || !/[\p{L}\p{M}\p{N}_]/u.test(before)) &&
      (!/[\p{L}\p{M}\p{N}_]/u.test(form.at(-1)!) || !/[\p{L}\p{M}\p{N}_]/u.test(after))) spans.push({ start: index, end: index + form.length })
    index = normalizedText.indexOf(form, index + form.length)
  }
  }
  return spans
}

export function countIndependentTerm(text: string, term: string, entries: Pick<GlossaryEntry, 'en'>[]): number {
  const spans = wholeTermSpans(text, term)
  if (!spans.length) return 0
  const covering = entries.filter(entry => containsWholeTerm(entry.en, term))
    .flatMap(entry => wholeTermSpans(text, entry.en))
  return spans.filter(span => !covering.some(other => other.start <= span.start && other.end >= span.end && other.end - other.start > span.end - span.start)).length
}

export interface GlossaryConsistencyMatch {
  paragraph: Paragraph
  sequence: number
  state: 'standard' | 'check' | 'untranslated' | 'accepted'
  currentTranslations: string[]
}
export interface GlossaryAcceptance {
  glossaryId: number
  paragraphId: number
  en: string
  zh: string
  enText: string
  zhText: string
}

export function isGlossaryAccepted(paragraph: Pick<Paragraph, 'id' | 'enText' | 'zhText'>, entry: Pick<GlossaryEntry, 'en' | 'zh'> & { id?: number }, acceptances: GlossaryAcceptance[]): boolean {
  return acceptances.some(item => (entry.id === undefined || item.glossaryId === entry.id) && item.paragraphId === paragraph.id && item.en === entry.en && item.zh === entry.zh && item.enText === paragraph.enText && item.zhText === paragraph.zhText && !!paragraph.zhText.trim())
}

function editDistance(left: string, right: string): number {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1]
    for (let j = 0; j < right.length; j++) {
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(left[i] !== right[j])))
    }
    row = next
  }
  return row[right.length]
}

export function inferCurrentTranslations(enText: string, zhText: string, entry: Pick<GlossaryEntry, 'en' | 'zh'>): string[] {
  if (!containsWholeTerm(enText, entry.en) || !zhText.trim()) return []
  const standard = entry.zh.trim()
  const candidates = new Set<string>()
  // A standalone source term can be aligned to its standalone translation without guessing a span in a sentence.
  if (enText.normalize('NFC').trim() === entry.en.normalize('NFC').trim() &&
      /^[\p{Script=Han}·•・．.\s-]{1,40}$/u.test(zhText.trim()) && zhText.trim() !== standard) candidates.add(zhText.trim())
  const parts = standard.split(/[·•・．.]/u)
  // Anchor a distinctive name stem and a noun ending; do not infer arbitrary Chinese sentence spans.
  const suffix = ['鱼子酱', '奶酪', '牛肉', '火腿', '蜂蜜', '香肠', '大学', '学院', '公司', '群岛', '山脉'].find(ending => standard.endsWith(ending))
  if (suffix && /^[\p{Script=Han}]{4,20}$/u.test(standard)) {
    const stem = standard.slice(0, -suffix.length)
    if (stem.length >= 2) {
      for (const run of zhText.matchAll(/[\p{Script=Han}]+/gu)) {
        const text = run[0]
        for (let start = 0; start < text.length - stem.length; start++) {
          const candidateStem = text.slice(start, start + stem.length)
          const sharedPair = Array.from({ length: stem.length - 1 }, (_, index) => stem.slice(index, index + 2)).some(pair => candidateStem.includes(pair))
          if (!sharedPair || editDistance(candidateStem, stem) > 1) continue
          for (let extra = 0; extra <= 4; extra++) {
            const ending = start + stem.length + extra
            if (text.slice(ending, ending + suffix.length) !== suffix) continue
            const candidate = text.slice(start, ending + suffix.length)
            if (candidate !== standard && !candidate.includes(standard)) candidates.add(candidate)
            break
          }
        }
      }
    }
  }
  if (parts.length > 1 && parts.join('').length >= 4) {
    for (const match of zhText.matchAll(/[\p{Script=Han}]+(?:[·•・．.][\p{Script=Han}]+)+/gu)) {
      const candidate = match[0]
      const candidateParts = candidate.split(/[·•・．.]/u)
      if (candidate === standard || candidateParts.length !== parts.length) continue
      if (candidateParts.at(-1)!.length !== parts.at(-1)!.length) continue
      const normalized = candidateParts.join('')
      const target = parts.join('')
      if (candidateParts.some((part, index) => part === parts[index]) &&
          editDistance(normalized, target) <= Math.max(1, Math.floor(target.length * 0.2))) candidates.add(candidate)
    }
  }
  return [...candidates]
}

export interface GlossaryConsistencyAction {
  entry: Pick<GlossaryEntry, 'id' | 'en' | 'zh'>
  action: 'replace' | 'review' | 'doing'
  oldZh?: string
  paragraphs: Pick<Paragraph, 'id' | 'enText' | 'zhText' | 'status'>[]
}

export function checkGlossaryConsistency(paragraphs: Paragraph[], entry: Pick<GlossaryEntry, 'en' | 'zh'> & { id?: number }, acceptances: GlossaryAcceptance[] = [], entries: Pick<GlossaryEntry, 'en'>[] = []): GlossaryConsistencyMatch[] {
  const containingEntries = entries.filter(other => containsWholeTerm(other.en, entry.en))
  return paragraphs.flatMap((paragraph, index) => {
    if (!countIndependentTerm(paragraph.enText, entry.en, containingEntries)) return []
    const zh = paragraph.zhText.normalize('NFC')
    const currentTranslations = inferCurrentTranslations(paragraph.enText, paragraph.zhText, entry)
    return [{ paragraph, sequence: index + 1, currentTranslations, state: !zh.trim() ? 'untranslated' : isGlossaryAccepted(paragraph, entry, acceptances) ? 'accepted' : !currentTranslations.length && zh.includes(entry.zh.normalize('NFC').trim()) ? 'standard' : 'check' } as GlossaryConsistencyMatch]
  })
}
