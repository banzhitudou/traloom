import { describe, expect, it } from 'vitest'
import { parseNormalizedBbox, parseNormalizedBboxes, serializeNormalizedBboxes } from '../src/shared/bbox'

describe('parseNormalizedBbox', () => {
  it('归一化 content_list 的 0-1000 坐标', () => {
    expect(parseNormalizedBbox('[100,200,600,800]')).toEqual({
      left: 0.1,
      top: 0.2,
      width: 0.5,
      height: 0.6000000000000001
    })
  })

  it('保留 model.json 的 0-1 坐标', () => {
    expect(parseNormalizedBbox('[0.25,0.1,0.75,0.4]')).toEqual({
      left: 0.25,
      top: 0.1,
      width: 0.5,
      height: 0.30000000000000004
    })
  })

  it('拒绝无效坐标', () => {
    expect(parseNormalizedBbox('[]')).toBeNull()
    expect(parseNormalizedBbox('[1,2,1,4]')).toBeNull()
    expect(parseNormalizedBbox('not-json')).toBeNull()
  })

  it('保留合并翻译段的多个坐标框', () => {
    expect(parseNormalizedBboxes('[[100,100,300,200],[500,600,900,800]]')).toEqual([
      { left: 0.1, top: 0.1, width: 0.19999999999999998, height: 0.1 },
      { left: 0.5, top: 0.6, width: 0.4, height: 0.20000000000000007 }
    ])
    expect(parseNormalizedBbox('[[100,100,300,200],[500,600,900,800]]')).toEqual({
      left: 0.1,
      top: 0.1,
      width: 0.8,
      height: 0.7000000000000001
    })
  })

  it('保存时区分单框和多框结构', () => {
    const boxes = [
      { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
      { left: 0.6, top: 0.1, width: 0.2, height: 0.25 }
    ]
    expect(serializeNormalizedBboxes([boxes[0]])).toBe('[0.1,0.2,0.4,0.6000000000000001]')
    expect(serializeNormalizedBboxes(boxes)).toBe('[[0.1,0.2,0.4,0.6000000000000001],[0.6,0.1,0.8,0.35]]')
    expect(parseNormalizedBboxes(serializeNormalizedBboxes(boxes))).toHaveLength(2)
  })
})
