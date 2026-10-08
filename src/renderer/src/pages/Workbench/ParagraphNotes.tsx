import { useEffect, useId, useRef, useState } from 'react'
import { api } from '@renderer/lib/ipc'
import { NOTE_CHANGED, notifyNoteChanged, type NoteChange } from './note-events'

export default function ParagraphNotes({ id, defaultOpen = false }: { id: number | null; defaultOpen?: boolean }) {
  const origin = useId()
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState('')
  const revision = useRef(0)
  useEffect(() => {
    let active = true
    const loadRevision = revision.current
    const request = id === null ? api.getProjectNote() : api.getParagraphNote(id)
    request.then(value => {
      if (active && loadRevision === revision.current) { setText(value); setLoaded(true) }
    }).catch(error => { if (active) setStatus(`读取失败：${String(error)}`) })
    const changed = (event: Event) => {
      const change = (event as CustomEvent<NoteChange>).detail
      if (change.id === id && change.origin !== origin) {
        revision.current++
        setText(change.content)
        setLoaded(true)
        setStatus('已保存')
      }
    }
    window.addEventListener(NOTE_CHANGED, changed)
    return () => { active = false; revision.current++; window.removeEventListener(NOTE_CHANGED, changed) }
  }, [id, origin])
  const save = async (value: string) => {
    const current = ++revision.current
    setText(value)
    setStatus('保存中…')
    try {
      if (id === null) await api.saveProjectNote(value)
      else await api.saveParagraphNote(id, value)
      if (current === revision.current) {
        setStatus('已保存')
        notifyNoteChanged({ id, content: value, origin })
      }
    } catch (error) {
      if (current === revision.current) setStatus(`保存失败：${String(error)}`)
    }
  }
  return <details open={defaultOpen} className="mt-2 border-t pt-2">
    <summary className="cursor-pointer text-xs font-medium text-neutral-600">{id === null ? '项目整体备注' : '段落备注'}{text.trim() ? ' · 有备注' : ''}</summary>
    <textarea aria-label={id === null ? '项目整体备注' : `翻译段 ${id} 的备注`} placeholder={id === null ? '项目整体备注…' : '写下这一段的备注…'} disabled={!loaded} value={text} onChange={event => void save(event.target.value)} rows={id === null ? 6 : 3} className="selectable mt-2 w-full resize-y rounded border p-2 text-sm" />
    <div role="status" className="text-xs text-neutral-500">{status}</div>
    {status.startsWith('保存失败') && <button type="button" onClick={() => void save(text)} className="text-xs text-blue-700">重试保存</button>}
  </details>
}
