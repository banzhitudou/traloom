import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/main/services/glossary-service', () => ({ filterTermsForSegment: () => [], formatTermsForPrompt: () => '无' }))
import { buildTranslationOptionsPrompt } from '../src/main/services/prompt-builder'

describe('named translation references', () => {
  it('sends every profile name and its own instructions in order', () => {
    const profiles = [{ name: '默认', instructions: '' }, { name: '文学', instructions: '保留意象' }, { name: '严谨', instructions: '使用学术表达' }]
    const prompt = buildTranslationOptionsPrompt({ enText: 'A garden.', profiles })
    expect(prompt.user).toContain('3 条中文译文参考')
    expect(prompt.user).toContain('每个方案的翻译要求只适用于该方案')
    expect(prompt.user).toContain('不预设特定读者年龄或文体')
    expect(prompt.user).toContain('保留意象')
    expect(prompt.user).toContain('使用学术表达')
    expect(prompt.user).toContain(JSON.stringify({ options: profiles.map(profile => ({ label: profile.name, text: '译文' })) }))
  })
})
