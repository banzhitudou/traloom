import { expect, it } from 'vitest'
import { mapOcrRegion, overlapsExisting } from '../src/shared/ocr-regions'

it('maps OCR blocks back into the selected page region', () => {
  const result = mapOcrRegion({ left: 0, top: 0, width: 0.5, height: 1 }, { left: 0.5, top: 0.2, width: 0.4, height: 0.6 }, 0)
  expect(result.left).toBe(0.5)
  expect(result.width).toBe(0.2)
  expect(result.top).toBe(0.2)
  expect(result.height).toBe(0.6)
})

it('undoes page rotation when mapping block coordinates', () => {
  const box = { left: 0, top: 0, width: 0.5, height: 1 }
  const crop = { left: 0, top: 0, width: 1, height: 1 }
  expect(mapOcrRegion(box, crop, 90)).toEqual({ left: 0, top: 0.5, width: 1, height: 0.5 })
  expect(mapOcrRegion(box, crop, 180)).toEqual({ left: 0.5, top: 0, width: 0.5, height: 1 })
  expect(mapOcrRegion(box, crop, 270)).toEqual({ left: 0, top: 0, width: 1, height: 0.5 })
})

it('marks significant overlaps without marking disjoint blocks', () => {
  const box = { left: 0, top: 0, width: 0.2, height: 0.2 }
  expect(overlapsExisting(box, [box])).toBe(true)
  expect(overlapsExisting(box, [{ ...box, left: 0.3 }])).toBe(false)
  expect(overlapsExisting(box, [{ ...box, left: 0.19 }])).toBe(false)
})
