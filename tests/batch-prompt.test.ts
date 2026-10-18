import { expect, it, vi } from 'vitest'
vi.mock('../src/main/services/glossary-service', () => ({ filterTermsForSegment: () => [], formatTermsForPrompt: () => '无' }))
import { buildDraftTranslationPrompt, buildOcrLineBreakPrompt } from '../src/main/services/prompt-builder'

it('draft generation uses only its independent instructions and asks for one complete translation', () => {
  const prompt = buildDraftTranslationPrompt('Original', '保持术语，使用正式语体')
  expect(prompt.system).toContain('保持术语，使用正式语体')
  expect(prompt.system).toContain('忠实原意')
  expect(prompt.system).not.toContain('儿童')
  expect(prompt.user).toContain('完整中文译文')
  expect(prompt.user).not.toContain('options')
  expect(buildOcrLineBreakPrompt('A\nline').system).toContain('不跨翻译段合并')
})
