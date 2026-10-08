import type { NormalizedBbox } from './bbox'

export function rotatePdfBox(box: NormalizedBbox, rotation: number): NormalizedBbox {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { left: 1 - box.top - box.height, top: box.left, width: box.height, height: box.width }
    case 180: return { left: 1 - box.left - box.width, top: 1 - box.top - box.height, width: box.width, height: box.height }
    case 270: return { left: box.top, top: 1 - box.left - box.width, width: box.height, height: box.width }
    default: return box
  }
}

export function getPdfFocusBox(boxes: NormalizedBbox[], pageWidth: number, pageHeight: number, viewportWidth: number, viewportHeight: number): NormalizedBbox | null {
  if (!boxes.length) return null
  const left = Math.min(...boxes.map(box => box.left))
  const top = Math.min(...boxes.map(box => box.top))
  const right = Math.max(...boxes.map(box => box.left + box.width))
  const bottom = Math.max(...boxes.map(box => box.top + box.height))
  const union = { left, top, width: right - left, height: bottom - top }
  // Widely separated merged regions cannot all fit; start at the first source region.
  return boxes.length > 1 && (union.width * pageWidth > viewportWidth - 48 || union.height * pageHeight > viewportHeight - 48) ? boxes[0] : union
}

export function getPdfFocusScrollAxis(scroll: number, viewportSize: number, contentSize: number, targetStart: number, targetSize: number): number {
  const margin = Math.min(24, viewportSize / 8)
  if (targetStart >= margin && targetStart + targetSize <= viewportSize - margin) return scroll
  const offset = targetSize <= viewportSize - margin * 2 ? (viewportSize - targetSize) / 2 : margin
  return Math.max(0, Math.min(Math.max(0, contentSize - viewportSize), scroll + targetStart - offset))
}
