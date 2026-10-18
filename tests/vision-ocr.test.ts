import { describe, expect, it } from 'vitest'
import { parseVisionOcr, VISION_OCR_PROMPT } from '../src/shared/vision-ocr'

describe('vision OCR transcription', () => {
  it('preserves numbers, units and Japanese text', () => {
    expect(parseVisionOcr('{"text":"消費電力 2.36 kW\\n-0.37kW"}')).toBe('消費電力 2.36 kW\n-0.37kW')
    expect(parseVisionOcr('```json\n{"text":"原文"}\n```')).toBe('原文')
  })
  it('rejects empty, malformed and truncated results', () => {
    for (const text of ['', 'plain text', '{"text":""}', '{"text":12}', '{"text":"abc']) expect(() => parseVisionOcr(text)).toThrow()
  })
  it('requests faithful transcription rather than translation', () => {
    expect(VISION_OCR_PROMPT).toContain('绝不翻译')
    expect(VISION_OCR_PROMPT).toContain('不要猜测')
  })
})
