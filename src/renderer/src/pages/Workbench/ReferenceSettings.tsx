import { useEffect, useState } from 'react'
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '@renderer/lib/ipc'
import type { ReferenceProfile, ReferenceSettings as Values } from '@shared/ipc-api'
import { DEFAULT_REFERENCE_INSTRUCTIONS } from '@shared/translation-prompts'

export default function ReferenceSettings() {
  const [values, setValues] = useState<Values>({ count: 1, profiles: [{ name: '默认', instructions: '' }] })
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState<ReferenceProfile>({ name: '', instructions: '' })
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  useEffect(() => { void api.getReferenceSettings().then(result => { setValues(result); setLoaded(true) }).catch(error => setError(String(error))) }, [])
  const persist = async (next: Values, close = false) => {
    setBusy(true); setError(''); setMessage('')
    try { await api.saveReferenceSettings(next); setValues(next); setMessage('已保存'); if (close) setEditing(null) }
    catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  const edit = (index: number) => {
    setEditing(index); setError(''); setMessage('')
    const profile = values.profiles[index]
    setDraft(profile ? { ...profile, instructions: index === 0 && !profile.instructions ? DEFAULT_REFERENCE_INSTRUCTIONS : profile.instructions } : { name: `方案 ${index + 1}`, instructions: '' })
  }
  const editor = (index: number) => <form className="space-y-3" onSubmit={event => {
    event.preventDefault()
    const profiles = [...values.profiles]; profiles[index] = draft
    void persist({ ...values, profiles }, true)
  }}>
    <label className="block text-sm">方案名称<input required maxLength={60} readOnly={index === 0} disabled={busy} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} className="mt-1 w-full rounded border p-2" /></label>
    <label className="block text-sm">翻译要求<textarea rows={7} maxLength={12000} disabled={busy} value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })} className="mt-1 w-full rounded border p-2 leading-relaxed" /></label>
    <div className="flex flex-wrap gap-2">{index === 0 && <button type="button" disabled={busy} onClick={() => { setDraft({ ...draft, instructions: DEFAULT_REFERENCE_INSTRUCTIONS }); setMessage('已载入内置翻译要求，保存后生效') }} className="mr-auto inline-flex items-center gap-1 rounded border px-3 py-2 text-sm"><RotateCcw size={14} />恢复内置翻译要求</button>}<button type="button" disabled={busy} onClick={() => { setEditing(null); setMessage(''); setError('') }} className="rounded border px-3 py-2 text-sm">取消</button><button disabled={busy} className="rounded bg-blue-600 px-3 py-2 text-sm text-white">{busy ? '保存中…' : '保存方案'}</button></div>
  </form>
  return <section className="max-w-2xl">
    <h2 className="mb-4 font-medium">译文参考</h2>
    <label className="mb-2 block text-sm">返回数量<select disabled={!loaded || busy || editing !== null} value={values.count} onChange={event => void persist({ ...values, count: Number(event.target.value) })} className="ml-3 w-20 rounded border px-2 py-1">{values.profiles.map((_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
    <p className="mb-4 text-xs text-neutral-500">返回前几个方案；数量变更自动保存，不会删除其他方案。</p>
    {values.profiles.map((profile, index) => <section key={index} className="border-t py-4">
      <header className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">方案 {index + 1} · {profile.name}</h3><div className="flex gap-2"><button type="button" aria-label={`编辑方案 ${index + 1}`} title="编辑方案" disabled={!loaded || busy || editing !== null} onClick={() => edit(index)} className="p-1 disabled:opacity-40"><Pencil size={16} /></button>{index > 0 && <button type="button" aria-label={`删除方案 ${index + 1}`} title="删除方案" disabled={busy || editing !== null} onClick={() => { if (!window.confirm(`删除方案“${profile.name}”？已有译文和批量任务不受影响。`)) return; const profiles = values.profiles.filter((_, i) => i !== index); void persist({ count: Math.min(values.count, profiles.length), profiles }) }} className="p-1 text-red-700 disabled:opacity-40"><Trash2 size={16} /></button>}</div></header>
      {editing === index ? editor(index) : <p className="whitespace-pre-wrap break-words text-sm text-neutral-600">{profile.instructions || (index === 0 ? DEFAULT_REFERENCE_INSTRUCTIONS : '未填写额外翻译要求')}</p>}
    </section>)}
    {editing === values.profiles.length && <section className="border-t py-4"><h3 className="mb-3 text-sm font-medium">新建方案</h3>{editor(editing)}</section>}
    {values.profiles.length < 5 && <button type="button" disabled={!loaded || busy || editing !== null} onClick={() => edit(values.profiles.length)} className="mt-3 inline-flex items-center gap-1 rounded border px-3 py-2 text-sm disabled:opacity-40"><Plus size={16} />新增方案</button>}
    <p className="mt-4 text-xs text-neutral-500">翻译要求实际用于对应方案；原文、项目术语、完整翻译约束与 JSON 输出格式由程序附加。默认方案不可删除；批量翻译也可选用已保存的方案。</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
  </section>
}
