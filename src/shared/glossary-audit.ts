import { checkGlossaryConsistency, countIndependentTerm, type GlossaryAcceptance, type GlossaryConsistencyMatch, type GlossaryConsistencyAction } from './glossary-check'
import type { GlossaryEntry, Paragraph } from './types'

export type GlossaryAuditState = 'different' | 'uncertain' | 'untranslated'
export interface GlossaryAuditMatch extends GlossaryConsistencyMatch {
  auditState: GlossaryAuditState
  oldTranslations: string[]
}
export interface GlossaryAuditGroup {
  entry: GlossaryEntry
  standardCount: number
  matches: GlossaryAuditMatch[]
}
export interface GlossaryAuditReport {
  termCount: number
  paragraphCount: number
  matchedTermCount: number
  standardCount: number
  groups: GlossaryAuditGroup[]
  termOccurrences: Record<number, number>
}

export function auditGlossary(
  paragraphs: Paragraph[],
  entries: GlossaryEntry[],
  history: Record<number, string[]> = {},
  acceptances: GlossaryAcceptance[] = []
): GlossaryAuditReport {
  const groups: GlossaryAuditGroup[] = []
  let matchedTermCount = 0
  let standardCount = 0
  const termOccurrences: Record<number, number> = {}
  for (const entry of entries) {
    const matches = checkGlossaryConsistency(paragraphs, entry, acceptances, entries)
    termOccurrences[entry.id] = matches.reduce((count, match) => count + countIndependentTerm(match.paragraph.enText, entry.en, entries), 0)
    if (matches.length) matchedTermCount++
    const standards = matches.filter(match => match.state === 'standard').length
    standardCount += standards
    const ambiguousTerm = entries.some(other => other.id !== entry.id && other.en.normalize('NFC').toLowerCase() === entry.en.normalize('NFC').toLowerCase() && other.zh !== entry.zh)
    const problems: GlossaryAuditMatch[] = matches.filter(match => match.state !== 'standard' && match.state !== 'accepted').map(match => {
      const oldTranslations = [...new Set([
        ...(history[entry.id] ?? []).filter(old => old && old !== entry.zh && match.paragraph.zhText.includes(old)),
        ...match.currentTranslations
      ])]
      return {
        ...match, oldTranslations,
        auditState: match.state === 'untranslated' ? 'untranslated' : !ambiguousTerm && oldTranslations.length === 1 ? 'different' : 'uncertain'
      }
    })
    if (problems.length) groups.push({ entry, standardCount: standards, matches: problems })
  }
  const priority = (group: GlossaryAuditGroup) => group.matches.some(match => match.auditState === 'different') ? 0 : group.matches.some(match => match.auditState === 'uncertain') ? 1 : 2
  groups.sort((left, right) => priority(left) - priority(right))
  return { termCount: entries.length, paragraphCount: paragraphs.length, matchedTermCount, standardCount, groups, termOccurrences }
}

export interface GlossaryAuditApply {
  action: 'replace' | 'review' | 'doing'
  requests: Omit<GlossaryConsistencyAction, 'action'>[]
}
export interface GlossaryAuditApplyResult {
  ok: boolean
  count: number
  changes?: { entryId: number; changeId: number }[]
  error?: string
}
