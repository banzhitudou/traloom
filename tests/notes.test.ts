import { expect, it } from 'vitest'
import { filterParagraphNotes } from '../src/shared/notes'

it('searches all notes, source, translation and stable numbers without mutating them', () => {
  const notes = [
    { id: 922, sequence: 28, pageIdx: 6, enText: 'Rice is food.', zhText: '米饭是食物。', content: '查证主食数据' },
    { id: 29, sequence: 29, pageIdx: 6, enText: 'Petra', zhText: '佩特拉', content: '核对作者译名' }
  ]
  expect(filterParagraphNotes(notes, '')).toEqual(notes)
  expect(filterParagraphNotes(notes, '作者').map(note => note.id)).toEqual([29])
  expect(filterParagraphNotes(notes, ' RICE ').map(note => note.id)).toEqual([922])
  expect(filterParagraphNotes(notes, '米饭').map(note => note.id)).toEqual([922])
  expect(filterParagraphNotes(notes, '#922').map(note => note.id)).toEqual([922])
  expect(filterParagraphNotes(notes, '第28段').map(note => note.id)).toEqual([922])
  expect(filterParagraphNotes(notes, 'missing')).toEqual([])
})
