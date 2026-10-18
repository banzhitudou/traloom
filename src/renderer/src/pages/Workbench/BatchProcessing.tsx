import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Pause, Play, RotateCcw, Settings, Square, X } from 'lucide-react'
import { api } from '@renderer/lib/ipc'
import type { BatchJob, BatchPlan, BatchTask } from '@shared/batch-processing'
import type { ReferenceProfile } from '@shared/ipc-api'
import * as pdfjs from 'pdfjs-dist'
// @ts-ignore Vite asset URL
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { renderVisionCrops } from '@renderer/lib/vision-crops'
import { parseNormalizedBboxes } from '@shared/bbox'
import { VISION_OCR_NOTICE } from '@shared/vision-ocr'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
const labels = { clean: '整理原文断行', translate: '生成译文初稿', vision: 'AI 视觉重识别（测试）' }
const modelTask = (task: BatchTask) => task === 'vision' ? 'vision_ocr' : task === 'clean' ? 'ocr_line_breaks' : 'whole_para'
const states = { pending: '未处理', running: '正在请求', candidate: '待采用', applied: '已采用', failed: '失败', skipped: '已跳过', discarded: '已放弃' }
const button = 'inline-flex items-center gap-1 rounded border px-3 py-2 text-sm disabled:opacity-40'
export default function BatchProcessing({ total, onClose, onChanged, onOpenSettings, visible = true }: { total: number; onClose: () => void; onChanged: () => Promise<void>; onOpenSettings: () => void; visible?: boolean }) {
  const [task, setTask] = useState<BatchTask>('clean'), [range, setRange] = useState(false)
  const [from, setFrom] = useState(1), [to, setTo] = useState(total), [count, setCount] = useState(10)
  const [plan, setPlan] = useState<BatchPlan | null>(null), [job, setJob] = useState<BatchJob | null>(null)
  const [jobs, setJobs] = useState<BatchJob[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [model, setModel] = useState('未配置模型'), [selected, setSelected] = useState<number[]>([])
  const [modelReady, setModelReady] = useState(false), [checkingModel, setCheckingModel] = useState(true)
  const [page, setPage] = useState(0), [allResults, setAllResults] = useState(false)
  const polling = useRef(false)
  const visionStop = useRef(false)
  const [visionRunning, setVisionRunning] = useState(false)
  useEffect(() => { if (!visible) visionStop.current = true; return () => { visionStop.current = true } }, [visible])
  const [profiles, setProfiles] = useState<ReferenceProfile[]>([{ name: '默认', instructions: '' }])
  const [profileIndex, setProfileIndex] = useState(0)
  const [restoreFrom, setRestoreFrom] = useState(1), [restoreTo, setRestoreTo] = useState(total)
  const [restoreMessage, setRestoreMessage] = useState('')
  const [restoreMode, setRestoreMode] = useState(false)
  const scope = { task, profileIndex, ...(range ? { from, to } : {}) }
  const execute = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (error) { setError(String(error)) } finally { setBusy(false) }
  }
  useEffect(() => {
    if (!visible) return
    void api.getReferenceSettings().then(settings => { setProfiles(settings.profiles); setProfileIndex(previous => previous < settings.profiles.length ? previous : 0) }).catch(error => setError(String(error)))
    void api.listBatchJobs().then(values => { setJobs(values); const current = values.find(value => value.state === 'running' || value.inFlight); if (current) { setJob(current); setTask(current.task) } }).catch(error => setError(String(error)))
    let current = true
    setCheckingModel(true)
    void api.getLlmStatus(modelTask(job?.task ?? task)).then(status => { if (current) { setModel(status.model || '未配置模型'); setModelReady(status.state !== 'unconfigured' && !!status.model?.trim()) } }).catch(error => { if (current) { setModelReady(false); setError(String(error)) } }).finally(() => { if (current) setCheckingModel(false) })
    return () => { current = false }
  }, [visible, task, job?.task])
  useEffect(() => {
    let current = true
    if (!visible) return
    setPlan(null); setSelected([]); setPage(0); setError('')
    void api.planBatch({ task, ...(range ? { from, to } : {}) }).then(value => { if (current) setPlan(value) }).catch(error => { if (current) setError(String(error)) })
    return () => { current = false }
  }, [task, range, from, to, visible])
  useEffect(() => {
    if (!job || (job.state !== 'running' && !job.inFlight)) return
    let mounted = true
    const timer = setInterval(() => {
      if (polling.current) return
      polling.current = true
      void api.getBatchJob(job.id).then(async value => { if (mounted) { setJob(value); if (value.state !== 'running' && !value.inFlight) await onChanged() } }).catch(error => { if (mounted) setError(String(error)) }).finally(() => { polling.current = false })
    }, 1500)
    return () => { mounted = false; clearInterval(timer) }
  }, [job?.id, job?.state, job?.inFlight, onChanged])
  const confirmRun = async (amount: number, automatic: boolean) => {
    const status = await api.getLlmStatus(modelTask(job?.task ?? task))
    const ready = status.state !== 'unconfigured' && !!status.model?.trim()
    setModelReady(ready); setModel(status.model || '未配置模型')
    if (!ready) { setError('请先配置模型，再开始批量处理。'); return false }
    return window.confirm(`${labels[job?.task ?? task]}：${amount} 段，模型“${status.model}”。\n会向模型服务发送原文和相关术语，可能产生费用，并非免费试用。\n${automatic ? '结果逐段自动保存，跳过已有译文及期间被修改的段落。' : '结果先预览，采用后才写入。'}\n是否开始？`)
  }
  const runVision = async (initial: BatchJob, amount: number) => {
    setVisionRunning(true); visionStop.current = false; setError('')
    let pdf: pdfjs.PDFDocumentProxy | undefined
    try {
      const token = await api.approveVisionBatch(initial.id, amount)
      if (!token || visionStop.current) return
      const bytes = await api.readPdf()
      if (!bytes) throw new Error('无法读取原书 PDF。')
      pdf = await pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false}).promise
      let current = initial, failures = 0
      for (let i=0; i<amount && !visionStop.current; i++) {
        const item = current.items.find(row => row.state === 'pending')
        if (!item) break
        const crops = await renderVisionCrops(pdf,item.pageIdx+1,parseNormalizedBboxes(item.bboxJson || '[]'))
        if (visionStop.current) break
        current = await api.stepVisionBatch(token,{paragraphId:item.id,pageIdx:item.pageIdx,rotation:0,crops})
        setJob(current)
        failures = current.items.find(row => row.id === item.id)?.state === 'failed' ? failures+1 : 0
        if (failures >= 3) throw new Error('连续三段识别失败，已暂停后续请求。请检查模型是否支持图片及服务限制。')
        if (current.state === 'cancelled') break
      }
    } catch (error) { setError(String(error)) }
    finally { await pdf?.destroy(); setVisionRunning(false); await onChanged() }
  }
  const startNew = async (trial: boolean) => {
    if (!plan || !Number.isInteger(count) || count < 1) { setError('试处理数量必须是正整数。'); return }
    const amount = trial ? Math.min(selected.length || count, plan.eligible.length) : plan.eligible.length
    if (!amount) return
    await execute(async () => { if (task !== 'vision' && !await confirmRun(amount, !trial)) return; const created = await api.createBatchJob(scope, selected); setJob(created); setPage(0); if (task === 'vision') { void runVision(created,amount); return }; setJob(await api.startBatchJob(created.id, amount, !trial)) })
  }
  const startExisting = async (amount: number, automatic: boolean) => {
    if (!job) return
    if (job.task === 'vision') { void runVision(job,amount); return }
    await execute(async () => { if (await confirmRun(amount, automatic)) setJob(await api.startBatchJob(job.id, amount, automatic)) })
  }
  const decide = async (ids: number[], adopt: boolean) => {
    if (!job) return
    await execute(async () => { setJob(await api.decideBatch(job.id, ids, adopt)); await onChanged() })
  }
  const control = async (action: 'pause' | 'cancel' | 'retry') => {
    if (!job) return
    if (action !== 'pause' && !window.confirm(action === 'cancel' ? '取消后续请求？已采用的结果保留，当前请求可能仍产生费用。' : '失败和放弃项加入重试队列？重新调用可能再次计费。')) return
    visionStop.current = true
    await execute(async () => setJob(await api.controlBatch(job.id, action)))
  }
  const candidates = job?.items.filter(item => item.state === 'candidate') ?? []
  const pending = job?.items.filter(item => item.state === 'pending').length ?? 0
  const running = visionRunning || job?.state === 'running' || job?.inFlight
  const retryable = job?.items.filter(item => item.state === 'failed' || item.state === 'discarded').length ?? 0
  const finished = !!job && !running && job.state !== 'cancelled' && !pending && !candidates.length && !retryable
  const newTask = async (value = job?.task ?? task) => {
    await execute(async () => {
      setJob(null); setTask(value); setPlan(null); setSelected([]); setPage(0); setAllResults(false)
      const nextScope = { task: value, ...(range ? { from, to } : {}) }
      setPlan(await api.planBatch(nextScope))
      setJobs(await api.listBatchJobs())
    })
  }
  const rows = job ? job.items.filter(item => finished || allResults || item.state === 'candidate' || item.state === 'failed') : plan?.eligible ?? []
  const maxPage = Math.max(0, Math.ceil(rows.length / 20) - 1), visiblePage = Math.min(page, maxPage)
  return <div className={visible ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3' : 'hidden'} role="dialog" aria-modal="true" aria-labelledby="batch-title">
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
      <header className="flex shrink-0 items-center justify-between border-b px-5 py-3"><h2 id="batch-title" className="font-medium">批量处理</h2><button title={running ? '关闭；视觉任务暂停后续请求，其他任务后台继续' : '关闭批量处理'} aria-label="关闭批量处理" onClick={() => { visionStop.current = true; void onChanged(); onClose() }} className="p-2"><X size={18} /></button></header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <nav aria-label="批量任务" className="mb-4 flex flex-wrap gap-2">{(['clean', 'translate', 'vision'] as const).map(value => <button disabled={busy || !!running} key={value} aria-pressed={!restoreMode && (job?.task ?? task) === value} onClick={() => { setRestoreMode(false); if (job) void newTask(value); else setTask(value) }} className={`${button} ${!restoreMode && (job?.task ?? task) === value ? 'border-blue-600 bg-blue-50 text-blue-700' : ''}`}>{labels[value]}</button>)}<button type="button" disabled={busy || !!running} aria-pressed={restoreMode} onClick={() => { setRestoreMode(true); setError(''); setRestoreMessage('') }} className={`${button} ${restoreMode ? 'border-blue-600 bg-blue-50 text-blue-700' : ''}`}>恢复识别原文</button></nav>
        <div className={restoreMode ? 'hidden' : ''}>
        {(job?.task ?? task) === 'vision' && <p role="note" className="mb-3 border-l-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-800">{VISION_OCR_NOTICE}</p>}
        {(job?.task ?? task) === 'vision' && <p className="mb-3 text-sm text-blue-700">按现有区域发送图片并重新识别原文，不重新划分版面。跳过已有译文的段落；每批上传前确认服务和费用，结果先预览，采用后才修改原文。请先在设置中分配支持图片的模型。</p>}
        {(job?.task ?? task) !== 'vision' && <p className="mb-3 text-sm">{(job?.task ?? task) === 'clean' ? '逐段修复排版造成的换行和断词，保留标题、列表等有意义的换行。不跨段合并，不改变段号、顺序或 PDF 区域。' : '逐段生成一份中文初稿，采用后标为待审，不自动通过。'}</p>}
        {(job?.task ?? task) === 'translate' && <p className="mb-3 text-sm text-blue-700">建议先运行“整理原文断行”预处理识别文字，再批量翻译，以减少断行对译文的影响。</p>}
        {!finished && <p className="mb-4 text-sm text-amber-700">会调用模型，发送{(job?.task ?? task) === 'vision' ? '所选区域图片' : '原文及必要上下文'}，可能产生费用。当前模型：{model}。无法可靠估算金额，建议先小批量试处理。</p>}
        {!finished && !modelReady && <div role="status" className="mb-4 flex flex-wrap items-center gap-3 border-l-2 border-amber-500 bg-amber-50 p-3 text-sm"><span>{checkingModel ? '正在检查模型配置…' : '尚未配置模型，暂时无法开始批量处理。'}</span><button type="button" disabled={checkingModel || busy} onClick={onOpenSettings} className={`${button} bg-white text-blue-700`}><Settings size={16} />去配置模型</button></div>}
        {!job && <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm"><label>范围 <select value={range ? 'range' : 'all'} onChange={event => setRange(event.target.value === 'range')} className="rounded border p-2"><option value="all">全部符合条件的段落</option><option value="range">段落区间</option></select></label>
            {range && <><label>第 <input aria-label="起始段" type="number" min={1} max={total} value={from} onChange={event => setFrom(Number(event.target.value))} className="w-20 rounded border p-2" /> 段</label><label>至第 <input aria-label="结束段" type="number" min={from} max={total} value={to} onChange={event => setTo(Number(event.target.value))} className="w-20 rounded border p-2" /> 段</label></>}
            <label>先试 <input aria-label="试处理数量" type="number" min={1} value={count} onChange={event => setCount(Number(event.target.value))} className="w-20 rounded border p-2" /> 段</label></div>
          {plan && <p className="mb-3 text-sm text-neutral-500">范围内 {plan.total} 段，可处理 {plan.eligible.length} 段；跳过已有译文 {plan.existing} 段、无需整理或已整理 {plan.unchanged} 段、无原文或无可用识别区域 {plan.empty} 段。可处理原文 {plan.characters.toLocaleString()} 字符。</p>}
          <p className="mb-3 text-sm text-neutral-500">默认先试前几段，也可勾选代表性段落（已选 {selected.length} 段；勾选后以所选数量为准）。</p>
          {task === 'translate' && <div className="mb-4 flex flex-wrap items-center gap-3 text-sm"><label>译文参考方案 <select value={profileIndex} onChange={event => setProfileIndex(Number(event.target.value))} className="rounded border p-2">{profiles.map((profile,index) => <option key={index} value={index}>{profile.name}</option>)}</select></label><span>方案名称和翻译要求统一在“设置 → 译文参考”中修改。</span><button type="button" className={button} onClick={onOpenSettings}>前往设置</button></div>}
          <div className="mb-4 flex flex-wrap gap-2"><button disabled={busy || checkingModel || !modelReady || !plan?.eligible.length} onClick={() => void startNew(true)} className={`${button} bg-blue-600 text-white`}><Play size={16} />先试 {selected.length || Math.min(count, plan?.eligible.length ?? count)} 段</button><button disabled={busy || checkingModel || !modelReady || !plan?.eligible.length} onClick={() => void startNew(false)} className={button}>处理范围内全部 {plan?.eligible.length ?? 0} 段{task === 'vision' ? '（先预览）' : '并保存'}</button></div>
          {!!jobs.length && <label className="mb-4 grid gap-1 text-sm">历史任务<select value="" onChange={event => { const found = jobs.find(row => row.id === event.target.value); if (found) { setJob(found); setTask(found.task); setPage(0); setAllResults(false) } }} className="rounded border p-2"><option value="">选择任务</option>{jobs.map(row => <option key={row.id} value={row.id}>{labels[row.task]} · {new Date(row.createdAt).toLocaleString()} · {row.state === 'completed' ? '已完成' : row.state === 'cancelled' ? '已取消' : row.state === 'running' ? '运行中' : '已暂停'} · {row.items.filter(item => item.state === 'applied').length}/{row.items.length} 已采用</option>)}</select></label>}
        </>}
        {job && <>
          <div role="status" className={`mb-4 flex flex-wrap items-center gap-3 border-l-2 p-3 ${finished ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-blue-500 bg-blue-50 text-blue-800'}`}>
            {finished && <Check size={20} aria-hidden="true" />}
            <span className="font-medium">{finished ? '本次任务已完成' : running ? '正在处理' : job.state === 'cancelled' ? '本次任务已取消' : candidates.length ? `试处理结果已就绪，${candidates.length} 段待采用` : retryable && !pending ? '本次处理已结束，有结果需要检查' : '任务已暂停'}</span>
            {finished && <span className="text-sm">已采用 {job.items.filter(item => item.state === 'applied').length} 段{job.items.some(item => item.state === 'skipped') ? `，跳过 ${job.items.filter(item => item.state === 'skipped').length} 段` : ''}</span>}
          </div>
          <div role="status" className="mb-2 flex flex-wrap items-center gap-2 text-sm">{running && <LoaderCircle size={16} className="animate-spin" />}总计 {job.items.length} 段 · 已采用 {job.items.filter(item => item.state === 'applied').length} · 待采用 {candidates.length} · 剩余 {pending} · 失败 {job.items.filter(item => item.state === 'failed').length} · 跳过 {job.items.filter(item => item.state === 'skipped').length} · 放弃 {job.items.filter(item => item.state === 'discarded').length}</div>
          {!finished && job.message && <p className="mb-3 text-sm text-amber-700">{job.message}</p>}
          <div className="mb-4 flex flex-wrap gap-2">
            {finished && <button disabled={busy} onClick={() => void newTask()} className={`${button} border-blue-600 bg-blue-600 text-white`}>新建批量任务</button>}
            {running ? <button disabled={busy} onClick={() => void control('pause')} className={button}><Pause size={16} />暂停新请求</button> : <>
              {!!candidates.length && <button disabled={busy} onClick={() => void decide(candidates.map(row => row.id), true)} className={`${button} text-emerald-700`}><Check size={16} />采用全部试处理结果</button>}
              {!!pending && job.state !== 'cancelled' && <><button disabled={busy || checkingModel || !modelReady} onClick={() => void startExisting(pending, true)} className={`${button} bg-blue-600 text-white`}><Play size={16} />继续处理剩余 {pending} 段{job.task === 'vision' ? '（先预览）' : '并保存'}</button>
              <button disabled={busy || checkingModel || !modelReady} onClick={() => void startExisting(Math.min(count, pending), false)} className={button}>再试 {Math.min(count, pending)} 段</button></>}
              {!!retryable && <button disabled={busy} onClick={() => void control('retry')} className={button}><RotateCcw size={16} />准备重试</button>}
            </>}
            {!finished && job.state !== 'cancelled' && <button disabled={busy} onClick={() => void control('cancel')} className={button}><Square size={16} />取消任务</button>}
            {!running && !finished && <button disabled={busy} onClick={() => void newTask()} className={button}>新建批量任务</button>}
          </div>{!finished && <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={allResults} onChange={event => { setAllResults(event.target.checked); setPage(0) }} />显示全部结果</label>}
        </>}
        {error && <p role="alert" className="mb-3 whitespace-pre-wrap text-sm text-red-700">{error}</p>}
        <div className="divide-y border-y">{rows.slice(visiblePage * 20, visiblePage * 20 + 20).map(item => <section key={item.id} className="py-3">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm"><span>第 {item.sequence} 段 · #{item.id} · PDF {item.pageIdx + 1}</span>{job ? <span>{states[item.state]}</span> : <label className="flex items-center gap-1"><input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} />选作试处理</label>}</div>
          <div className={`grid gap-3 ${item.output ? 'md:grid-cols-2' : ''}`}><div className="min-w-0 text-sm text-neutral-600">{item.output && <div className="mb-1 text-xs text-neutral-400">原文</div>}<div className="whitespace-pre-wrap break-words">{item.source}</div></div>{item.output && <div className="min-w-0 text-sm"><div className="mb-1 text-xs text-neutral-400">{job?.task === 'vision' ? '识别结果' : job?.task === 'clean' ? '整理结果' : '译文初稿'}</div><div className="whitespace-pre-wrap break-words">{item.output}</div></div>}</div>
          {item.error && <p className="mt-2 text-sm text-amber-700">{item.error}</p>}
          {job && item.state === 'candidate' && <div className="mt-2 flex gap-2"><button disabled={busy || running} onClick={() => void decide([item.id], true)} className={`${button} text-emerald-700`}><Check size={14} />采用此段</button><button disabled={busy || running} onClick={() => void decide([item.id], false)} className={button}>放弃此段</button></div>}
        </section>)}</div>
        {maxPage > 0 && <div className="mt-3 flex items-center justify-center gap-3 text-sm"><button aria-label="上一页结果" title="上一页结果" disabled={!visiblePage} onClick={() => setPage(visiblePage - 1)} className={button}><ChevronLeft size={16} /></button>{visiblePage + 1} / {maxPage + 1}<button aria-label="下一页结果" title="下一页结果" disabled={visiblePage === maxPage} onClick={() => setPage(visiblePage + 1)} className={button}><ChevronRight size={16} /></button></div>}
        {busy && <p role="status" className="mt-3 text-sm">正在处理操作…</p>}
        </div>
        {restoreMode && <section aria-label="恢复识别原文" className="space-y-4 text-sm"><p>仅恢复原文，不重新运行 OCR、不调用模型、不收费。译文与段号保留；已有译文的段落标为存疑。没有原始记录、未改动或合并的段落会跳过。恢复操作也会留下修订记录。</p><div className="flex flex-wrap items-center gap-2"><label>第 <input aria-label="恢复起始段" type="number" min={1} max={total} value={restoreFrom} onChange={event => setRestoreFrom(Number(event.target.value))} className="w-24 rounded border p-2" /> 段</label><label>至 <input aria-label="恢复结束段" type="number" min={restoreFrom} max={total} value={restoreTo} onChange={event => setRestoreTo(Number(event.target.value))} className="w-24 rounded border p-2" /> 段</label></div><button type="button" disabled={busy || !!running || !Number.isInteger(restoreFrom) || !Number.isInteger(restoreTo) || restoreFrom < 1 || restoreTo < restoreFrom || restoreTo > total} className={`${button} border-amber-600 bg-amber-600 text-white`} onClick={() => { if (window.confirm(`恢复第 ${restoreFrom}–${restoreTo} 段的最初识别原文？当前原文的后续修改将被替换，译文保留。`)) void execute(async () => { const result = await api.restoreRecognition(restoreFrom, restoreTo); setRestoreMessage(`已恢复 ${result.restored} 段，跳过 ${result.skipped} 段。`); await onChanged(); setPlan(await api.planBatch(scope)) }) }}>{busy ? '正在恢复…' : '恢复所选段落原文'}</button><p role="status" className="text-emerald-700">{restoreMessage}</p>{error && <p role="alert" className="text-red-700">{error}</p>}</section>}
      </div>
    </div>
  </div>
}
