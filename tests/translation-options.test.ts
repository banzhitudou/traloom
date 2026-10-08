import { describe, expect, it } from 'vitest'
import { parseTranslationOptions } from '../src/shared/translation-options'

describe('parseTranslationOptions', () => {
  it('解析模型返回的 JSON 候选', () => {
    const result = parseTranslationOptions(JSON.stringify({
      options: [
        { label: '贴近原文', text: '译文一' },
        { label: '自然出版', text: '译文二' },
        { label: '简洁儿童读物', text: '译文三' }
      ]
    }))

    expect(result).toEqual([
      { label: '贴近原文', text: '译文一' },
      { label: '自然出版', text: '译文二' },
      { label: '简洁儿童读物', text: '译文三' }
    ])
  })

  it('兼容旧的标题分段格式', () => {
    const result = parseTranslationOptions('【贴近原文】\n译文一\n【自然出版】\n译文二\n【简洁儿童读物】\n译文三')
    expect(result.map((option) => option.text)).toEqual(['译文一', '译文二', '译文三'])
  })
})
