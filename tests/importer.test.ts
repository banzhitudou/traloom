/**
 * importer 解析器单测。
 * 使用人工构造的样例，独立验证导入格式。
 */
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  parseContentJson,
  mergeModelCoordinates,
  parseGlossaryMd
} from '../src/main/services/importer'

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tw-test-'))
  const p = join(dir, name)
  writeFileSync(p, content, 'utf-8')
  return p
}

describe('parseContentJson', () => {
  it('扁平化嵌套页结构，提取各类型文本', () => {
    const json = JSON.stringify([
      // 页0
      [
        { type: 'title', bbox: [1, 2, 3, 4], content: { title_content: [{ type: 'text', content: 'Hello ' }] } },
        { type: 'paragraph', bbox: [5, 6, 7, 8], content: { paragraph_content: [{ type: 'text', content: 'World' }] } },
        { type: 'image', bbox: [9, 9, 9, 9], content: { image_caption: [] } }
      ],
      // 页1
      [
        { type: 'list', bbox: [1, 1, 1, 1], content: { list_items: [
          { item_content: [{ type: 'text', content: 'item1' }] },
          { item_content: [{ type: 'text', content: 'item2' }] }
        ] } }
      ]
    ])
    const p = tmpFile('t.json', json)
    const result = parseContentJson(p)

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ pageIdx: 0, type: 'title', enText: 'Hello' })
    expect(result[1]).toMatchObject({ pageIdx: 0, type: 'paragraph', enText: 'World' })
    expect(result[2]).toMatchObject({ pageIdx: 1, type: 'list', enText: 'item1 item2' })
  })

  it('跳过 image/page_number/page_aside_text 类型', () => {
    const json = JSON.stringify([[
      { type: 'image', bbox: [], content: { image_caption: [{ type: 'text', content: 'caption' }] } },
      { type: 'page_number', bbox: [], content: { page_number_content: [{ type: 'text', content: '5' }] } },
      { type: 'page_aside_text', bbox: [], content: { page_aside_text_content: [{ type: 'text', content: 'aside' }] } },
      { type: 'paragraph', bbox: [], content: { paragraph_content: [{ type: 'text', content: 'keep' }] } }
    ]])
    const result = parseContentJson(tmpFile('t.json', json))
    // image 有图注应保留？不——image 在 SKIP_TYPES，整块跳过
    expect(result).toHaveLength(1)
    expect(result[0].enText).toBe('keep')
  })

  it('跳过空文本块', () => {
    const json = JSON.stringify([[
      { type: 'paragraph', bbox: [], content: { paragraph_content: [] } },
      { type: 'paragraph', bbox: [], content: { paragraph_content: [{ type: 'text', content: '   ' }] } }
    ]])
    const result = parseContentJson(tmpFile('t.json', json))
    expect(result).toHaveLength(0)
  })

  it('兼容旧版扁平 content_list.json', () => {
    const json = JSON.stringify([
      { type: 'text', text: 'Chapter One', text_level: 1, page_idx: 0, bbox: [10, 20, 900, 80] },
      { type: 'text', text: 'First paragraph.', page_idx: 0, bbox: [10, 100, 900, 200] },
      { type: 'page_number', text: '1', page_idx: 0, bbox: [490, 950, 510, 980] }
    ])
    const result = parseContentJson(tmpFile('legacy.json', json))

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ pageIdx: 0, type: 'title', enText: 'Chapter One' })
    expect(result[1]).toMatchObject({ pageIdx: 0, type: 'paragraph', enText: 'First paragraph.' })
  })
})

describe('mergeModelCoordinates', () => {
  it('按页和原文匹配 model.json 的归一化坐标', () => {
    const paragraphs = [{
      pageIdx: 0,
      type: 'paragraph',
      enText: 'Food tells a story.',
      bboxJson: '[100,100,200,200]',
      rawBlock: '{}'
    }]
    const modelPath = tmpFile('model.json', JSON.stringify([[
      { type: 'text', content: 'Food tells a story.', bbox: [0.25, 0.1, 0.75, 0.4] }
    ]]))

    expect(mergeModelCoordinates(paragraphs, modelPath)[0].bboxJson)
      .toBe('[0.25,0.1,0.75,0.4]')
  })

  it('匹配不足时保留 content_list 原坐标', () => {
    const paragraphs = [{
      pageIdx: 0,
      type: 'paragraph',
      enText: 'Original paragraph',
      bboxJson: '[1,2,3,4]',
      rawBlock: '{}'
    }]
    const modelPath = tmpFile('model.json', JSON.stringify([[
      { type: 'text', content: 'Unrelated text', bbox: [0.1, 0.1, 0.2, 0.2] }
    ]]))

    expect(mergeModelCoordinates(paragraphs, modelPath)[0].bboxJson).toBe('[1,2,3,4]')
  })
})

describe('parseGlossaryMd', () => {
  it('按二级标题分类，解析四列表格', () => {
    const md = `# 术语对照表

## 一、食物名称

| 英文原文 | 建议中文译名 | 简短说明 | 出现频次 |
|---------|------------|---------|---------|
| sushi | 寿司 | 日本食物 | 4次 |
| pizza | 比萨 | 意大利食物 | 4次 |

## 二、营养学术语

| 英文原文 | 建议中文译名 | 简短说明 | 出现频次 |
|---------|------------|---------|---------|
| protein | 蛋白质 | 营养素 | 3次 |
`
    const result = parseGlossaryMd(tmpFile('t.md', md))
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ category: '食物名称', en: 'sushi', zh: '寿司', note: '日本食物' })
    expect(result[2]).toMatchObject({ category: '营养学术语', en: 'protein', zh: '蛋白质' })
  })

  it('跳过表头行', () => {
    const md = `## 分类

| 英文原文 | 建议中文译名 | 简短说明 | 出现频次 |
|---------|------------|---------|---------|
| taco | 塔可 | 墨西哥 | 1次 |
`
    const result = parseGlossaryMd(tmpFile('t.md', md))
    expect(result).toHaveLength(1)
    expect(result[0].en).toBe('taco')
  })
})
