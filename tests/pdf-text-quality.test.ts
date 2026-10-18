import { describe, expect, it } from 'vitest'
import { hasBrokenPdfText } from '../src/shared/pdf-text-quality'

const japanese = { language: 'jpn', direction: 'horizontal' } as const
const english = { language: 'eng', direction: 'horizontal' } as const

describe('PDF text layer quality', () => {
  it('rejects private glyph codes, replacement characters and embedded controls', () => {
    for (const text of ['\uF6B3\u000F\uF6B4\uF6B7', '\uE001', '\u{F0001}', '\uFFFD', 'k\u0001W']) {
      expect(hasBrokenPdfText(text, japanese)).toBe(true)
      expect(hasBrokenPdfText(text, english)).toBe(true)
    }
  })
  it('detects unrelated scripts from corrupt Japanese font maps', () => {
    expect(hasBrokenPdfText('օ٤ٚوס䏼全ք', japanese)).toBe(true)
    expect(hasBrokenPdfText('鞝\n꧅ ⱱ', japanese)).toBe(true)
  })
  it('preserves Japanese, Latin units, numbers, whitespace and math symbols', () => {
    for (const text of ['消費電力 2.36 kW', '−0.37kW 1.99 kW 約32.5%', 'CO₂ 50Hz 100V μm Ω ℃', '日本語\n本文\tです', 'café naïve']) {
      expect(hasBrokenPdfText(text, japanese)).toBe(false)
    }
  })
  it('does not apply the Japanese script heuristic to other languages', () => {
    expect(hasBrokenPdfText('العربية', english)).toBe(false)
  })
})
