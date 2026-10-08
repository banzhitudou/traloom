import { describe, expect, it } from 'vitest'
import { migrateReferenceSettings, validateReferenceSettings } from '../src/shared/reference-settings'
import { parseTranslationOptions } from '../src/shared/translation-options'

describe('user-controlled translation references', () => {
  it('keeps user instructions and selected count, rejects invalid input', () => {
    const profiles = [{ name: '默认', instructions: '' }, { name: '  自然表达  ', instructions: '  保留幽默感  ' }]
    expect(validateReferenceSettings({ count: 2, profiles })).toEqual({ count: 2, profiles: [{ name: '默认', instructions: '' }, { name: '自然表达', instructions: '保留幽默感' }] })
    for (const count of [0, 6, 1.5, NaN]) expect(() => validateReferenceSettings({ count, profiles })).toThrow()
    expect(() => validateReferenceSettings({ count: 3, profiles })).toThrow()
    expect(() => validateReferenceSettings({ count: 2, profiles: [profiles[0], { name: '默认', instructions: '' }] })).toThrow()
    expect(() => validateReferenceSettings({ count: 1, profiles: [{ name: '默认', instructions: '儿童读物' }] })).toThrow()
    expect(() => validateReferenceSettings({ count: 2, profiles: [profiles[0], { name: ' ', instructions: '' }] })).toThrow()
    expect(() => validateReferenceSettings({ count: 2, profiles: [profiles[0], { name: '其他', instructions: 'a'.repeat(12001) }] })).toThrow()
  })
  it('migrates existing instructions without changing the empty default', () => {
    expect(migrateReferenceSettings(1, '')).toEqual({ count: 1, profiles: [{ name: '默认', instructions: '' }] })
    expect(migrateReferenceSettings(1, ' 保留幽默感 ')).toEqual({ count: 2, profiles: [{ name: '默认', instructions: '' }, { name: '已有要求', instructions: '保留幽默感' }] })
    expect(migrateReferenceSettings(5, '').profiles).toHaveLength(5)
  })
  it('returns the requested number with neutral fallback labels', () => {
    const json = JSON.stringify({ options: [{ text: '甲' }, { text: '乙' }, { text: '丙' }] })
    expect(parseTranslationOptions(json, 2)).toEqual([{ label: '参考 1', text: '甲' }, { label: '参考 2', text: '乙' }])
  })
})
