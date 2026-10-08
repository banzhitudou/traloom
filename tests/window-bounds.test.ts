import { describe, expect, it } from 'vitest'
import { fitWindowToWorkArea } from '../src/main/window-bounds'

describe('window display boundaries', () => {
  it('fits an oversized window on a smaller external work area', () => {
    expect(fitWindowToWorkArea({ x: 1512, y: 25, width: 1440, height: 900 },
      { x: 1512, y: 25, width: 1280, height: 695 }))
      .toEqual({ x: 1512, y: 25, width: 1280, height: 695 })
  })
  it('handles negative display coordinates without changing a fitting window', () => {
    const bounds = { x: -1200, y: 40, width: 1100, height: 600 }
    expect(fitWindowToWorkArea(bounds, { x: -1280, y: 25, width: 1280, height: 695 })).toEqual(bounds)
  })
})
