import { describe, expect, it } from 'vitest'
import { highlightTerms, replaceOldTranslations, suggestOldTranslations } from '../src/shared/glossary-presentation'

describe('glossary replacement presentation', () => {
  it('highlights singular and regular plural forms without truncating the suffix', () => {
    const text = 'nutrient nutrients; box boxes; nutrient-rich'
    const parts = highlightTerms(text, ['nutrient', 'box'], true)
    expect(parts.filter(part => part.highlighted).map(part => part.text)).toEqual(['nutrient', 'nutrients', 'box', 'boxes', 'nutrient'])
    expect(parts.map(part => part.text).join('')).toBe(text)
  })
  it('highlights whole terms across line breaks and preserves the source verbatim', () => {
    const text = 'Petra Tajovský\nPospěchová; Petra Tajovský Pospěchovář. PETRA TAJOVSKÝ POSPĚCHOVÁ'
    const parts = highlightTerms(text, ['Petra Tajovský Pospěchová'], true)
    expect(parts.map(part => part.text).join('')).toBe(text)
    expect(parts.filter(part => part.highlighted).map(part => part.text)).toEqual(['Petra Tajovský\nPospěchová', 'PETRA TAJOVSKÝ POSPĚCHOVÁ'])
  })
  it('handles decomposed accents, punctuation and overlapping highlights', () => {
    const text = 'Pospěchová'.normalize('NFD')
    expect(highlightTerms(text, ['Pospěchová'], true)).toEqual([{ text, highlighted: true }])
    expect(highlightTerms('A+B (test).', ['A+B', '(test)'], true).filter(part => part.highlighted).map(part => part.text)).toEqual(['A+B', '(test)'])
    expect(highlightTerms('佩特拉·塔约夫斯基', ['佩特拉', '佩特拉·塔约夫斯基']).filter(part => part.highlighted)).toHaveLength(1)
  })
  it('suggests and counts several old names using history and aligned standalone terms', () => {
    const entry = { en: 'Petra', zh: '佩特拉' }
    const rows = [
      { enText: 'Petra', zhText: '彼得拉' },
      { enText: 'Petra writes.', zhText: '彼得拉写作。' },
      { enText: 'Petra', zhText: '佩特菈' },
      { enText: 'Petra writes.', zhText: '佩特菈写作。' },
      { enText: 'Petra', zhText: '佩特拉' },
      { enText: 'Other', zhText: '彼得拉' }
    ]
    expect(suggestOldTranslations(rows, entry, ['彼得拉', '不存在', '佩特拉'])).toEqual(expect.arrayContaining([{ text: '彼得拉', count: 2 }, { text: '佩特菈', count: 2 }]))
    expect(suggestOldTranslations(rows, entry, ['彼得拉', '不存在', '佩特拉'])).toHaveLength(2)
  })
  it('previews multiple replacements without cascading or modifying existing standard names', () => {
    expect(replaceOldTranslations('彼得拉和佩特菈，也叫佩特拉。', ['彼得拉', '佩特菈'], '佩特拉')).toBe('佩特拉和佩特拉，也叫佩特拉。')
    expect(replaceOldTranslations('佩特拉和特拉', ['特拉'], '佩特拉')).toBe('佩特拉和佩特拉')
    expect(replaceOldTranslations('ab a', ['a', 'ab'], 'abc')).toBe('abc abc')
    expect(replaceOldTranslations('a+b', ['a+b'], '$&')).toBe('$&')
    expect(replaceOldTranslations('原文', [], '标准')).toBe('原文')
  })
})
