import type { RecognizedBlock } from '@shared/ipc-api'

export interface PdfTextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

export function groupPdfText(items: PdfTextItem[], width: number, height: number, viewport = [1, 0, 0, -1, 0, height]): RecognizedBlock[] {
  if (width <= 0 || height <= 0) return []
  const directions = new Map<string, { ux: number; uy: number; items: PdfTextItem[] }>()
  const [va, vb, vc, vd, ve, vf] = viewport
  for (const item of items) {
    const [a, b, c, d, e, f] = item.transform
    const dx = va * a + vc * b, dy = vb * a + vd * b
    const length = Math.hypot(dx, dy)
    if (!length) continue
    const ux = dx / length, uy = dy / length
    const key = `${ux.toFixed(6)},${uy.toFixed(6)}`
    let direction = directions.get(key)
    if (!direction) {
      direction = { ux, uy, items: [] }
      directions.set(key, direction)
    }
    // Work in the text's reading direction before mapping bounds back to the page.
    const px = va * e + vc * f + ve, py = vb * e + vd * f + vf
    const fontHeight = Math.max(1, Math.hypot(va * c + vc * d, vb * c + vd * d))
    direction.items.push({ ...item, width: item.width * length / Math.max(Math.hypot(a, b), 1e-8), height: fontHeight,
      transform: [fontHeight, 0, 0, fontHeight, px * ux + py * uy, px * uy - py * ux] })
  }
  const blocks: RecognizedBlock[] = []
  for (const { ux, uy, items: localItems } of directions.values()) {
    const readingWidth = Math.abs(ux) * width + Math.abs(uy) * height
    const readingHeight = Math.abs(uy) * width + Math.abs(ux) * height
    for (const bounds of groupReadingDirection(localItems, readingWidth, readingHeight)) {
      const corners = [[bounds.x, bounds.y], [bounds.right, bounds.y], [bounds.x, bounds.bottom], [bounds.right, bounds.bottom]]
        .map(([x, y]) => [x * ux - y * uy, x * uy + y * ux])
      const left = Math.max(0, Math.min(width, Math.min(...corners.map(p => p[0]))))
      const top = Math.max(0, Math.min(height, Math.min(...corners.map(p => p[1]))))
      const right = Math.max(left, Math.min(width, Math.max(...corners.map(p => p[0]))))
      const bottom = Math.max(top, Math.min(height, Math.max(...corners.map(p => p[1]))))
      if (bounds.text && right > left && bottom > top) blocks.push({ text: bounds.text, box: { left: left / width, top: top / height, width: (right - left) / width, height: (bottom - top) / height } })
    }
  }
  return blocks.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
}

type Bounds = { text: string; x: number; y: number; right: number; bottom: number }

function groupReadingDirection(items: PdfTextItem[], width: number, height: number): Bounds[] {
  const blocks: Bounds[] = []
  let line: { text: string; x: number; y: number; right: number; bottom: number } | null = null
  const finish = () => {
    if (!line) return
    blocks.push({ ...line, text: line.text.trim() })
    line = null
  }
  for (const item of items) {
    if (!item.str.trim()) continue
    const x = item.transform[4], fontHeight = Math.max(1, Math.hypot(item.transform[2], item.transform[3]), item.height)
    const y = -item.transform[5] - fontHeight
    if (line && (Math.abs(y - line.y) > fontHeight * .55 || x - line.right > fontHeight * 3 || x < line.x - fontHeight)) finish()
    // Text transforms locate the baseline; include room for descending glyphs.
    const bottom = y + fontHeight * 1.2
    if (!line) line = { text: item.str, x, y, right: x + item.width, bottom }
    else { line.text += (/\s$/.test(line.text) || /^\s/.test(item.str) ? '' : ' ') + item.str; line.right = Math.max(line.right, x + item.width); line.bottom = Math.max(line.bottom, bottom) }
    if (item.hasEOL) finish()
  }
  finish()
  const ordered = blocks.filter(b => b.text && b.right > b.x && b.bottom > b.y).sort((a,b) => a.y - b.y || a.x - b.x)
  const groups: { block: Bounds; lineHeight: number }[] = []
  for (const block of ordered) {
    const match = groups.filter(g => {
      const gap = block.y - g.block.bottom
      return gap > -.005 * height && gap < (block.bottom - block.y) * .8 && Math.abs(block.x - g.block.x) < .025 * width && Math.abs(block.bottom - block.y - g.lineHeight) < .006 * height
    }).sort((a,b) => b.block.bottom - a.block.bottom)[0]
    const previous = match?.block
    if (previous) {
      previous.text += '\n' + block.text
      previous.x = Math.min(previous.x, block.x)
      previous.right = Math.max(previous.right, block.right)
      previous.bottom = Math.max(previous.bottom, block.bottom)
    } else groups.push({ block, lineHeight: block.bottom - block.y })
  }
  return groups.map(g => g.block)
}
