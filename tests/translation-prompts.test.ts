import { expect, it } from 'vitest'
import { DEFAULT_REFERENCE_PROMPT_DISPLAY, DEFAULT_REFERENCE_INSTRUCTIONS, TRANSLATION_REFERENCE_ROLE, TRANSLATION_REFERENCE_RULES } from '../src/shared/translation-prompts'

it('displays the same fixed role, default instructions and rules as the prompt builder', () => {
  for (const value of [DEFAULT_REFERENCE_INSTRUCTIONS, TRANSLATION_REFERENCE_ROLE, TRANSLATION_REFERENCE_RULES]) expect(DEFAULT_REFERENCE_PROMPT_DISPLAY).toContain(value)
  expect(DEFAULT_REFERENCE_PROMPT_DISPLAY).toContain('调用时填入')
})
