export interface ParagraphNoteSummary {
  id: number
  sequence: number
  pageIdx: number
  enText: string
  zhText: string
  content: string
}

export function filterParagraphNotes(notes: ParagraphNoteSummary[], query: string): ParagraphNoteSummary[] {
  const search = query.normalize('NFC').trim().toLocaleLowerCase()
  if (!search) return notes
  return notes.filter(note => `${note.content} ${note.enText} ${note.zhText} #${note.id} 第${note.sequence}段 PDF${note.pageIdx + 1}`.normalize('NFC').toLocaleLowerCase().includes(search))
}
