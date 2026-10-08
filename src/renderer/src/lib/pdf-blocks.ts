import type { RecognizedBlock } from '@shared/ipc-api'

export interface PdfTextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

export function groupPdfText(items: PdfTextItem[], width: number, height: number): RecognizedBlock[] {
  const blocks: RecognizedBlock[] = []
  let line: { text: string; x: number; y: number; right: number; bottom: number } | null = null
  const finish = () => {
    if (!line) return
    const l = Math.max(0, line.x / width), t = Math.max(0, line.y / height)
    blocks.push({ text: line.text.trim(), box: { left: l, top: t, width: Math.min(1 - l, (line.right - line.x) / width), height: Math.min(1 - t, (line.bottom - line.y) / height) } })
    line = null
  }
  for (const item of items) {
    if (!item.str.trim()) continue
    const x = item.transform[4], fontHeight = Math.max(1, Math.hypot(item.transform[2], item.transform[3]), item.height)
    const y = height - item.transform[5] - fontHeight
    if (line && (Math.abs(y - line.y) > fontHeight * .55 || x - line.right > fontHeight * 3 || x < line.x - fontHeight)) finish()
    // Text transforms locate the baseline; include room for descending glyphs.
    const bottom = y + fontHeight * 1.2
    if (!line) line = { text: item.str, x, y, right: x + item.width, bottom }
    else { line.text += (/\s$/.test(line.text) || /^\s/.test(item.str) ? '' : ' ') + item.str; line.right = Math.max(line.right, x + item.width); line.bottom = Math.max(line.bottom, bottom) }
    if (item.hasEOL) finish()
  }
  finish()
  const ordered = blocks.filter(b => b.text && b.box.width > 0 && b.box.height > 0).sort((a,b) => a.box.top - b.box.top || a.box.left - b.box.left)
  const groups: { block: RecognizedBlock; lineHeight: number }[] = []
  for (const block of ordered) {
    const match = groups.filter(g => {
      const gap = block.box.top - (g.block.box.top + g.block.box.height)
      return gap > -.005 && gap < block.box.height * .8 && Math.abs(block.box.left - g.block.box.left) < .025 && Math.abs(block.box.height - g.lineHeight) < .006
    }).sort((a,b) => b.block.box.top + b.block.box.height - a.block.box.top - a.block.box.height)[0]
    const previous = match?.block
    if (previous) {
      previous.text += '\n' + block.text
      const right = Math.max(previous.box.left + previous.box.width, block.box.left + block.box.width)
      previous.box.height = block.box.top + block.box.height - previous.box.top
      previous.box.width = right - previous.box.left
    } else groups.push({ block, lineHeight: block.box.height })
  }
  return groups.map(g => g.block).sort((a,b) => a.box.top - b.box.top || a.box.left - b.box.left)
}
