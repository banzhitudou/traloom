import { describe, expect, it } from 'vitest'
import { mergeParagraphData, type MergeParagraphInput } from '../src/shared/paragraph-structure'

const rows: MergeParagraphInput[] = [
  {
    id: 31,
    type: 'paragraph',
    enText: 'Every year, a third of all food',
    zhText: '每年，三分之一的食物',
    status: 'done',
    bboxJson: '[100,100,400,200]',
    rawBlock: '{"source":"ocr"}'
  },
  {
    id: 32,
    type: 'paragraph',
    enText: 'produced ends up in the dustbin.',
    zhText: '最终都被扔进垃圾桶。',
    status: 'doing',
    bboxJson: '[100,220,500,320]',
    rawBlock: '{"source":"ocr"}'
  }
]

describe('mergeParagraphData', () => {
  it('按页面顺序合并原文、译文和所有 PDF 坐标', () => {
    const merged = mergeParagraphData(rows)
    expect(merged.enText).toBe('Every year, a third of all food produced ends up in the dustbin.')
    expect(merged.zhText).toBe('每年，三分之一的食物\n\n最终都被扔进垃圾桶。')
    expect(merged.status).toBe('review')
    expect(JSON.parse(merged.bboxJson)).toEqual([
      [100, 100, 400, 200],
      [100, 220, 500, 320]
    ])
    expect(JSON.parse(merged.rawBlock).mergedParagraphIds).toEqual([31, 32])
  })

  it('没有译文时回到待翻译状态', () => {
    const merged = mergeParagraphData(rows.map((row) => ({ ...row, zhText: '' })))
    expect(merged.zhText).toBe('')
    expect(merged.status).toBe('todo')
  })
})
