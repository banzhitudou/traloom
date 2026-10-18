import { useEffect, useState } from 'react'
import { api } from '@renderer/lib/ipc'
import { DEFAULT_OCR, type OcrSettings as Settings } from '@shared/ocr-settings'
export function OcrControls({ value, onChange, disabled = false }: { value: Settings; onChange: (value: Settings) => void; disabled?: boolean }) {
  return <div className="flex flex-wrap items-center gap-3 text-sm"><label>识别语言 <select disabled={disabled} value={value.language} onChange={event => onChange({ language: event.target.value as Settings['language'], direction: 'horizontal' })} className="rounded border bg-white p-2"><option value="eng">英语</option><option value="jpn">日语</option></select></label>{value.language === 'jpn' && <label>排版方向 <select disabled={disabled} value={value.direction} onChange={event => onChange({ ...value, direction: event.target.value as Settings['direction'] })} className="rounded border bg-white p-2"><option value="horizontal">横排</option><option value="vertical">竖排（列从右到左）</option></select></label>}</div>
}
export default function OcrSettings() {
  const [value, setValue] = useState<Settings>(DEFAULT_OCR), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { void api.getOcrSettings().then(setValue).catch(error => setMessage(String(error))) }, [])
  return <section className="max-w-3xl"><h2 className="mb-4 font-medium">文字识别</h2><OcrControls value={value} onChange={setValue} disabled={busy} /><p className="my-3 text-sm text-neutral-600">内置 OCR 在本机离线运行，不收取模型调用费用。设置用于后续识别，不自动重识别已完成的页面，不改动原文或译文。正在识别的任务需暂停后继续，才使用新设置。混排区域可在补录时单独切换。</p><p className="mb-4 text-sm text-amber-700">日文振假名、手写字、旧字体及复杂混排仍需人工核对。竖排不是把横排文字旋转 90°。</p><button disabled={busy} onClick={() => { setBusy(true); void api.saveOcrSettings(value).then(() => setMessage('已保存')).catch(error => setMessage(String(error))).finally(() => setBusy(false)) }} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40">保存识别设置</button><span role="status" className="ml-3 text-sm">{message}</span></section>
}
