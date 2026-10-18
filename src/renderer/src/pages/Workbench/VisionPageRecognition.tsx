import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Eye, LoaderCircle, Pause, Play, Plus, Settings, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
// @ts-ignore Vite asset URL
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { api } from '@renderer/lib/ipc'
import { groupPdfText, type PdfTextItem } from '@renderer/lib/pdf-blocks'
import { VISION_PAGE_NOTICE, validateVisionPageBlocks, visionPageWarnings, type VisionPageBlock, type VisionPageCandidate, type VisionPagePlan, type VisionPageSummary } from '@shared/vision-page'

pdfjs.GlobalWorkerOptions.workerSrc=workerUrl
const button='inline-flex items-center justify-center gap-1 rounded border px-3 py-2 text-sm disabled:opacity-40'
const statusNames={running:'请求进行中',candidate:'待核对',applied:'已写入',failed:'失败',discarded:'已放弃'}
const blockNames={paragraph:'正文',title:'标题',caption:'图注',table:'表格',footer:'页脚'}

export async function renderVisionPage(pdf:pdfjs.PDFDocumentProxy,pageIdx:number):Promise<string> {
  const page=await pdf.getPage(pageIdx+1),base=page.getViewport({scale:1})
  const view=page.getViewport({scale:Math.min(6,4096/Math.max(base.width,base.height),Math.sqrt(8000000/(base.width*base.height)))})
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height)
  try {
    const context=canvas.getContext('2d')!
    await page.render({canvasContext:context,viewport:view,background:'white'}).promise
    // Guides share the PDF canvas dimensions: no crop or scale offset is introduced.
    context.save();context.strokeStyle='rgba(35,115,155,0.18)';context.lineWidth=1
    for(let tick=100;tick<1000;tick+=100) {
      const x=tick*canvas.width/1000,y=tick*canvas.height/1000
      context.beginPath();context.moveTo(x,0);context.lineTo(x,canvas.height);context.moveTo(0,y);context.lineTo(canvas.width,y);context.stroke()
    }
    context.font=`${Math.max(12,Math.round(canvas.width/140))}px sans-serif`;context.fillStyle='#276b89';context.textBaseline='top'
    for(let tick=0;tick<=1000;tick+=100) {
      context.fillText(String(tick),Math.min(canvas.width-45,tick*canvas.width/1000+2),2)
      context.fillText(String(tick),2,Math.min(canvas.height-24,tick*canvas.height/1000+2))
    }
    context.restore();return canvas.toDataURL('image/png')
  }
  finally {canvas.width=0;canvas.height=0;page.cleanup()}
}

async function visionPageAnchors(pdf:pdfjs.PDFDocumentProxy,pageIdx:number) {
  const page=await pdf.getPage(pageIdx+1),view=page.getViewport({scale:1})
  try {
    const content=await page.getTextContent()
    const items=content.items.filter(item=>'str' in item&&!!item.str.trim()) as PdfTextItem[]
    const groups=groupPdfText(items,view.width,view.height,view.transform,true)
    const fragments=items.flatMap(item=>groupPdfText([{...item,hasEOL:true}],view.width,view.height,view.transform,true))
    return [...groups,...fragments].filter(b=>b.text.length<=2000).slice(0,500)
  } catch {return []}
  finally {page.cleanup()}
}

