import { describe, expect, it } from 'vitest'
import { DEFAULT_OCR, readOcrSettings, validateOcrSettings, ocrModel, orderOcrBlocks, joinOcrLines } from '../src/shared/ocr-settings'
import { ocrBlocks } from '../src/renderer/src/lib/ocr-blocks'
describe('Japanese OCR', () => {
  it('keeps existing projects English until explicitly configured', () => {
    expect(readOcrSettings({})).toEqual(DEFAULT_OCR)
    expect(ocrModel({ language: 'jpn', direction: 'horizontal' })).toBe('jpn')
    expect(ocrModel({ language: 'jpn', direction: 'vertical' })).toBe('jpn_vert')
    expect(() => validateOcrSettings({ language: 'eng', direction: 'vertical' })).toThrow()
    expect(() => validateOcrSettings({ language: 'invalid', direction: 'horizontal' } as never)).toThrow()
  })
  it('orders vertical columns right to left and joins Japanese without invented spaces', () => {
    const settings = { language: 'jpn' as const, direction: 'vertical' as const }
    expect(joinOcrLines(['日本語', 'を読む'], settings)).toBe('日本語を読む')
    expect(joinOcrLines(['今日 は 良い 天気 で す', 'English words'], settings)).toBe('今日は良い天気ですEnglish words')
    const blocks = [{ box: {left:.1,top:0,width:.1,height:.3} }, {box:{left:.8,top:.1,width:.1,height:.3}}]
    expect(orderOcrBlocks(blocks, settings)[0].box.left).toBe(.8)
    const result = ocrBlocks([{ text: 'wrong order', bbox: {x0:10,y0:10,x1:100,y1:100}, lines: [{text:'二列目',bbox:{x0:10,y0:10,x1:20,y1:100}},{text:'一列目',bbox:{x0:80,y0:10,x1:90,y1:100}}] }], 200,200,settings)
    expect(result[0].text).toBe('一列目二列目')
    expect(result[0].box.width).toBe(.45)
  })
})
