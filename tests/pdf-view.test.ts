import { describe, expect, it } from 'vitest'
import {
  cropBoxToHalf,
  getBoxHalf,
  getPdfViewIndex,
  stepPdfView
} from '../src/shared/pdf-view'

describe('PDF split-page view', () => {
  it('maps boxes into left and right half coordinates', () => {
    const left = cropBoxToHalf({ left: 0.1, top: 0.2, width: 0.2, height: 0.1 }, 'left')
    const right = cropBoxToHalf({ left: 0.6, top: 0.2, width: 0.2, height: 0.1 }, 'right')
    expect(left?.left).toBeCloseTo(0.2)
    expect(left?.width).toBeCloseTo(0.4)
    expect(right?.left).toBeCloseTo(0.2)
    expect(right?.width).toBeCloseTo(0.4)
  })

  it('clips a box crossing the page fold and hides boxes on the other half', () => {
    const crossing = cropBoxToHalf({ left: 0.45, top: 0.1, width: 0.1, height: 0.2 }, 'left')
    expect(crossing?.left).toBeCloseTo(0.9)
    expect(crossing?.width).toBeCloseTo(0.1)
    expect(cropBoxToHalf({ left: 0.7, top: 0.1, width: 0.1, height: 0.2 }, 'left'))
      .toBeNull()
  })

  it('chooses the half containing the center of a paragraph box', () => {
    expect(getBoxHalf({ left: 0.2, top: 0, width: 0.1, height: 0.1 })).toBe('left')
    expect(getBoxHalf({ left: 0.48, top: 0, width: 0.2, height: 0.1 })).toBe('right')
  })

  it('steps through every half-page in reading order', () => {
    expect(stepPdfView(3, 'left', 'split', 1, 10)).toEqual({ page: 3, half: 'right' })
    expect(stepPdfView(3, 'right', 'split', 1, 10)).toEqual({ page: 4, half: 'left' })
    expect(stepPdfView(4, 'left', 'split', -1, 10)).toEqual({ page: 3, half: 'right' })
    expect(getPdfViewIndex(4, 'right', 'split')).toBe(8)
  })
})
