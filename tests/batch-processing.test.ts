import { describe, expect, it } from 'vitest'
import { canApplyBatch, parseBatchOutput, validateBatchScope, validateCleanedText, type BatchCandidate } from '../src/shared/batch-processing'

describe('Batch protection and validation', () => {
  const item: BatchCandidate = { id: 1, sequence: 1, pageIdx: 0, source: 'A\nline.', draft: '', status: 'todo', identity: 'uuid', state: 'candidate' }
  const live = { en_text: item.source, zh_text: '', status: 'todo', identity: 'uuid' }
  it('validates human-visible paragraph ranges', () => {
    expect(validateBatchScope({ task: 'clean' }, 10)).toEqual({ task: 'clean', from: 1, to: 10 })
    expect(() => validateBatchScope({ task: 'translate', from: 0 }, 10)).toThrow()
    expect(() => validateBatchScope({ task: 'clean', to: 11 }, 10)).toThrow()
    expect(() => validateBatchScope({ task: 'clean', from: 2.5 }, 10)).toThrow()
    expect(() => validateBatchScope({ task: 'other' } as never, 10)).toThrow()
  })
  it('never overwrites changes or an existing draft, regardless of status', () => {
    expect(canApplyBatch(item, live)).toBe(true)
    for (const changed of [{ ...live, zh_text: '人工译文' }, { ...live, en_text: 'Edited' }, { ...live, status: 'done' }, { ...live, identity: 'new uuid' }]) expect(canApplyBatch(item, changed)).toBe(false)
    expect(canApplyBatch(item)).toBe(false)
  })
  it('requires complete structured output', () => {
    expect(parseBatchOutput('```json\n{"text":"一行"}\n```')).toBe('一行')
    for (const invalid of ['{"text":"truncated', 'plain text', '{}', '{"text":12}', '{"text":""}']) expect(() => parseBatchOutput(invalid)).toThrow()
  })
  it('permits only whitespace and line-break hyphen repairs', () => {
    expect(() => validateCleanedText('A\nline.', 'A line.')).not.toThrow()
    expect(() => validateCleanedText('some-\nthing', 'something')).not.toThrow()
    expect(() => validateCleanedText('well-\nknown', 'well-known')).not.toThrow()
    expect(() => validateCleanedText('well-known\nfood', 'wellknown food')).toThrow()
    expect(() => validateCleanedText('Hello (world).\nYes!', 'Hello (world). Yes!')).not.toThrow()
    expect(() => validateCleanedText('A\nline.', 'Another line.')).toThrow()
    expect(() => validateCleanedText('A\nline.', 'A line!')).toThrow()
  })
})
