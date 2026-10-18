import assert from 'node:assert/strict'
import { readFileSync,mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initializeRevisionHistory } from '../src/main/services/revision-history'
import { adoptVisionPage,getVisionPage,listVisionPages,planVisionPages,recoverVisionPages,saveVisionPage,visionPageSnapshot } from '../src/main/services/vision-page'
import { commitRecognizedPage } from '../src/main/services/pdf-recognition'
import type { VisionPageBlock } from '../src/shared/vision-page'

async function main(){
  const db=new Database(':memory:')
  db.exec(readFileSync('src/main/db/schema.sql','utf8'));db.pragma('recursive_triggers=ON');initializeRevisionHistory(db)
  db.exec("INSERT INTO project_meta(key,value) VALUES('recognition_total','8'),('recognition_paused','1'),('pdf_path','files/original.pdf'); INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order,bbox_json,raw_block) VALUES(21,0,'paragraph','Human original','人工译稿','done',15,'[0,0,1,1]','{\"text\":\"original baseline\"}'); INSERT INTO recognized_page(page_idx,method,blocks_json) VALUES(1,'offline','[]');")
  const original=db.prepare('SELECT * FROM paragraph WHERE id=21').get()
  const blocks:VisionPageBlock[]=[{text:'日本語の見出し',type:'title',box:{left:.1,top:.1,width:.5,height:.1}},{text:'省エネ性 2.36 kW',type:'paragraph',box:{left:.1,top:.3,width:.6,height:.2}}]
  const create=(pageIdx:number)=>saveVisionPage(db,{pageIdx,snapshot:visionPageSnapshot(db,pageIdx),imagePath:'image.png',width:1000,height:1400,blocks,status:'candidate',protectedPage:pageIdx<2})
  assert.deepEqual(planVisionPages(db,8,1,8).protected,[0,1])
  assert.throws(()=>planVisionPages(db,9,1,9),/页数/)
  assert.throws(()=>planVisionPages(db,8,0,8),/页码范围/)
  const protectedCandidate=create(0)
  assert.throws(()=>adoptVisionPage(db,protectedCandidate.id,blocks),/只能预览/)
  assert.throws(()=>commitRecognizedPage(db,0,blocks,'AI'),/已有翻译段/)
  assert.deepEqual(db.prepare('SELECT * FROM paragraph WHERE id=21').get(),original)
  const emptyProtected=create(1)
  assert.throws(()=>adoptVisionPage(db,emptyProtected.id,blocks),/只能预览/)
  const candidate=create(2)
  assert.equal((db.prepare('SELECT count(*) AS n FROM paragraph').get() as {n:number}).n,1,'Preview must not create paragraphs')
  assert.ok(planVisionPages(db,8,1,8).existingCandidates.includes(2))
  const edited=[{...blocks[0],text:'編集済み見出し'},blocks[1]]
  adoptVisionPage(db,candidate.id,edited)
  assert.deepEqual(db.prepare('SELECT en_text,zh_text,status,type FROM paragraph WHERE page_idx=2 ORDER BY sort_order').all(),[{en_text:edited[0].text,zh_text:'',status:'todo',type:'title'},{en_text:edited[1].text,zh_text:'',status:'todo',type:'paragraph'}])
  assert.equal(getVisionPage(db,candidate.id).status,'applied')
  assert.equal((db.prepare("SELECT value FROM project_meta WHERE key='recognition_paused'").get() as {value:string}).value,'1')
  assert.throws(()=>adoptVisionPage(db,candidate.id,edited),/不可采用/)
  const late=create(3)
  db.exec("INSERT INTO paragraph(page_idx,type,en_text,zh_text,status,sort_order) VALUES(3,'paragraph','Manual addition','人工补录译文','doing',99)")
  assert.throws(()=>adoptVisionPage(db,late.id,blocks),/已有翻译段/)
  assert.equal((db.prepare('SELECT zh_text FROM paragraph WHERE page_idx=3').get() as {zh_text:string}).zh_text,'人工补录译文')
  const blank=saveVisionPage(db,{pageIdx:4,snapshot:visionPageSnapshot(db,4),imagePath:'image.png',width:100,height:200,blocks:[],status:'candidate',protectedPage:false})
  adoptVisionPage(db,blank.id,[])
  assert.ok(db.prepare('SELECT 1 FROM recognized_page WHERE page_idx=4').get())
  assert.equal((db.prepare('SELECT count(*) AS n FROM paragraph WHERE page_idx=4').get() as {n:number}).n,0)
  const invalid=create(5)
  assert.throws(()=>adoptVisionPage(db,invalid.id,[{...blocks[0],box:{left:1,top:0,width:1,height:1}}]),/区域坐标/)
  assert.equal(getVisionPage(db,invalid.id).status,'candidate')
  const relinked=create(6)
  db.exec("UPDATE project_meta SET value='different.pdf' WHERE key='pdf_path'")
  assert.throws(()=>adoptVisionPage(db,relinked.id,blocks),/资料已变化/)
  assert.deepEqual(db.prepare('SELECT * FROM paragraph WHERE id=21').get(),original)
  assert.ok(db.prepare("SELECT 1 FROM revision_event WHERE action='采用 AI 整页识别（测试）' AND kind='decision'").get())
  const summary=listVisionPages(db).find(row=>row.id===candidate.id)!
  assert.equal(summary.blockCount,2);assert.equal('blocks' in summary,false)
  const interrupted=saveVisionPage(db,{pageIdx:7,snapshot:visionPageSnapshot(db,7),imagePath:'image.png',width:100,height:100,blocks:[],status:'running',protectedPage:false})
  recoverVisionPages(db)
  assert.equal(getVisionPage(db,interrupted.id).status,'failed')
  assert.match(getVisionPage(db,interrupted.id).error!,/可能已计费/)
  const directory=mkdtempSync(join(tmpdir(),'traloom-vision-page-')),file=join(directory,'sample.twproj')
  await db.backup(file);const reopened=new Database(file)
  assert.equal(getVisionPage(reopened,candidate.id).status,'applied')
  assert.equal(getVisionPage(reopened,invalid.id).status,'candidate')
  reopened.close();db.close();rmSync(directory,{recursive:true,force:true})
  console.log('Vision page safety: protected translations, manual supplements, blank recognized pages, stale candidates, PDF relinking, review edits, original baselines and portable candidate persistence passed.')
}
void main().catch(error=>{console.error(error);process.exitCode=1})