export default function VisionPageRecognition({onClose,onChanged,onSettings}:{onClose:()=>void;onChanged:()=>Promise<void>;onSettings:()=>void}) {
  const [total,setTotal]=useState(0),[path,setPath]=useState(''),[from,setFrom]=useState('1'),[to,setTo]=useState('1'),[trial,setTrial]=useState('2')
  const [plan,setPlan]=useState<VisionPagePlan|null>(null),[includeProtected,setIncludeProtected]=useState(false)
  const [history,setHistory]=useState<VisionPageSummary[]>([]),[candidate,setCandidate]=useState<VisionPageCandidate|null>(null)
  const [blocks,setBlocks]=useState<VisionPageBlock[]>([]),[selected,setSelected]=useState(0),[listPage,setListPage]=useState(0)
  const [image,setImage]=useState(''),[showBoxes,setShowBoxes]=useState(true),[zoom,setZoom]=useState<'page'|'width'|number>('page')
  const [running,setRunning]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')
  const [model,setModel]=useState(''),[ready,setReady]=useState(false),[loading,setLoading]=useState(true)
  const [remaining,setRemaining]=useState<number[]>([]),[progress,setProgress]=useState({done:0,total:0})
  const [planning,setPlanning]=useState(true),[controlsOpen,setControlsOpen]=useState(true),[outputTokens,setOutputTokens]=useState('8192')
  const stop=useRef(false),alive=useRef(true),pdf=useRef<pdfjs.PDFDocumentProxy|null>(null),lock=useRef(false)
  const previewRef=useRef<HTMLDivElement>(null),[previewSize,setPreviewSize]=useState({width:500,height:400})
  const refreshHistory=async()=>{const values=await api.listVisionPages();if(alive.current)setHistory(values)}
  const showCandidate=(value:VisionPageCandidate)=>{setCandidate(value);setBlocks(value.blocks);setSelected(0);setListPage(0);setControlsOpen(false)}
  useEffect(()=>{
    alive.current=true;stop.current=false
    let task:pdfjs.PDFDocumentLoadingTask|undefined
    void (async()=>{
      try {
        const state=await api.getRecognitionState();if(!alive.current)return;setPath(state.projectPath)
        const status=await api.getLlmStatus('vision_ocr');if(!alive.current)return
        setModel(status.model || '未配置模型');setReady(status.state!=='unconfigured' && !!status.model?.trim())
        await refreshHistory()
        const bytes=await api.readPdf();if(!alive.current)return
        if(!bytes)throw new Error('找不到原书 PDF，请先重新关联原书。')
        task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false})
        const doc=await task.promise
        if(!alive.current){await doc.destroy();return}
        pdf.current=doc;setTotal(doc.numPages);setTo(String(doc.numPages))
      }catch(e){if(alive.current)setError(String(e))}finally{if(alive.current)setLoading(false)}
    })()
    return()=>{alive.current=false;stop.current=true;if(!lock.current){void task?.destroy();pdf.current=null}}
  },[])
  useEffect(()=>{
    if(!total)return
    let current=true;setPlan(null);setPlanning(true)
    const a=Number(from),b=Number(to)
    if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<a||b>total){setPlanning(false);return}
    void api.planVisionPages(total,a,b).then(value=>{if(current)setPlan(value)}).catch(e=>{if(current)setError(String(e))}).finally(()=>{if(current)setPlanning(false)})
    return()=>{current=false}
  },[total,from,to,history])
  useEffect(()=>{
    let current=true,url='';setImage('')
    if(candidate)void api.readVisionPageImage(candidate.id).then(bytes=>{url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));if(current)setImage(url);else URL.revokeObjectURL(url)}).catch(e=>{if(current)setError(String(e))})
    return()=>{current=false;if(url)URL.revokeObjectURL(url)}
  },[candidate?.id])
  useEffect(()=>{
    if(!previewRef.current)return
    const observer=new ResizeObserver(entries=>{const r=entries[0].contentRect;setPreviewSize({width:r.width,height:r.height})})
    observer.observe(previewRef.current);return()=>observer.disconnect()
  },[candidate?.id])
  const dirty=!!candidate && JSON.stringify(blocks)!==JSON.stringify(candidate.blocks)
  const switchCandidate=async(id:string)=>{
    if(dirty&&!window.confirm('放弃当前页尚未写入的分块编辑？原工程不会改变。'))return
    setBusy(true);setError('')
    try{showCandidate(await api.getVisionPage(id))}catch(e){setError(String(e))}finally{setBusy(false)}
  }
  const eligible=useMemo(()=>plan?[...plan.eligible,...(includeProtected?plan.protected:[])].sort((a,b)=>a-b):[],[plan,includeProtected])
  const validOutputTokens=Number.isSafeInteger(Number(outputTokens))&&Number(outputTokens)>=512&&Number(outputTokens)<=32768
  const run=async(pages:number[])=>{
    if(lock.current||!pdf.current||!pages.length||!validOutputTokens)return
    if(dirty&&!window.confirm('开始后将显示新的识别预览，放弃当前尚未写入的分块编辑？'))return
    lock.current=true;stop.current=false;setRunning(true);setError('');setProgress({done:0,total:pages.length});setRemaining(pages)
    const doc=pdf.current
    try{
      const token=await api.approveVisionPages(path,total,pages,Number(outputTokens))
      if(!token||stop.current){setMessage('已取消，未发送后续页面。');return}
      for(let index=0;index<pages.length;index++){
        if(stop.current||!alive.current)break
        setMessage(`正在准备 PDF ${pages[index]+1} 的整页图片…`)
        const dataUrl=await renderVisionPage(doc,pages[index])
        const anchors=await visionPageAnchors(doc,pages[index])
        if(stop.current||!alive.current)break
        setMessage(`正在识别 PDF ${pages[index]+1}，等待模型返回；最长 120 秒，不会自动重试…`)
        const result=await api.runVisionPage(token,pages[index],dataUrl,anchors)
        if(!alive.current)break
        showCandidate(result);setRemaining(pages.slice(index+1));setProgress({done:index+1,total:pages.length})
        await refreshHistory()
        if(result.status==='failed'){setMessage(`PDF ${pages[index]+1} 未通过识别校验，已停止；原译稿未改变。`);throw new Error(result.error || '识别失败，已暂停后续页。')}
      }
      if(alive.current)setMessage(stop.current?'已暂停；当前返回结果仅供预览。':'本批识别结束。请逐页核对分块，确认后才写入。')
    }catch(e){if(alive.current)setError(String(e))}
    finally{lock.current=false;if(alive.current){setRunning(false);await onChanged()}else{await doc.destroy();pdf.current=null}}
  }
  let validation=''
  try{validateVisionPageBlocks(blocks)}catch(e){validation=String(e)}
  const warnings=validation?[]:visionPageWarnings(blocks)
  const selectedBlock=blocks[selected]
  const changeBlock=(patch:Partial<VisionPageBlock>)=>setBlocks(previous=>previous.map((b,index)=>index===selected?{...b,...patch}:b))
  const moveBlock=(direction:number)=>{
    const next=selected+direction;if(next<0||next>=blocks.length)return
    setBlocks(previous=>{const copy=[...previous];[copy[selected],copy[next]]=[copy[next],copy[selected]];return copy});setSelected(next);setListPage(Math.floor(next/20))
  }
  const decide=async(adopt:boolean)=>{
    if(!candidate)return;setBusy(true);setError('')
    try{
      const result=adopt?await api.adoptVisionPage(candidate.id,blocks):await api.discardVisionPage(candidate.id)
      if(result){showCandidate(result);await refreshHistory();await onChanged();setMessage(adopt?'此页已写入，已建立待译段落。':'已放弃此候选；原工程内容没有改变。')}
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  const editable=candidate?.status==='candidate'&&!running&&!busy
  const imageWidth=candidate?(zoom==='page'?Math.max(1,Math.min(previewSize.width-16,(previewSize.height-16)*candidate.width/candidate.height)):Math.max(1,previewSize.width-16)*(zoom==='width'?1:zoom/100)):0
  const close=()=>{if(dirty&&!window.confirm('放弃尚未写入的分块编辑并关闭？'))return;stop.current=true;onClose()}
  return <div role="dialog" aria-modal="true" aria-labelledby="vision-page-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3">
    <div className="flex max-h-[96vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
      <header className="flex items-center justify-between border-b px-5 py-3"><h2 id="vision-page-title" className="font-medium">AI 整页识别与分块（测试）</h2><button aria-label="关闭整页识别" title="关闭后停止后续页；当前请求可能仍计费" onClick={close} className="p-2"><X size={18}/></button></header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <p role="note" className="mb-3 border-l-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-800">{VISION_PAGE_NOTICE} 已有翻译段的页面只能对照预览，不能覆盖式重分块。</p>
        {!!candidate&&<button type="button" aria-expanded={controlsOpen} className={`${button} mb-3`} onClick={()=>setControlsOpen(value=>!value)}><ChevronDown size={15}/>识别范围与费用 · PDF {from}–{to}</button>}
        <div hidden={!controlsOpen}>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm"><label>PDF 第 <input aria-label="整页起始 PDF 页码" type="number" min={1} max={total} value={from} disabled={running||loading} onChange={e=>{setFrom(e.target.value);setRemaining([])}} className="w-20 rounded border p-2"/> 页</label><label>至第 <input aria-label="整页结束 PDF 页码" type="number" min={1} max={total} value={to} disabled={running||loading} onChange={e=>{setTo(e.target.value);setRemaining([])}} className="w-20 rounded border p-2"/> 页</label><label>先试 <input aria-label="整页试处理数量" type="number" min={1} max={50} disabled={running} value={trial} onChange={e=>setTrial(e.target.value)} className="w-16 rounded border p-2"/> 页</label><label className="flex items-center gap-2"><input type="checkbox" checked={includeProtected} disabled={running} onChange={e=>{setIncludeProtected(e.target.checked);setRemaining([])}}/>包括已有段落的页面（仅预览）</label></div>
        {loading||planning?<p role="status" className="mb-3 text-sm">{loading?'正在加载原书 PDF 与模型配置…':'正在核对页面范围…'}</p>:<p className="mb-3 text-sm text-neutral-600">共 {total} 页；范围内可处理 {eligible.length} 页，已有页面 {plan?.protected.length??0} 页，已有待核对结果 {plan?.existingCandidates.length??0} 页（从历史结果继续核对，不重复收费识别）。</p>}
        {!loading&&!planning&&!plan&&<p className="mb-3 text-sm text-red-700">请输入有效 PDF 页码范围（1–{total}）。</p>}
        <p className="mb-3 text-sm text-amber-800">模型：{model || '正在检查'}。上传所选页的完整图像，可能产生费用。当前仅保留文字与分块，不还原复杂表格版式；每批最多 50 页，结果逐页确认。</p>
        <label className="mb-3 block text-sm">整页输出上限 <input aria-label="整页输出 token 上限" type="number" min={512} max={32768} step={512} disabled={running} value={outputTokens} onChange={e=>setOutputTokens(e.target.value)} className="w-24 rounded border p-2"/> tokens <span className="text-neutral-500">仅用于本次整页任务，不改变模型配置。密集页面建议 8192 或更多；可能增加费用，不能超过服务商允许的上限。</span></label>
        <div className="mb-3 flex flex-wrap gap-2">
          {!validOutputTokens&&<p role="alert" className="w-full text-sm text-red-700">整页输出上限请输入 512–32768 的整数。</p>}
          {!ready&&!loading&&<button className={`${button} text-blue-700`} onClick={onSettings}><Settings size={16}/>配置视觉模型</button>}
          {running?<button className={button} onClick={()=>{stop.current=true;setMessage('正在暂停；当前页返回后不再发送下一页。')}}><Pause size={16}/>暂停后续页面</button>:<>
            {!!eligible.length&&<><button disabled={busy||loading||planning||!ready||!validOutputTokens||!Number.isInteger(Number(trial))||Number(trial)<1||Number(trial)>50} onClick={()=>void run(eligible.slice(0,Number(trial)))} className={`${button} bg-blue-600 text-white`}><Play size={16}/>先试 {Math.min(Number(trial)||0,eligible.length)} 页</button>
            <button disabled={busy||loading||planning||!ready||!validOutputTokens||eligible.length>50} onClick={()=>void run(eligible)} className={button}>识别范围内全部 {eligible.length} 页（先预览）</button></>}
            {!!remaining.length&&<button disabled={busy||!ready||!validOutputTokens} className={button} onClick={()=>void run(remaining)}>继续剩余 {remaining.length} 页（重新确认上传）</button>}
          </>}
        </div>
        {!loading&&!planning&&plan&&!eligible.length&&<p className="mb-3 text-sm text-neutral-600">范围内没有新的待识别页。已有候选请从历史结果核对；需要对照已有页面时，勾选“包括已有段落的页面（仅预览）”。</p>}
        {eligible.length>50&&<p className="mb-3 text-sm text-neutral-500">当前范围超过 50 页；可先小批量试用，或缩小页码区间后分批处理。</p>}
        </div>
        {running&&!controlsOpen&&<button className={`${button} mb-3`} onClick={()=>{stop.current=true;setMessage('正在暂停；当前页返回后不再发送下一页。')}}><Pause size={16}/>暂停后续页面</button>}
        <p role="status" className="mb-3 text-sm text-blue-800">{running&&<LoaderCircle size={14} className="mr-1 inline animate-spin"/>}{message}{!!progress.total&&`（本批返回 ${progress.done}/${progress.total} 页）`}</p>
        {error&&<p role="alert" className="mb-3 whitespace-pre-wrap text-sm text-red-700">{error}</p>}
        <label className="mb-3 flex flex-wrap items-center gap-2 text-sm">历史结果<select aria-label="整页识别历史结果" disabled={running||busy} value={candidate?.id || ''} onChange={e=>void switchCandidate(e.target.value)} className="min-w-0 max-w-full rounded border p-2"><option value="" disabled>选择页面预览</option>{history.map(row=><option key={row.id} value={row.id}>PDF {row.pageIdx+1} · {statusNames[row.status]} · {row.blockCount} 块 · {new Date(row.createdAt).toLocaleString()}{row.protectedPage?' · 已有页面仅预览':''}</option>)}</select></label>
        {candidate&&<>
          <div className="mb-3 flex flex-wrap items-center gap-2 border-y py-2 text-sm"><strong>PDF {candidate.pageIdx+1} · {blocks.length} 块 · {statusNames[candidate.status]}</strong><button title="缩小整页预览" aria-label="缩小整页预览" className={button} onClick={()=>setZoom(previous=>Math.max(25,(typeof previous==='number'?previous:100)-25))}><ZoomOut size={16}/></button><button title="放大整页预览" aria-label="放大整页预览" className={button} onClick={()=>setZoom(previous=>Math.min(300,(typeof previous==='number'?previous:100)+25))}><ZoomIn size={16}/></button><button aria-pressed={zoom==='page'} className={button} onClick={()=>setZoom('page')}>适页</button><button aria-pressed={zoom==='width'} className={button} onClick={()=>setZoom('width')}>适宽</button><label className="flex items-center gap-1"><input type="checkbox" checked={showBoxes} onChange={e=>setShowBoxes(e.target.checked)}/><Eye size={15}/>分块区域</label></div>
          {candidate.protectedPage&&<p className="mb-3 text-sm text-amber-800">此页已有翻译段或识别记录：本结果仅供对照，不能替换原文、译文、段号或坐标。</p>}
          {candidate.error&&<p className="mb-3 text-sm text-red-700">{candidate.error}</p>}
          {candidate.status==='candidate'&&candidate.layout&&<p className="mb-3 text-sm text-neutral-600">已用本机文字层校准 {candidate.layout.aligned} 个边界；其余保留模型坐标。文字内容和阅读顺序仍须核对。</p>}
          {candidate.status!=='failed'&&!!warnings.length&&<div className="mb-3 text-sm text-amber-800">{warnings.map(w=><p key={w}>{w}</p>)}</div>}
          {validation&&<p role="alert" className="mb-3 text-sm text-red-700">{validation}</p>}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]">
            <div ref={previewRef} className="flex h-[55vh] min-h-[280px] items-start justify-center overflow-auto bg-neutral-100 p-2"><div className="relative shrink-0 bg-white" style={{width:imageWidth,height:candidate.width?imageWidth*candidate.height/candidate.width:0}}>{image&&<img src={image} alt={`PDF 第 ${candidate.pageIdx+1} 页原图与识别分块`} className="absolute inset-0 h-full w-full"/>}{showBoxes&&blocks.map((block,index)=><button key={index} aria-label={`选择第 ${index+1} 个分块`} title={`${index+1} · ${block.text}`} onClick={()=>{setSelected(index);setListPage(Math.floor(index/20))}} className={`absolute border ${index===selected?'border-amber-600 bg-amber-300/10 ring-1 ring-amber-600':'border-cyan-500/70'}`} style={{left:`${block.box.left*100}%`,top:`${block.box.top*100}%`,width:`${block.box.width*100}%`,height:`${block.box.height*100}%`}}><span className="pointer-events-none absolute -top-3 left-0 bg-white/90 px-0.5 text-[10px] leading-3 text-neutral-800">{index+1}</span></button>)}</div></div>
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between text-sm"><span>阅读顺序</span><span><button disabled={!listPage} onClick={()=>setListPage(p=>p-1)} className="px-2">上一组</button>{listPage+1}/{Math.max(1,Math.ceil(blocks.length/20))}<button disabled={(listPage+1)*20>=blocks.length} onClick={()=>setListPage(p=>p+1)} className="px-2">下一组</button></span></div>
              <div className="max-h-40 overflow-auto border-y">{blocks.slice(listPage*20,listPage*20+20).map((block,index)=>{const i=listPage*20+index;return <button key={i} onClick={()=>setSelected(i)} className={`block w-full truncate border-b px-2 py-2 text-left text-sm ${i===selected?'bg-blue-50 text-blue-700':''}`}>{i+1}. {block.text}</button>})}</div>
              {selectedBlock&&<section className="mt-3 space-y-2 text-sm" aria-label="所选分块编辑"><div className="flex flex-wrap items-center gap-2"><strong>第 {selected+1} 块</strong><select aria-label="分块类型" disabled={!editable} value={selectedBlock.type} onChange={e=>changeBlock({type:e.target.value as VisionPageBlock['type']})} className="rounded border p-1">{Object.entries(blockNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button title="在阅读顺序中上移" aria-label="分块上移" disabled={!editable||!selected} className="rounded border p-1" onClick={()=>moveBlock(-1)}><ArrowUp size={16}/></button><button title="在阅读顺序中下移" aria-label="分块下移" disabled={!editable||selected===blocks.length-1} className="rounded border p-1" onClick={()=>moveBlock(1)}><ArrowDown size={16}/></button><button title="仅删除此预览分块，不改动现有工程" aria-label="删除预览分块" disabled={!editable} className="rounded border p-1 text-red-700" onClick={()=>{setBlocks(previous=>previous.filter((_,i)=>i!==selected));setSelected(0);setListPage(0)}}><Trash2 size={16}/></button></div>
                <textarea aria-label="分块原文" disabled={!editable} value={selectedBlock.text} onChange={e=>changeBlock({text:e.target.value})} className="min-h-28 w-full rounded border p-2"/>
                <div className="grid grid-cols-2 gap-2">{(['left','top','width','height'] as const).map((key,index)=><label key={key} className="flex items-center gap-1">{['左','上','宽','高'][index]} %<input aria-label={`分块${['左','上','宽','高'][index]}百分比`} type="number" min={0} max={100} step={.1} disabled={!editable} value={Math.round(selectedBlock.box[key]*100000)/1000} onChange={e=>changeBlock({box:{...selectedBlock.box,[key]:Number(e.target.value)/100}})} className="min-w-0 flex-1 rounded border p-1"/></label>)}</div>
              </section>}
            </div>
          </div>
          <footer className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3"><button disabled={!editable} onClick={()=>{setBlocks(previous=>[...previous,{text:'',type:'paragraph',box:{left:.1,top:.1,width:.8,height:.1}}]);setSelected(blocks.length);setListPage(Math.floor(blocks.length/20))}} className={button}><Plus size={16}/>添加分块</button><button disabled={!editable||candidate.protectedPage||!!validation} onClick={()=>void decide(true)} className={`${button} bg-blue-600 text-white`}>{blocks.length?'确认此页分块并写入待译段落':'确认此页无文字并标记已识别'}</button>{candidate.status==='candidate'&&<button disabled={busy||running} className={button} onClick={()=>void decide(false)}>放弃此结果</button>}<button disabled={running||busy||loading||!ready||!validOutputTokens} className={button} onClick={()=>{setFrom(String(candidate.pageIdx+1));setTo(String(candidate.pageIdx+1));void run([candidate.pageIdx])}}>重新识别此页（可能收费）</button><span className="text-sm text-neutral-500">{dirty?'分块编辑尚未写入。':'未确认前不改动任何翻译段。'}</span></footer>
        </>}
      </div>
    </div>
  </div>
}
