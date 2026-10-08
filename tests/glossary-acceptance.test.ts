import { describe, expect, it } from 'vitest'
import { checkGlossaryConsistency, isGlossaryAccepted, type GlossaryAcceptance } from '../src/shared/glossary-check'
import { auditGlossary } from '../src/shared/glossary-audit'
import type { Paragraph } from '../src/shared/types'

const entry = { id: 7, en: 'Roquefort', zh: '洛克福奶酪', category: '食物名称', note: '' }
const paragraph: Paragraph = { id: 508, pageIdx: 42, type: 'paragraph', enText: 'French shepherds used blue roquefort cheese.', zhText: '法国牧羊人用罗克福蓝纹奶酪。', status: 'done', bboxJson: '[]', rawBlock: '{}' }
const acceptance: GlossaryAcceptance = { glossaryId: entry.id, paragraphId: paragraph.id, en: entry.en, zh: entry.zh, enText: paragraph.enText, zhText: paragraph.zhText }

describe('approved per-paragraph terminology', () => {
  it('recognizes a local exception without changing text or paragraph status', () => {
    const before = JSON.stringify(paragraph)
    expect(checkGlossaryConsistency([paragraph], entry, [acceptance])[0].state).toBe('accepted')
    expect(checkGlossaryConsistency([paragraph], entry)[0].state).toBe('check')
    expect(JSON.stringify(paragraph)).toBe(before)
  })
  it('does not apply acceptance to other paragraphs, terms, originals or translations', () => {
    expect(isGlossaryAccepted({ ...paragraph, id: 509 }, entry, [acceptance])).toBe(false)
    expect(isGlossaryAccepted(paragraph, { ...entry, id: 8 }, [acceptance])).toBe(false)
    expect(isGlossaryAccepted(paragraph, { ...entry, zh: '洛克福蓝纹奶酪' }, [acceptance])).toBe(false)
    expect(isGlossaryAccepted(paragraph, { ...entry, en: 'roquefort' }, [acceptance])).toBe(false)
    expect(isGlossaryAccepted({ ...paragraph, enText: 'Roquefort cheese' }, entry, [acceptance])).toBe(false)
    expect(isGlossaryAccepted({ ...paragraph, zhText: '罗克福奶酪' }, entry, [acceptance])).toBe(false)
  })
  it('omits approved exceptions from whole-book problems but continues checking other instances', () => {
    expect(auditGlossary([paragraph], [entry], {}, [acceptance]).groups).toEqual([])
    const other = { ...paragraph, id: 509 }
    const report = auditGlossary([paragraph, other], [entry], {}, [acceptance])
    expect(report.groups[0].matches.map(match => match.paragraph.id)).toEqual([509])
    expect(auditGlossary([{ ...paragraph, zhText: '罗克福奶酪' }], [entry], {}, [acceptance]).groups).toHaveLength(1)
  })
})
