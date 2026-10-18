import type { Database } from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import type { VisionPageCandidate, VisionPageBlock, VisionPagePlan, VisionPageSummary } from '../../shared/vision-page'
import { validateVisionPageBlocks, visionPageWarnings } from '../../shared/vision-page'
import { commitRecognizedPage } from './pdf-recognition'
import { withRevisionContext, recordDecision } from './revision-history'

function initialize(db: Database) { db.exec('CREATE TABLE IF NOT EXISTS vision_page_candidate(id TEXT PRIMARY KEY,page_idx INTEGER NOT NULL,data TEXT NOT NULL)') }
export function protectedVisionPage(db: Database, pageIdx: number): boolean {
  return !!db.prepare('SELECT 1 FROM paragraph WHERE page_idx=? LIMIT 1').get(pageIdx) || !!db.prepare('SELECT 1 FROM recognized_page WHERE page_idx=?').get(pageIdx)
}
export function visionPageSnapshot(db: Database, pageIdx: number): string {
  const meta = db.prepare("SELECT key,value FROM project_meta WHERE key IN ('pdf_path','recognition_total') ORDER BY key").all()
  const pdf = db.prepare("SELECT sha256 FROM project_resource WHERE path=(SELECT value FROM project_meta WHERE key='pdf_path')").get()
  return createHash('sha256').update(JSON.stringify({meta,pdf,paragraphs:db.prepare('SELECT * FROM paragraph WHERE page_idx=? ORDER BY id').all(pageIdx),page:db.prepare('SELECT * FROM recognized_page WHERE page_idx=?').get(pageIdx)})).digest('hex')
}
export function listVisionPages(db: Database): VisionPageSummary[] {
  initialize(db)
  return (db.prepare("SELECT json_remove(data,'$.blocks') AS data,json_array_length(data,'$.blocks') AS blockCount FROM vision_page_candidate ORDER BY rowid DESC").all() as {data:string;blockCount:number}[]).map(row=>({...JSON.parse(row.data),blockCount:row.blockCount}))
}
export function getVisionPage(db: Database,id:string): VisionPageCandidate {
  initialize(db)
  if (typeof id !== 'string' || id.length>100) throw new Error('无效的整页识别记录。')
  const row=db.prepare('SELECT data FROM vision_page_candidate WHERE id=?').get(id) as {data:string}|undefined
  if (!row) throw new Error('整页识别记录不存在。')
  return JSON.parse(row.data)
}
export function saveVisionPage(db: Database,input:Omit<VisionPageCandidate,'id'|'createdAt'|'warnings'>):VisionPageCandidate {
  initialize(db)
  const blocks=validateVisionPageBlocks(input.blocks)
  const candidate={...input,blocks,id:randomUUID(),createdAt:new Date().toISOString(),warnings:visionPageWarnings(blocks)}
  db.prepare('INSERT INTO vision_page_candidate(id,page_idx,data) VALUES(?,?,?)').run(candidate.id,candidate.pageIdx,JSON.stringify(candidate))
  return candidate
}
export function finishVisionPage(db:Database,id:string,blocks:VisionPageBlock[],error:string|undefined,generationId?:number,layout?:VisionPageCandidate['layout']):VisionPageCandidate {
  const candidate=getVisionPage(db,id)
  candidate.blocks=validateVisionPageBlocks(blocks);candidate.error=error;candidate.generationId=generationId
  if(layout)candidate.layout=layout
  candidate.status=error?'failed':'candidate';candidate.warnings=visionPageWarnings(candidate.blocks)
  db.prepare('UPDATE vision_page_candidate SET data=? WHERE id=?').run(JSON.stringify(candidate),id)
  return candidate
}
export function recoverVisionPages(db:Database):void {
  initialize(db)
  db.transaction(()=>{
    for(const row of db.prepare("SELECT id FROM vision_page_candidate WHERE json_extract(data,'$.status')='running'").all() as {id:string}[]) {
      const candidate=getVisionPage(db,row.id);candidate.status='failed';candidate.error='上次整页请求中断，结果未知，可能已计费；重试需重新确认上传。'
      db.prepare('UPDATE vision_page_candidate SET data=? WHERE id=?').run(JSON.stringify(candidate),candidate.id)
    }
  })()
}
export function planVisionPages(db: Database,total:number,from:number,to:number):VisionPagePlan {
  initialize(db)
  if (![total,from,to].every(Number.isSafeInteger) || total<1 || total>20000 || from<1 || to<from || to>total) throw new Error('请输入有效的 PDF 页码范围。')
  const known=Number((db.prepare("SELECT value FROM project_meta WHERE key='recognition_total'").get() as {value:string}|undefined)?.value || 0)
  if (known && known!==total) throw new Error('PDF 页数与工程记录不一致，请检查原书关联。')
  const pending=new Set((db.prepare('SELECT page_idx,data FROM vision_page_candidate').all() as {page_idx:number;data:string}[]).filter(row=>JSON.parse(row.data).status==='candidate').map(row=>row.page_idx))
  const result:VisionPagePlan={total,eligible:[],protected:[],existingCandidates:[]}
  for(let page=from-1;page<to;page++) {
    if(pending.has(page)) result.existingCandidates.push(page)
    else if(protectedVisionPage(db,page)) result.protected.push(page)
    else result.eligible.push(page)
  }
  return result
}
export function adoptVisionPage(db:Database,id:string,edited:VisionPageBlock[]):VisionPageCandidate {
  const candidate=getVisionPage(db,id)
  const blocks=validateVisionPageBlocks(edited)
  if(candidate.status!=='candidate' || candidate.protectedPage) throw new Error('此结果不可采用；已有段落的页面只能预览。')
  return db.transaction(()=>{
    if(protectedVisionPage(db,candidate.pageIdx) || candidate.snapshot!==visionPageSnapshot(db,candidate.pageIdx)) throw new Error('该页已有翻译段、识别记录或资料已变化。为保护现有工程，禁止覆盖式重分块。')
    withRevisionContext(db,'采用 AI 整页识别（测试）','human',{candidateId:id,generationId:candidate.generationId},()=>{
      commitRecognizedPage(db,candidate.pageIdx,blocks,'AI vision page (experimental)')
      const ids=db.prepare('SELECT id FROM paragraph WHERE page_idx=? ORDER BY sort_order,id').all(candidate.pageIdx) as {id:number}[]
      blocks.forEach((block,index)=>db.prepare('UPDATE paragraph SET type=? WHERE id=?').run(block.type,ids[index].id))
      recordDecision(db,id,0,{candidateId:id,pageIdx:candidate.pageIdx,generationId:candidate.generationId,blocks})
    })
    candidate.status='applied';candidate.blocks=blocks;candidate.warnings=visionPageWarnings(blocks)
    db.prepare('UPDATE vision_page_candidate SET data=? WHERE id=?').run(JSON.stringify(candidate),id)
    return candidate
  })()
}
