import { expect, it } from 'vitest'
import { formatBookPageLabel } from '../src/shared/book-page-label'

it('formats mapped book pages and two-page spreads', () => {
  expect(formatBookPageLabel(11, -4, 1)).toBe(' · 书页 8')
  expect(formatBookPageLabel(11, -4, 2)).toBe(' · 书页 19–20')
  expect(formatBookPageLabel(0, -4, 1)).toBe('')
})
