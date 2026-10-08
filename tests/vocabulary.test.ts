import { describe, expect, it } from 'vitest'
import { splitVocabularyText } from '../src/shared/vocabulary'

describe('splitVocabularyText', () => {
  it('highlights every whole-word occurrence without losing punctuation', () => {
    const parts = splitVocabularyText('Apple, then another apple.', [
      { en: 'apple', zh: '苹果', note: '', matchedText: 'apple' }
    ])
    expect(parts.map((part) => part.text).join('')).toBe('Apple, then another apple.')
    expect(parts.filter((part) => part.suggestionIndex === 0).map((part) => part.text))
      .toEqual(['Apple', 'apple'])
  })

  it('prefers a longer project phrase over an overlapping single word', () => {
    const parts = splitVocabularyText('sweet potato soup', [
      { en: 'sweet potato', zh: '甘薯', note: '', source: 'project' },
      { en: 'potato', zh: '土豆', note: '', source: 'dictionary' }
    ])
    expect(parts.find((part) => part.suggestionIndex !== undefined)).toMatchObject({
      text: 'sweet potato',
      suggestionIndex: 0
    })
  })
})
