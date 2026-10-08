export function formatBookPageLabel(pageIdx: number, offset: number, pagesPerPdf: number): string {
  const first = pageIdx * pagesPerPdf + 1 + offset
  return first > 0 ? ` · 书页 ${first}${pagesPerPdf === 2 ? `–${first + 1}` : ''}` : ''
}
