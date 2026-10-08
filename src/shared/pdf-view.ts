import type { NormalizedBbox } from './bbox'

export type PdfViewMode = 'full' | 'split'
export type PdfHalf = 'left' | 'right'

export interface PdfViewPosition {
  page: number
  half: PdfHalf
}

export function getBoxHalf(box: NormalizedBbox | null): PdfHalf {
  if (!box) return 'left'
  return box.left + box.width / 2 >= 0.5 ? 'right' : 'left'
}

/** Convert a full-page normalized bbox into coordinates within one half-page. */
export function cropBoxToHalf(
  box: NormalizedBbox,
  half: PdfHalf
): NormalizedBbox | null {
  const halfStart = half === 'left' ? 0 : 0.5
  const halfEnd = halfStart + 0.5
  const boxEnd = box.left + box.width
  const visibleStart = Math.max(box.left, halfStart)
  const visibleEnd = Math.min(boxEnd, halfEnd)
  if (visibleEnd <= visibleStart) return null

  return {
    left: (visibleStart - halfStart) * 2,
    top: box.top,
    width: (visibleEnd - visibleStart) * 2,
    height: box.height
  }
}

export function getPdfViewIndex(page: number, half: PdfHalf, mode: PdfViewMode): number {
  if (mode === 'full') return page
  return (page - 1) * 2 + (half === 'left' ? 1 : 2)
}

export function stepPdfView(
  page: number,
  half: PdfHalf,
  mode: PdfViewMode,
  delta: -1 | 1,
  pageCount: number
): PdfViewPosition {
  if (mode === 'full') {
    return {
      page: Math.min(pageCount, Math.max(1, page + delta)),
      half
    }
  }

  const total = pageCount * 2
  const current = getPdfViewIndex(page, half, mode)
  const next = Math.min(total, Math.max(1, current + delta))
  return {
    page: Math.floor((next - 1) / 2) + 1,
    half: next % 2 === 1 ? 'left' : 'right'
  }
}
