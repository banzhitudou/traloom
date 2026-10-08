import { describe, expect, it } from 'vitest'
import { groupPdfText } from '../src/renderer/src/lib/pdf-blocks'

const item = (str: string, x: number, y: number, width = 80) => ({ str, width, height: 12, transform: [12,0,0,12,x,y], hasEOL: true })
describe('PDF text layer blocks', () => {
  it('joins adjacent lines, keeps a separated heading and column separate', () => {
    const blocks = groupPdfText([item('Title',30,760),item('First line',30,700),item('Second line',30,684),item('Other column',350,700)],600,800)
    expect(blocks.some(b => b.text === 'First line\nSecond line')).toBe(true)
    expect(blocks.find(b => b.text === 'Title')?.box.top).toBeCloseTo(.035)
    expect(blocks.every(b => b.box.left + b.box.width <= 1 && b.box.top + b.box.height <= 1)).toBe(true)
    expect(blocks.some(b => b.text === 'Other column')).toBe(true)
  })
  it('produces no blocks for blank pages', () => { expect(groupPdfText([],600,800)).toEqual([]) })
  it('includes descending glyphs below the text baseline', () => {
    const [block] = groupPdfText([item('garden',30,700)],600,800)
    expect(block.box.top + block.box.height).toBeGreaterThan((800 - 700) / 800)
  })
})
