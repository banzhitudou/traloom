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
  it('does not insert English word spaces between Japanese text-layer fragments', () => {
    const first = { ...item('日本', 30,700,24), hasEOL: false }
    const [block] = groupPdfText([first,item('語',54,700,12)],600,800,[1,0,0,-1,0,800],true)
    expect(block.text).toBe('日本語')
  })
  it.each([90, 180, 270])('follows text rotated by %i degrees and joins its lines', degrees => {
    const angle = degrees * Math.PI / 180
    const u = [Math.cos(angle), Math.sin(angle)]
    const rotated = (str: string, offset: number) => ({
      str, width: 80, height: 12, hasEOL: true,
      transform: [12 * u[0], 12 * u[1], -12 * u[1], 12 * u[0], 300 + offset * u[1], 400 - offset * u[0]]
    })
    const blocks = groupPdfText([rotated('First line', 0), rotated('Second line', 16)], 600, 800)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('First line\nSecond line')
    expect(blocks[0].box.width * 600).toBeCloseTo(degrees === 180 ? 80 : 30.4)
    expect(blocks[0].box.height * 800).toBeCloseTo(degrees === 180 ? 30.4 : 80)
  })
  it('applies the full rotated page viewport, including its origin', () => {
    const [block] = groupPdfText([item('Rotated page', 30, 700)], 800, 600, [0, 1, 1, 0, 0, 0])
    expect(block.box.left * 800).toBeCloseTo(697.6)
    expect(block.box.top * 600).toBeCloseTo(30)
    expect(block.box.width * 800).toBeCloseTo(14.4)
    expect(block.box.height * 600).toBeCloseTo(80)
  })
  it('clips partially off-page text without inflating its box', () => {
    const [block] = groupPdfText([item('Clipped', -20, 795)], 600, 800)
    expect(block.box.left).toBe(0)
    expect(block.box.top).toBe(0)
    expect(block.box.width * 600).toBeCloseTo(60)
    expect(groupPdfText([item('Outside', 700, 900)], 600, 800)).toEqual([])
  })
  it('includes descending glyphs below the text baseline', () => {
    const [block] = groupPdfText([item('garden',30,700)],600,800)
    expect(block.box.top + block.box.height).toBeGreaterThan((800 - 700) / 800)
  })
})
