import { useEffect, useState } from 'react'
import { api } from '@renderer/lib/ipc'
import type { ReferenceProfile, ReferenceSettings as Values } from '@shared/ipc-api'

export default function ReferenceSettings() {
  const [profiles, setProfiles] = useState<ReferenceProfile[]>([{ name: '默认', instructions: '' }])
  const [count, setCount] = useState(1)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    void api.getReferenceSettings().then(values => {
      setProfiles(values.profiles); setCount(values.count); setLoaded(true)
    }).catch(e => setError(String(e)))
  }, [])
  const changeCount = (next: number) => {
    setCount(next)
    setProfiles(previous => Array.from({ length: Math.max(next, previous.length) }, (_, index) => previous[index] ?? { name: `方案 ${index + 1}`, instructions: '' }))
    setSaved(false)
  }
  const update = (index: number, field: keyof ReferenceProfile, value: string) => {
    setProfiles(previous => previous.map((profile, i) => i === index ? { ...profile, [field]: value } : profile))
    setSaved(false)
  }
  const save = async () => {
    setSaving(true); setError(''); setSaved(false)
    const values: Values = { count, profiles: profiles.slice(0, count) }
    try { await api.saveReferenceSettings(values); setSaved(true) }
    catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }
  return <form className="max-w-2xl" onSubmit={e => { e.preventDefault(); void save() }}>
    <h2 className="mb-4 text-base font-medium">译文参考</h2>
    <label className="mb-4 block text-sm">返回数量<select disabled={!loaded || saving} value={count} onChange={e => changeCount(Number(e.target.value))} className="ml-3 w-20 rounded border px-2 py-1">{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    {profiles.slice(0, count).map((profile, index) => <fieldset key={index} className="mb-5 border-t pt-4" disabled={!loaded || saving}>
      <legend className="text-sm font-medium">参考 {index + 1}</legend>
      <label className="mb-3 block text-sm">名称<input required maxLength={60} readOnly={index === 0} value={profile.name} onChange={e => update(index, 'name', e.target.value)} className={`mt-2 w-full rounded border px-3 py-2 ${index === 0 ? 'bg-neutral-100 text-neutral-600' : ''}`} /></label>
      <label className="block text-sm">翻译要求（可选）<textarea readOnly={index === 0} rows={index === 0 ? 2 : 4} maxLength={12000} value={profile.instructions} onChange={e => update(index, 'instructions', e.target.value)} className={`mt-2 w-full rounded border p-2 ${index === 0 ? 'bg-neutral-100' : ''}`} /></label>
    </fieldset>)}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex items-center gap-3"><button disabled={!loaded || saving} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40">{saving ? '保存中…' : '保存'}</button>{saved && <span role="status" className="text-sm text-green-700">已保存，适用于当前工程的所有翻译段</span>}</div>
  </form>
}
