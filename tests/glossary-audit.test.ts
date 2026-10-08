import { describe, expect, it } from 'vitest'
import { auditGlossary } from '../src/shared/glossary-audit'
import type { GlossaryEntry, Paragraph } from '../src/shared/types'

const term = (id: number, en: string, zh: string): GlossaryEntry => ({ id, en, zh, category: '其他', note: '' })
const paragraph = (id: number, enText: string, zhText: string): Paragraph => ({ id, pageIdx: 0, type: 'paragraph', enText, zhText, status: zhText ? 'doing' : 'todo', bboxJson: '[]', rawBlock: '{}' })

describe('whole project glossary audit', () => {
  it('includes occurrence counts for consistent, inconsistent and unused terms', () => {
    const report = auditGlossary([paragraph(1, 'Rice and rice.', '大米和大米。'), paragraph(2, 'ricepaper', '米纸')], [term(1, 'rice', '大米'), term(2, 'maize', '玉米')])
    expect(report.termOccurrences).toEqual({ 1: 2, 2: 0 })
    expect(report.groups).toEqual([])
  })
  it('scans all terms and separates identified old names, uncertain translations and untranslated paragraphs', () => {
    const entries = [term(1, 'Petra Tajovský Pospěchová', '佩特拉·塔约夫斯基·波斯佩霍娃'), term(2, 'rice', '大米'), term(3, 'maize', '玉米')]
    const paragraphs = [
      paragraph(922, 'Petra Tajovský Pospěchová', '彼得拉·塔约夫斯基·波斯佩霍娃'),
      paragraph(2, 'rice is food.', '米饭是食物。'),
      paragraph(3, 'rice', ''),
      paragraph(4, 'maize', '玉米')
    ]
    const snapshot = JSON.stringify({ entries, paragraphs })
    const report = auditGlossary(paragraphs, entries)
    expect(report).toMatchObject({ termCount: 3, paragraphCount: 4, matchedTermCount: 3, standardCount: 1 })
    expect(report.groups.map(group => [group.entry.id, group.matches.map(match => match.auditState)])).toEqual([[1, ['different']], [2, ['uncertain', 'untranslated']]])
    expect(report.groups[0].matches[0]).toMatchObject({ sequence: 1, oldTranslations: ['彼得拉·塔约夫斯基·波斯佩霍娃'] })
    expect(JSON.stringify({ entries, paragraphs })).toBe(snapshot)
  })
  it('uses known old translations only when they actually occur in the matched paragraph', () => {
    const report = auditGlossary([paragraph(1, 'rice is food.', '米饭是食物。')], [term(1, 'rice', '大米')], { 1: ['稻米', '米饭', '米饭'] })
    expect(report.groups[0].matches[0]).toMatchObject({ auditState: 'different', oldTranslations: ['米饭'] })
  })
  it('does not classify multiple meanings or multiple old names as unambiguous differences', () => {
    const entries = [term(1, 'Belgium', '比利时'), term(2, 'Belgium', '贝尔吉姆')]
    const report = auditGlossary([paragraph(1, 'Belgium', '比利时')], entries)
    expect(report.groups[0].matches[0]).toMatchObject({ auditState: 'uncertain', oldTranslations: ['比利时'] })
    const multiple = auditGlossary([paragraph(1, 'rice is rice.', '米饭与稻米。')], [term(1, 'rice', '大米')], { 1: ['米饭', '稻米'] })
    expect(multiple.groups[0].matches[0].auditState).toBe('uncertain')
  })
  it('keeps multiple terms from the same paragraph as separate results and skips longer-word false matches', () => {
    const report = auditGlossary([paragraph(1, 'rice and maize', '米饭与玉蜀黍'), paragraph(2, 'ricepaper', '米纸')], [term(1, 'rice', '大米'), term(2, 'maize', '玉米')], { 1: ['米饭'], 2: ['玉蜀黍'] })
    expect(report.groups).toHaveLength(2)
    expect(report.groups.every(group => group.matches.length === 1 && group.matches[0].paragraph.id === 1)).toBe(true)
  })
})
