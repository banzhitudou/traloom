import { describe, expect, it } from 'vitest'
import { formatParagraphNumbers, getParagraphSequenceNumbers, nextParagraphInQueue } from '../src/shared/paragraph-numbering'

describe('paragraph numbering', () => {
  it.each(['doing', 'todo', 'review'])('continues only within the %s queue, wraps remaining items and ends without leaving it', status => {
    const rows = [{ id: 1, status }, { id: 2, status: 'done' }, { id: 3, status }, { id: 4, status: 'done' }]
    expect(nextParagraphInQueue(rows, 1, status)?.id).toBe(3)
    expect(nextParagraphInQueue(rows, 3, status)?.id).toBe(1)
    expect(nextParagraphInQueue(rows.map(row => row.id === 1 ? { ...row, status: 'done' } : row), 3, status)).toBeUndefined()
    expect(nextParagraphInQueue(rows, 1)?.id).toBe(2)
    expect(nextParagraphInQueue(rows, 999, status)).toBeUndefined()
  })
  it('numbers the current order without changing fixed IDs', () => {
    const rows = [{ id: 28 }, { id: 922 }, { id: 29 }]
    expect([...getParagraphSequenceNumbers(rows)]).toEqual([[28, 1], [922, 2], [29, 3]])
    expect(rows.map(row => row.id)).toEqual([28, 922, 29])
    expect(formatParagraphNumbers(2, 922)).toBe('第 2 段 · #922')
  })

  it('updates contiguous sequence numbers after reorder, insertion and deletion', () => {
    expect([...getParagraphSequenceNumbers([{ id: 29 }, { id: 28 }, { id: 922 }])]).toEqual([[29, 1], [28, 2], [922, 3]])
    expect([...getParagraphSequenceNumbers([{ id: 28 }, { id: 1000 }, { id: 29 }])]).toEqual([[28, 1], [1000, 2], [29, 3]])
    expect([...getParagraphSequenceNumbers([{ id: 28 }, { id: 29 }])]).toEqual([[28, 1], [29, 2]])
    expect(getParagraphSequenceNumbers([]).size).toBe(0)
  })
})
