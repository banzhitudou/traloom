export const NOTE_CHANGED = 'workbench-note-changed'
export interface NoteChange {
  id: number | null
  content: string
  origin: string
}
export function notifyNoteChanged(change: NoteChange): void {
  window.dispatchEvent(new CustomEvent<NoteChange>(NOTE_CHANGED, { detail: change }))
}
