/** Input must be in the project's current reading order, before any filtering. */
export function getParagraphSequenceNumbers(paragraphs: readonly { id: number }[]): Map<number, number> {
  return new Map(paragraphs.map((paragraph, index) => [paragraph.id, index + 1]))
}

export function formatParagraphNumbers(sequence: number, id: number): string {
  return `第 ${sequence} 段 · #${id}`
}

export function nextParagraphInQueue<T extends { id: number; status: string }>(paragraphs: readonly T[], currentId: number, status?: string): T | undefined {
  const index = paragraphs.findIndex(paragraph => paragraph.id === currentId)
  if (index < 0) return undefined
  if (!status) return paragraphs[index + 1]
  return paragraphs.slice(index + 1).find(paragraph => paragraph.status === status)
    ?? paragraphs.slice(0, index).find(paragraph => paragraph.status === status)
}
