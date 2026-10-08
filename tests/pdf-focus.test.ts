import { describe, expect, it } from 'vitest'
import { getPdfFocusBox, getPdfFocusScrollAxis, rotatePdfBox } from '../src/shared/pdf-focus'
import { cropBoxToHalf } from '../src/shared/pdf-view'

describe('PDF paragraph focus', () => {
  it('keeps fully visible regions in place', () => {
    expect(getPdfFocusScrollAxis(400, 500, 1600, 100, 200)).toBe(400)
    expect(getPdfFocusScrollAxis(0, 500, 500, 0, 500)).toBe(0)
  })
  it('centers off-screen regions and clamps to page edges', () => {
    expect(getPdfFocusScrollAxis(0, 500, 1600, 1000, 100)).toBe(800)
    expect(getPdfFocusScrollAxis(800, 500, 1600, -500, 100)).toBe(100)
    expect(getPdfFocusScrollAxis(0, 500, 1600, 1550, 50)).toBe(1100)
  })
  it('shows the beginning of regions larger than the viewport', () => {
    expect(getPdfFocusScrollAxis(0, 300, 1600, 900, 500)).toBe(876)
  })
  it('focuses merged regions together if they fit, otherwise uses the first', () => {
    const boxes = [{ left: 0.1, top: 0.1, width: 0.1, height: 0.1 }, { left: 0.2, top: 0.2, width: 0.1, height: 0.1 }]
    expect(getPdfFocusBox(boxes, 1000, 1000, 500, 500)?.height).toBeCloseTo(0.2)
    expect(getPdfFocusBox(boxes, 1000, 2000, 500, 300)).toEqual(boxes[0])
    expect(getPdfFocusBox([], 1000, 1000, 500, 500)).toBeNull()
  })
  it('handles all quarter turns after cropping a split page', () => {
    const box = cropBoxToHalf({ left: 0.6, top: 0.2, width: 0.2, height: 0.1 }, 'right')!
    const rotated = rotatePdfBox(box, 90)
    expect(rotated.left).toBeCloseTo(0.7)
    expect(rotated.top).toBeCloseTo(0.2)
    expect(rotated.width).toBeCloseTo(0.1)
    expect(rotated.height).toBeCloseTo(0.4)
    expect(rotatePdfBox({ left: 0.1, top: 0.2, width: 0.3, height: 0.4 }, 180)).toEqual({ left: 0.6000000000000001, top: 0.4, width: 0.3, height: 0.4 })
    expect(rotatePdfBox(box, 270).left).toBeCloseTo(0.2)
    expect(rotatePdfBox(box, 0)).toEqual(box)
  })
})
