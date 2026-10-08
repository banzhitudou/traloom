import { describe, expect, it } from 'vitest'
import {
  extractProperNounCandidates,
  getReaderVocabulary
} from '../src/main/services/reader-vocabulary'

describe('reader vocabulary', () => {
  it('finds concise offline English-Chinese definitions', () => {
    const suggestions = getReaderVocabulary('She put an apple beside the bicycle.', [])
    expect(suggestions.map((item) => item.en.toLowerCase())).toContain('apple')
    expect(suggestions.find((item) => item.en.toLowerCase() === 'apple')?.zh).toBe('苹果')
    expect(suggestions.find((item) => item.en.toLowerCase() === 'bicycle')?.zh).toBe('自行车')
  })

  it('resolves common inflected forms through their lemma', () => {
    const suggestions = getReaderVocabulary('They hugged and carried apples.', [])
    expect(suggestions.find((item) => item.en.toLowerCase() === 'apples')?.zh).toBe('苹果')
  })

  it('keeps all source definitions even with a one-word limit', () => {
    const suggestions = getReaderVocabulary('The apple was sliced.', [
      { en: 'apple', zh: '苹果（项目指定）', note: '编辑锁定', source: 'glossary' },
      { en: 'apple', zh: '阿普尔', source: 'name' },
      { en: 'apple', zh: '阿普尔镇', source: 'place' },
      { en: 'apple', zh: '苹果公司', source: 'glossary' }
    ], 1)
    expect(suggestions.filter((item) => item.matchedText?.toLowerCase() === 'apple')).toHaveLength(5)
    expect(suggestions.map((item) => item.source)).toEqual(expect.arrayContaining(['glossary', 'name', 'place', 'dictionary']))
    expect(suggestions[0]).toMatchObject({
      en: 'apple',
      zh: '苹果（项目指定）',
      source: 'glossary'
    })
  })

  it('keeps glossary, name and place sources distinct', () => {
    const suggestions = getReaderVocabulary('Roald Dahl travelled to Brno for chocolate.', [
      { en: 'chocolate', zh: '巧克力', source: 'glossary' },
      { en: 'Roald Dahl', zh: '罗尔德·达尔', source: 'name' },
      { en: 'Brno', zh: '布尔诺', source: 'place' }
    ])
    expect(suggestions.map((item) => [item.matchedText, item.source])).toEqual(expect.arrayContaining([
      ['Roald Dahl', 'name'],
      ['Brno', 'place'],
      ['chocolate', 'glossary']
    ]))
  })

  it('extracts capitalized phrases and their useful subphrases', () => {
    const candidates = extractProperNounCandidates('Emperor Rudolf II admired Giuseppe Arcimboldo in Brno.')
    expect(candidates).toContain('Rudolf II')
    expect(candidates).toContain('Giuseppe Arcimboldo')
    expect(candidates).toContain('Brno')
  })
})
