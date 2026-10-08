import { describe, expect, it } from 'vitest'
import { containsWholeTerm, countWholeTerm, countIndependentTerm, checkGlossaryConsistency, glossaryCategoryOptions, inferCurrentTranslations } from '../src/shared/glossary-check'
import type { Paragraph } from '../src/shared/types'

describe('glossary checks', () => {
  it('matches regular s/es plurals with word boundaries and phrase precedence', () => {
    expect(countWholeTerm('nutrient nutrients nutrient-rich nutritionally', 'nutrient')).toBe(3)
    expect(countWholeTerm('boxes box boxing', 'box')).toBe(2)
    expect(countWholeTerm('dishes dish dishwasher', 'dish')).toBe(2)
    expect(countWholeTerm('microwave ovens and ovens', 'microwave oven')).toBe(1)
    expect(countIndependentTerm('microwave ovens and ovens', 'oven', [{ en: 'microwave oven' }])).toBe(1)
    expect(containsWholeTerm('Pospěchovás', 'Pospěchová')).toBe(false)
  })
  it('gives registered phrases precedence without hiding separate word occurrences', () => {
    const entries = [{ en: 'oven', zh: '烤箱' }, { en: 'microwave oven', zh: '微波炉' }]
    const paragraph = { id: 1, enText: 'The microwave\noven.', zhText: '微波炉。' } as Paragraph
    expect(checkGlossaryConsistency([paragraph], entries[0], [], entries)).toEqual([])
    expect(checkGlossaryConsistency([paragraph], entries[1], [], entries)[0].state).toBe('standard')
    expect(countIndependentTerm('MICROWAVE oven and an oven', 'oven', entries)).toBe(1)
    expect(countIndependentTerm('microwave ovens', 'oven', entries)).toBe(0)
    expect(checkGlossaryConsistency([{ ...paragraph, enText: 'microwave oven and oven' }], entries[0], [], entries)[0].state).toBe('check')
    expect(checkGlossaryConsistency([paragraph], entries[0], [], [entries[0]])[0].state).toBe('check')
    expect(countIndependentTerm('a large microwave oven', 'microwave oven', [...entries, { en: 'large microwave oven', zh: '大微波炉' }])).toBe(0)
  })
  it('counts actual normalized whole-term occurrences rather than matched paragraphs', () => {
    expect(countWholeTerm('Rice, rice and ricepaper. RICE!', 'rice')).toBe(3)
    expect(countWholeTerm('Petra\nTajovský; PETRA Tajovský', 'Petra Tajovský')).toBe(2)
    expect(countWholeTerm('Pospe\u030cchová and Pospěchová', 'Pospěchová')).toBe(2)
    expect(countWholeTerm('rice', '')).toBe(0)
  })
  it('identifies expanded cheese-name variants without selecting surrounding prose or unrelated cheeses', () => {
    const entry = { en: 'Roquefort', zh: '洛克福奶酪' }
    expect(inferCurrentTranslations('French shepherds used blue roquefort cheese.', '从前，法国牧羊人会把罗克福蓝纹奶酪撒在割伤擦伤处。', entry)).toEqual(['罗克福蓝纹奶酪'])
    expect(inferCurrentTranslations('Roquefort and Brie', '洛克福奶酪和布里奶酪', entry)).toEqual([])
    expect(inferCurrentTranslations('Roquefort', '罗克福蓝纹奶酪', entry)).toEqual(['罗克福蓝纹奶酪'])
    expect(inferCurrentTranslations('Other cheese', '罗克福蓝纹奶酪', entry)).toEqual([])
    expect(inferCurrentTranslations('Roquefort cheese', '法国牧羊人喜欢蓝纹奶酪。', entry)).toEqual([])
    const paragraph = { id: 1, pageIdx: 0, type: 'paragraph' as const, enText: 'Roquefort cheese', zhText: '洛克福奶酪，也译罗克福蓝纹奶酪。', status: 'doing' as const, bboxJson: '[]', rawBlock: '{}' }
    expect(checkGlossaryConsistency([paragraph], entry)[0].state).toBe('check')
  })
  it('finds an existing author translation without needing glossary change history', () => {
    const entry = { en: 'Petra Tajovský Pospěchová', zh: '佩特拉·塔约夫斯基·波斯佩霍娃' }
    expect(inferCurrentTranslations(entry.en, '彼得拉·塔约夫斯基·波斯佩霍娃', entry)).toEqual(['彼得拉·塔约夫斯基·波斯佩霍娃'])
    expect(inferCurrentTranslations(entry.en + ' Illustrated by Jakub Bachorík', '作者：彼得拉·塔约夫斯基·波斯佩霍娃\n插图：雅库布·巴霍里克', entry)).toEqual(['彼得拉·塔约夫斯基·波斯佩霍娃'])
    expect(inferCurrentTranslations(entry.en, entry.zh, entry)).toEqual([])
  })
  it('does not extract unrelated names or surrounding prose as the old translation', () => {
    const entry = { en: 'Petra Tajovský Pospěchová', zh: '佩特拉·塔约夫斯基·波斯佩霍娃' }
    expect(inferCurrentTranslations('Jakub Bachorík', '雅库布·巴霍里克', entry)).toEqual([])
    expect(inferCurrentTranslations(entry.en + ' writes.', '雅库布·巴霍里克写作。', entry)).toEqual([])
    expect(inferCurrentTranslations(entry.en + ' writes.', '彼得拉·塔约夫斯基·波斯佩霍娃写作。', entry)).toEqual([])
    expect(inferCurrentTranslations('rice is food.', '米饭是食物。', { en: 'rice', zh: '大米' })).toEqual([])
  })
  it('keeps multiple plausible old translations available for explicit selection', () => {
    const entry = { en: 'Petra Tajovský Pospěchová', zh: '佩特拉·塔约夫斯基·波斯佩霍娃' }
    expect(inferCurrentTranslations(entry.en + ' writes.', '彼得拉·塔约夫斯基·波斯佩霍娃，又译：佩特拉·塔约夫斯基·波斯佩霍瓦', entry)).toHaveLength(2)
  })
  it('supports custom categories alongside built-in and existing choices', () => {
    const categories = glossaryCategoryOptions(['捷克人名', '  人名  ', '其他', ''])
    expect(categories).toContain('捷克人名')
    expect(categories).toContain('地名')
    expect(categories.filter(category => category === '人名')).toHaveLength(1)
  })
  it('matches Unicode terms without matching inside longer words', () => {
    expect(containsWholeTerm('Petra Tajovský\nPospěchová', 'Petra Tajovský Pospěchová')).toBe(true)
    expect(containsWholeTerm('POSPĚCHOVÁ', 'Pospěchová')).toBe(true)
    expect(containsWholeTerm('Pospěchová'.normalize('NFD'), 'Pospěchová')).toBe(true)
    expect(containsWholeTerm('Pospěchovář', 'Pospěchová')).toBe(false)
    expect(containsWholeTerm('éRice', 'Rice')).toBe(false)
    expect(containsWholeTerm('Rice2', 'Rice')).toBe(false)
    expect(containsWholeTerm('Анна', 'Анна')).toBe(true)
    expect(containsWholeTerm('rice', '')).toBe(false)
  })
  it('returns ordered read-only candidates rather than automatically treating them as mistakes', () => {
    const rows: Paragraph[] = [
      { id: 922, pageIdx: 6, type: 'paragraph', enText: 'Petra writes.', zhText: '佩特拉写作。', status: 'done', bboxJson: '[]', rawBlock: '{}' },
      { id: 29, pageIdx: 6, type: 'paragraph', enText: 'Petra writes.', zhText: '彼得拉写作。', status: 'doing', bboxJson: '[]', rawBlock: '{}' },
      { id: 30, pageIdx: 6, type: 'paragraph', enText: 'Other text.', zhText: '', status: 'todo', bboxJson: '[]', rawBlock: '{}' },
      { id: 31, pageIdx: 6, type: 'paragraph', enText: 'Petra writes.', zhText: '', status: 'todo', bboxJson: '[]', rawBlock: '{}' }
    ]
    const before = JSON.stringify(rows)
    expect(checkGlossaryConsistency(rows, { en: 'Petra', zh: '佩特拉' }).map(match => [match.paragraph.id, match.sequence, match.state])).toEqual([[922, 1, 'standard'], [29, 2, 'check'], [31, 4, 'untranslated']])
    expect(JSON.stringify(rows)).toBe(before)
  })
})
