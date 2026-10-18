import { dialog, nativeImage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { ipcMain } from './secure-ipc'
import { getCurrentDbPath, getDb } from '../db'
import { getConfigForTask } from './llm'
import { chat, type LlmCallConfig } from '../services/llm-adapter'
import { recordGeneration, finishGeneration } from '../services/revision-history'
import { storeResource, readResource } from '../services/project-resources'
import { setRecognitionPaused } from '../services/pdf-recognition'
import { updateRecognitionFiles } from './recognition'
import { VISION_PAGE_NOTICE, VISION_PAGE_PROMPT, parseVisionPage, validateVisionPageBlocks, type VisionPageBlock } from '../../shared/vision-page'
import type { RecognizedBlock } from '../../shared/ipc-api'
import { alignVisionPageBounds } from '../../shared/vision-layout'
import { adoptVisionPage, finishVisionPage, getVisionPage, listVisionPages, planVisionPages, protectedVisionPage, recoverVisionPages, saveVisionPage, visionPageSnapshot } from '../services/vision-page'

const approvals=new Map<string,{db:Database;path:string;config:LlmCallConfig;pages:Map<number,string>;expires:number}>()
const active=new WeakSet<Database>()
export function registerVisionPageHandlers() {
  ipcMain.handle('ocr:pagePlan',(_e,total:number,from:number,to:number)=>planVisionPages(getDb(),total,from,to))
  ipcMain.handle('ocr:pageList',()=>{const db=getDb();if(!active.has(db))recoverVisionPages(db);return listVisionPages(db)})
  ipcMain.handle('ocr:pageGet',(_e,id:string)=>getVisionPage(getDb(),id))
  ipcMain.handle('ocr:pageImage',(_e,id:string)=>{
    const bytes=readResource(getDb(),getVisionPage(getDb(),id).imagePath)
    if(!bytes) throw new Error('整页预览图片不存在。')
    return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
  })
  ipcMain.handle('ocr:pageApprove',async (_e,path:string,total:number,pages:number[],maxTokens?:number)=>{
    const db=getDb()
    if(path!==getCurrentDbPath() || active.has(db)) throw new Error('工程已切换或有整页请求尚未结束。')
    planVisionPages(db,total,1,total)
    if(!Array.isArray(pages) || !pages.length || pages.length>50 || pages.some(p=>!Number.isSafeInteger(p) || p<0 || p>=total) || new Set(pages).size!==pages.length) throw new Error('一次最多试识别 50 页，请选择有效 PDF 页码。')
    const config=await getConfigForTask('vision_ocr')
    if(!config) throw new Error('请先在设置中配置支持图片的 AI 视觉识别模型。')
    if(maxTokens!==undefined){if(!Number.isSafeInteger(maxTokens)||maxTokens<512||maxTokens>32768)throw new Error('整页输出上限必须是 512–32768 的整数。');config.maxTokens=maxTokens}
    const answer=await dialog.showMessageBox({type:'warning',title:'AI 整页识别与分块（测试）',message:`发送 ${pages.length} 张整页图片进行识别与分块？`,detail:`${VISION_PAGE_NOTICE}\n\n模型：${config.model}\n服务：${new URL(config.baseUrl.replace(/#$/,'')).origin}\nPDF 页码：${pages.map(p=>p+1).join('、')}\n将上传这些页面的完整图像，可能含正文、图片及个人信息。预计 ${pages.length} 次模型请求，可能收费；不上传整本 PDF 文件。\n结果仅预览，空白待识别页需要逐页确认才写入。已有段落的页仅作预览，禁止覆盖。暂停或关闭后不再发送下一页，当前请求可能继续计费。\n每页最长等待 120 秒，本次整页输出上限为（${config.maxTokens} tokens），不改变模型配置；内容密集时可能不足；失败不会自动重试。`,buttons:['取消','发送所选整页图片'],defaultId:0,cancelId:0,noLink:true})
    if(answer.response!==1) return null
    if(db!==getDb() || path!==getCurrentDbPath() || active.has(db)) throw new Error('当前工程或任务状态已变化，未发送。')
    setRecognitionPaused(db,true)
    const known=Number((db.prepare("SELECT value FROM project_meta WHERE key='recognition_total'").get() as {value:string}|undefined)?.value || 0)
    if(!known) db.prepare("INSERT INTO project_meta(key,value) VALUES('recognition_total',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(total))
    for(const [key,a] of approvals) if(a.db===db || a.expires<Date.now()) approvals.delete(key)
    const token=randomUUID()
    approvals.set(token,{db,path,config,pages:new Map(pages.map(p=>[p,visionPageSnapshot(db,p)])),expires:Date.now()+7200000})
    return token
  })
  ipcMain.handle('ocr:pageRun',async (_e,token:string,pageIdx:number,dataUrl:string,anchors:RecognizedBlock[]=[])=>{
    const approval=approvals.get(token),db=getDb()
    if(!approval || approval.db!==db || approval.path!==getCurrentDbPath() || approval.expires<Date.now() || !approval.pages.has(pageIdx)) throw new Error('整页上传授权失效或页码不在授权范围，请重新确认。')
    if(active.has(db)) throw new Error('请等待当前整页请求结束。')
    if(!Array.isArray(anchors))throw new Error('无效的本机文字层坐标。')
    anchors=validateVisionPageBlocks(anchors.map(anchor=>({...anchor,type:'paragraph'})))
    const snapshot=approval.pages.get(pageIdx)!
    if(snapshot!==visionPageSnapshot(db,pageIdx)) throw new Error('页面资料已变化，请重新确认；未发送图片。')
    if(typeof dataUrl!=='string' || dataUrl.length>16000000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('整页图片无效或过大。')
    const bytes=Buffer.from(dataUrl.split(',')[1],'base64'),size=nativeImage.createFromBuffer(bytes).getSize()
    if(!size.width || !size.height || Math.max(size.width,size.height)>4500 || size.width*size.height>8500000) throw new Error('整页图片尺寸无效或超过上限。')
    active.add(db);approval.pages.delete(pageIdx)
    let generationId:number|undefined
    const imagePath=`files/recognition/vision-pages/${createHash('sha256').update(bytes).digest('hex')}.png`
    const protectedPage=protectedVisionPage(db,pageIdx)
    let candidateId:string|undefined
    try {
      storeResource(db,imagePath,bytes)
      candidateId=saveVisionPage(db,{pageIdx,snapshot,imagePath,...size,blocks:[],status:'running',protectedPage}).id
      const request=recordGeneration(db,{task:'vision_page',input:{pageIdx,imagePath,...size,prompt:VISION_PAGE_PROMPT},model:{model:approval.config.model,protocol:approval.config.protocol,maxTokens:approval.config.maxTokens}})
      const result=await chat(approval.config,[{role:'system',content:VISION_PAGE_PROMPT},{role:'user',content:[{type:'text',text:'识别完整页面，按阅读顺序返回全部文字分块及整页坐标。'},{type:'image_url',image_url:{url:dataUrl}}]}],120000)
      if(db!==getDb() || !db.open) throw new Error('工程已切换，未写入结果。')
      let error=result.ok?undefined:result.error || '整页识别失败，未写入工程。',blocks:VisionPageBlock[]=[],aligned=0
      if(result.ok) try {
        const raw=result.rawResponse as {choices?:{finish_reason?:string}[];stop_reason?:string;status?:string;incomplete_details?:unknown}|undefined
        if(raw?.choices?.some(c=>c.finish_reason==='length') || raw?.stop_reason==='max_tokens' || raw?.status==='incomplete' || raw?.incomplete_details) throw new Error('整页输出被截断，未采用。请增加模型最大 token 后再试，可能增加费用。')
        blocks=parseVisionPage(result.text || '')
        const layout=alignVisionPageBounds(blocks,anchors);blocks=layout.blocks;aligned=layout.aligned
      } catch(e) {error=String(e)}
      generationId=finishGeneration(db,request,{...result,error})
      return finishVisionPage(db,candidateId,blocks,error,generationId,{version:2,aligned})
    } catch(error) {
      if(candidateId&&db===getDb()&&db.open)return finishVisionPage(db,candidateId,[],String(error),generationId)
      throw error
    } finally {active.delete(db)}
  })
  ipcMain.handle('ocr:pageAdopt',async (_e,id:string,blocks:VisionPageBlock[])=>{
    const db=getDb(),candidate=getVisionPage(db,id)
    blocks=validateVisionPageBlocks(blocks)
    if(active.has(db)) throw new Error('请先暂停并等待当前页识别结束。')
    if(protectedVisionPage(db,candidate.pageIdx)) throw new Error('该页已有翻译段或识别记录，只能预览，禁止覆盖式重分块。')
    const answer=await dialog.showMessageBox({type:'warning',title:'确认写入整页分块',message:blocks.length?`将 PDF 第 ${candidate.pageIdx+1} 页的 ${blocks.length} 个分块写入工程？`:`确认 PDF 第 ${candidate.pageIdx+1} 页完全没有需要翻译的文字？`,detail:'这是测试功能，请核对文字、框的位置及阅读顺序。将建立待译段落，不生成译文，不自动通过。已有页面禁止覆盖。',buttons:['取消','确认写入此页'],defaultId:0,cancelId:0,noLink:true})
    if(answer.response!==1) return null
    if(db!==getDb()) throw new Error('工程已切换。')
    const adopted=adoptVisionPage(db,id,blocks)
    try {updateRecognitionFiles()} catch(error) {adopted.warnings.push(`此页已写入，但识别文档更新失败：${String(error)}`)}
    return adopted
  })
  ipcMain.handle('ocr:pageDiscard',(_e,id:string)=>{
    const db=getDb(),candidate=getVisionPage(db,id)
    if(active.has(db)) throw new Error('请先等待当前整页请求结束。')
    if(candidate.status==='applied') throw new Error('已写入结果不能在此删除。')
    candidate.status='discarded'
    db.prepare('UPDATE vision_page_candidate SET data=? WHERE id=?').run(JSON.stringify(candidate),id)
    return candidate
  })
}
