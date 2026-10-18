import { describe, expect, it } from 'vitest'
import { applyPdfRecovery, isLatinPdfBlock, markBrokenPdfFonts } from '../src/renderer/src/lib/pdf-text-recovery'
import { groupPdfText, type PdfTextItem } from '../src/renderer/src/lib/pdf-blocks'

const settings = { language: 'jpn', direction: 'horizontal' } as const
const item = (str: string, fontName: string, x: number, y = 80): PdfTextItem => ({ str, fontName, transform: [10, 0, 0, 10, x, y], width: 20, height: 10 })

describe('font-level PDF recovery', () => {
  it('preserves failed regions for review instead of aborting the page', () => {
    const block = { text: '\uF6B3', box: { left: .1, top: .2, width: .1, height: .1 } }
    const unresolved = applyPdfRecovery(block, '   ')
    expect(unresolved).toEqual({ ...block, ocrUnresolved: true })
    expect(applyPdfRecovery(unresolved, ' 2.36 ')).toEqual({ ...block, text: '2.36', ocrUnresolved: false })
    expect(block.text).toBe('\uF6B3')
  })
  it('also marks printable but wrongly mapped units in the damaged font', () => {
    const items = markBrokenPdfFonts([item('\uF6B3', 'broken', 0), item('L 8', 'broken', 80), item('正文', 'good', 160)], settings)
    expect(items.map(item => item.needsOcr)).toEqual([true, true, false])
    const blocks = groupPdfText(items, 200, 200, undefined, true)
    expect(blocks.find(block => block.text === 'L 8')?.needsOcr).toBe(true)
    expect(blocks.find(block => block.text === '正文')?.needsOcr).toBeUndefined()
  })
  it('keeps the recovery flag when adjacent lines are grouped', () => {
    const items = [item('normal', 'good', 0), { ...item('bad', 'broken', 0, 67), needsOcr: true }]
    const blocks = groupPdfText(items, 200, 200)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].needsOcr).toBe(true)
  })
  it('uses Latin recognition for numeric glyphs and units, not Japanese labels', () => {
    expect(isLatinPdfBlock('\uF6B3\u000F\uF6B4\uF6B7')).toBe(true)
    expect(isLatinPdfBlock('L 8')).toBe(true)
    expect(isLatinPdfBlock('消費電力')).toBe(false)
    expect(isLatinPdfBlock('օ٤ٚوס䏼全ք')).toBe(false)
    expect(isLatinPdfBlock('ٜ٭ٖةآت')).toBe(false)
    expect(isLatinPdfBlock('')).toBe(false)
  })
  it('does not mutate the original text items', () => {
    const original = item('\uF6B3', 'broken', 0)
    markBrokenPdfFonts([original], settings)
    expect(original.needsOcr).toBeUndefined()
  })
})
