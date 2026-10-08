import type { Paragraph } from './types'

export type ParagraphSearchScope = 'all' | 'en' | 'zh'

export interface ParagraphSearchResult {
  paragraph: Paragraph
  enMatched: boolean
  zhMatched: boolean
}

export function searchParagraphs(
  paragraphs: Paragraph[],
  query: string,
  scope: ParagraphSearchScope
): ParagraphSearchResult[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []

  return paragraphs.flatMap((paragraph) => {
    const enMatched = scope !== 'zh' && paragraph.enText.toLocaleLowerCase().includes(needle)
    const zhMatched = scope !== 'en' && paragraph.zhText.toLocaleLowerCase().includes(needle)
    return enMatched || zhMatched ? [{ paragraph, enMatched, zhMatched }] : []
  })
}
