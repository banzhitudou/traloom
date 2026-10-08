/**
 * 对齐算法单测。
 * 覆盖技术方案第 5.3 节列出的全部场景。
 */
import { describe, it, expect } from 'vitest'
import { similarityMatch, alignStats, type JsonBlock, type DraftPairInput } from '../src/main/services/aligner'

describe('similarityMatch', () => {
  it('完全匹配（相似度100%）', () => {
    const drafts: DraftPairInput[] = [
      { en: 'The things we eat can work as medicine.', zh: '我们吃的能当药。' }
    ]
    const json: JsonBlock[] = [
      { id: 1, en: 'The things we eat can work as medicine.' }
    ]
    const r = similarityMatch(drafts, json)
    expect(r).toHaveLength(1)
    expect(r[0].status).toBe('aligned')
    expect(r[0].similarity).toBe(1)
    expect(r[0].zh).toBe('我们吃的能当药。')
  })

  it('轻微差异（标点/大小写不同）仍对齐', () => {
    const drafts: DraftPairInput[] = [
      { en: 'Food is great!', zh: '食物很好！' }
    ]
    const json: JsonBlock[] = [
      { id: 1, en: 'food is great' }
    ]
    const r = similarityMatch(drafts, json)
    expect(r[0].status).toBe('aligned')
  })

  it('顺序多段都能对齐', () => {
    const drafts: DraftPairInput[] = [
      { en: 'First sentence here.', zh: '第一句。' },
      { en: 'Second sentence now.', zh: '第二句。' },
      { en: 'Third one follows.', zh: '第三句。' }
    ]
    const json: JsonBlock[] = [
      { id: 1, en: 'First sentence here.' },
      { id: 2, en: 'Second sentence now.' },
      { id: 3, en: 'Third one follows.' }
    ]
    const r = similarityMatch(drafts, json)
    expect(r.every((x) => x.status === 'aligned')).toBe(true)
    expect(r.map((x) => x.jsonId)).toEqual([1, 2, 3])
  })

  it('json 多出块（如图注）时滑动窗口跳过', () => {
    const drafts: DraftPairInput[] = [
      { en: 'Alpha block text.', zh: '甲。' },
      { en: 'Gamma block text.', zh: '丙。' }
    ]
    const json: JsonBlock[] = [
      { id: 1, en: 'Alpha block text.' },
      { id: 2, en: 'Image caption that is not in draft' },  // 多出的图注
      { id: 3, en: 'Gamma block text.' }
    ]
    const r = similarityMatch(drafts, json)
    expect(r[0].jsonId).toBe(1)
    expect(r[1].jsonId).toBe(3)
    expect(r.every((x) => x.status === 'aligned')).toBe(true)
  })

  it('粒度差异：多个 draft 段 = 1 个 json 块（合并匹配）', () => {
    const drafts: DraftPairInput[] = [
      { en: 'The quick brown', zh: '敏捷的棕色' },
      { en: 'fox jumps over', zh: '狐狸跳过' },
      { en: 'the lazy dog', zh: '懒狗' }
    ]
    const json: JsonBlock[] = [
      { id: 1, en: 'The quick brown fox jumps over the lazy dog' }
    ]
    const r = similarityMatch(drafts, json)
    // 三段都应对齐到 json 块 1
    expect(r).toHaveLength(3)
    expect(r.every((x) => x.status === 'aligned')).toBe(true)
    expect(r.every((x) => x.jsonId === 1)).toBe(true)
  })

  it('完全不相关的内容标记为 pending', () => {
    const drafts: DraftPairInput[] = [
      { en: 'Completely different topic about space', zh: '完全不同的话题' }
    ]
    const json: JsonBlock[] = [
      { id: 1, en: 'Cooking recipes and food history' }
    ]
    const r = similarityMatch(drafts, json)
    expect(r[0].status).toBe('pending')
  })

  it('草稿比 json 多（末尾有未配对英文）', () => {
    const drafts: DraftPairInput[] = [
      { en: 'Matched content here', zh: '匹配的内容' },
      { en: 'Extra trailing content with unique words', zh: '多余的尾部内容' }
    ]
    const json: JsonBlock[] = [
      { id: 1, en: 'Matched content here' }
    ]
    const r = similarityMatch(drafts, json)
    expect(r[0].status).toBe('aligned')
    expect(r[1].status).toBe('pending')
  })
})

describe('alignStats', () => {
  it('正确统计覆盖率', () => {
    const results = [
      { jsonId: 1, draftIdx: 0, similarity: 1, status: 'aligned' as const, enMd: '', enJson: '', zh: '' },
      { jsonId: 2, draftIdx: 1, similarity: 1, status: 'aligned' as const, enMd: '', enJson: '', zh: '' },
      { jsonId: 3, draftIdx: 2, similarity: 0.1, status: 'pending' as const, enMd: '', enJson: '', zh: '' }
    ]
    const s = alignStats(results)
    expect(s).toEqual({ total: 3, aligned: 2, pending: 1, coverage: 66.7 })
  })
})
