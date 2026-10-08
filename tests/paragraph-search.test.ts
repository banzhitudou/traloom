import { describe, expect, it } from 'vitest'
import type { Paragraph } from '../src/shared/types'
import { searchParagraphs } from '../src/shared/paragraph-search'

const paragraphs: Paragraph[] = [
  { id: 1, pageIdx: 0, type: 'paragraph', enText: 'An apple a day', zhText: '一天一个苹果', status: 'done', bboxJson: '[]', rawBlock: '{}' },
  { id: 2, pageIdx: 1, type: 'paragraph', enText: 'A pear is green', zhText: '梨子是绿色的', status: 'doing', bboxJson: '[]', rawBlock: '{}' },
  { id: 3, pageIdx: 2, type: 'paragraph', enText: 'Apple pie', zhText: '苹果派', status: 'todo', bboxJson: '[]', rawBlock: '{}' }
]

describe('searchParagraphs', () => {
  it('同时搜索原文和译稿且英文不区分大小写', () => {
    expect(searchParagraphs(paragraphs, 'APPLE', 'all').map((result) => result.paragraph.id)).toEqual([1, 3])
    expect(searchParagraphs(paragraphs, '苹果', 'all').map((result) => result.paragraph.id)).toEqual([1, 3])
  })

  it('可限定只搜索原文或译稿', () => {
    expect(searchParagraphs(paragraphs, '梨子', 'en')).toEqual([])
    expect(searchParagraphs(paragraphs, 'pear', 'zh')).toEqual([])
    expect(searchParagraphs(paragraphs, 'pear', 'en')[0]?.enMatched).toBe(true)
  })
})
