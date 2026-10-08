import { describe, expect, it } from 'vitest'
import { buildAssistantMessages } from '../src/main/services/assistant-context'

describe('buildAssistantMessages', () => {
  it('将当前段落、译文、前后文、术语和 MinerU 片段放入系统上下文', () => {
    const messages = buildAssistantMessages({
      bookTitle: 'A Guide to Everyday Science',
      pageNumber: 6,
      paragraphId: 21,
      currentEnglish: 'Food tells stories.',
      currentChinese: '食物讲述故事。',
      nearbyEnglish: ['Before.', 'After.'],
      documentSnippet: '# Food\nLonger context',
      glossary: [{ en: 'food', zh: '食物' }]
    }, [{ role: 'assistant', content: '上一轮回答' }], '有什么难点？')

    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('Food tells stories.')
    expect(messages[0].content).toContain('食物讲述故事。')
    expect(messages[0].content).toContain('food = 食物')
    expect(messages[0].content).toContain('Longer context')
    expect(messages.at(-1)).toEqual({ role: 'user', content: '有什么难点？' })
  })

  it('保留最近 12 条对话历史', () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: String(index)
    }))
    const messages = buildAssistantMessages({ bookTitle: 'Book' }, history, 'next')
    expect(messages).toHaveLength(14)
    expect(messages[1].content).toBe('8')
  })
})
