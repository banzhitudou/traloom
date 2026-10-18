const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),http=require('node:http')
const {pathToFileURL}=require('node:url')
const {app,BrowserWindow,dialog,nativeImage}=require('electron')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'traloom-page-ui-'))
app.setPath('userData',temporary);app.setName('Traloom whole-page isolated test')
require('tsx/cjs')
const database=require('../src/main/db/index.ts')
const {ipcMain,trustRenderer}=require('../src/main/ipc/secure-ipc.ts')
const {registerRecognitionHandlers}=require('../src/main/ipc/recognition.ts')
const {registerVisionPageHandlers}=require('../src/main/ipc/vision-page.ts')
const service=require('../src/main/services/vision-page.ts')
const output=path.resolve('out/renderer'),bundle=path.join(output,'vision-page-check.mjs'),html=path.join(output,'vision-page-check.html')
const buildReady=require('esbuild').build({entryPoints:['tests/browser-vision-page.runtime.tsx'],bundle:true,platform:'browser',format:'esm',outfile:bundle,jsx:'automatic',alias:{'@renderer':path.resolve('src/renderer/src'),'@shared':path.resolve('src/shared')},plugins:[{name:'worker-url',setup(build){
  build.onResolve({filter:/pdf\.worker.*\?url$/},args=>({path:args.path,namespace:'worker-url'}))
  build.onLoad({filter:/.*/,namespace:'worker-url'},()=>({contents:`export default ${JSON.stringify(pathToFileURL(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')).href)}`,loader:'js'}))
}}]})
const css=fs.readdirSync(path.join(output,'assets')).find(name=>name.endsWith('.css'))
fs.writeFileSync(html,`<html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./assets/${css}"></head><body><div id="root"></div><script type="module" src="./vision-page-check.mjs"></script></body></html>`)
function pdfFixture(){
  const content='0 0 1 rg 20 200 160 60 re f\n0 0 0 rg\nBT /F1 18 Tf 20 270 Td (Heading) Tj ET\nBT /F1 14 Tf 20 150 Td (2.36 kW) Tj ET'
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 6 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let pdf='%PDF-1.4\n';const offsets=[0]
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`})
  const xref=Buffer.byteLength(pdf)
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}
const blocks=[{text:'Heading',bbox:[100,40,900,130],type:'title'},{text:'2.36 kW',bbox:[100,450,700,550],type:'paragraph'}]
let requests=0,lastImage='',truncate=false,cancel=false
const confirmations=[]
dialog.showMessageBox=async options=>{confirmations.push(options);return {response:cancel&&options.title.includes('整页')?0:1}}
const server=http.createServer((req,res)=>{
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
    try{
      const value=JSON.parse(body);assert.equal(value.model,'isolated-page-test')
      const image=value.messages.at(-1).content.find(part=>part.type==='image_url').image_url.url
      lastImage=image;const size=nativeImage.createFromDataURL(image).getSize();assert.ok(size.width>=1000&&size.height>=1000)
      requests++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:truncate?'length':'stop',message:{content:JSON.stringify({blocks})}}],usage:{total_tokens:100}}))
    }catch(error){res.writeHead(500);res.end(String(error))}
  })
})
let window
app.whenReady().then(async()=>{
  await buildReady;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const file=path.join(temporary,'isolated.twproj');fs.writeFileSync(file,'');database.openDatabase(file,{create:true});database.initSchema();const db=database.getDb()
  db.exec("INSERT INTO project_meta(key,value) VALUES('recognition_enabled','1'),('recognition_engine','vision'),('recognition_paused','1'),('recognition_total','2'),('pdf_path','files/original.pdf'),('resource_storage','embedded');INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order,bbox_json,raw_block) VALUES(11,0,'paragraph','Existing original','已有人工译文','done',1,'[0,0,1,1]','{\"text\":\"baseline\"}');")
  const original=db.prepare('SELECT * FROM paragraph WHERE id=11').get()
  db.prepare('INSERT INTO llm_config(name,protocol,base_url,model,temperature,max_tokens,is_default) VALUES(?,?,?,?,?,?,1)').run('local fake','openai_chat',`http://127.0.0.1:${server.address().port}/v1`,'isolated-page-test',0,4096)
  registerRecognitionHandlers();registerVisionPageHandlers()
  ipcMain.handle('project:readPdf',()=>{const b=pdfFixture();return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)})
  ipcMain.handle('llm:status',()=>({state:'online',model:'isolated-page-test'}))
  window=new BrowserWindow({show:false,width:1320,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.resolve('out/preload/index.js')}})
  trustRenderer(window.webContents,pathToFileURL(html).href);await window.loadFile(html)
  const evaluate=code=>window.webContents.executeJavaScript(code)
  const wait=async code=>{for(let i=0;i<200;i++){if(await evaluate(code))return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('UI timeout: '+code)}
  await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='先试 1 页'&&!b.disabled)`)
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='先试 1 页').click()`)
  await wait(`document.body.textContent.includes('本批识别结束')`)
  assert.equal(requests,1);assert.equal((db.prepare('SELECT count(*) AS n FROM paragraph').get()).n,1)
  const candidate=service.listVisionPages(db)[0];assert.equal(candidate.status,'candidate');assert.equal(candidate.pageIdx,1)
  assert.ok(candidate.layout.aligned>=1,'Text-layer geometry should calibrate a matching synthetic heading')
  assert.equal(db.prepare('SELECT max_tokens FROM llm_config').get().max_tokens,4096,'Per-run token limits must not change model settings')
  await wait(`!!document.querySelector('img')?.complete&&document.querySelector('img')?.naturalWidth>0`)
  const image=nativeImage.createFromDataURL(lastImage);const bitmap=image.toBitmap();let nonwhite=0
  for(let i=0;i<bitmap.length;i+=400)if(bitmap[i]<230||bitmap[i+1]<230||bitmap[i+2]<230)nonwhite++
  assert.ok(nonwhite>100,'Rendered PDF must have nonwhite page pixels')
  fs.writeFileSync('/tmp/traloom-vision-page-desktop.png',(await window.webContents.capturePage()).toPNG())
  await evaluate(`document.querySelector('button[aria-label="分块下移"]').click()`)
  await wait(`document.querySelector('textarea[aria-label="分块原文"]')?.value==='Heading'&&document.body.textContent.includes('第 2 块')`)
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='确认此页分块并写入待译段落').click()`)
  await wait(`document.body.textContent.includes('此页已写入')`)
  assert.deepEqual(db.prepare('SELECT en_text,zh_text,status FROM paragraph WHERE page_idx=1 ORDER BY sort_order').all(),[{en_text:'2.36 kW',zh_text:'',status:'todo'},{en_text:'Heading',zh_text:'',status:'todo'}])
  assert.deepEqual(db.prepare('SELECT * FROM paragraph WHERE id=11').get(),original)
  const stable=db.prepare('SELECT * FROM paragraph ORDER BY id').all()
  await evaluate(`document.querySelector('button[aria-expanded="false"]').click()`)
  await evaluate(`document.querySelector('input[type="checkbox"]').click()`)
  await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='先试 2 页'&&!b.disabled)`)
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='先试 2 页').click()`)
  await wait(`document.body.textContent.includes('本批识别结束')&&document.body.textContent.includes('本结果仅供对照')`)
  assert.equal(requests,3)
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='确认此页分块并写入待译段落').disabled`),true)
  assert.deepEqual(db.prepare('SELECT * FROM paragraph ORDER BY id').all(),stable)
  window.setContentSize(600,900);await new Promise(resolve=>setTimeout(resolve,100))
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true)
  fs.writeFileSync('/tmp/traloom-vision-page-mobile.png',(await window.webContents.capturePage()).toPNG())
  cancel=true
  const token=await evaluate(`window.api.approveVisionPages(${JSON.stringify(file)},2,[0])`)
  assert.equal(token,null);assert.equal(requests,3);cancel=false;truncate=true
  const failure=await evaluate(`(async()=>{const t=await window.api.approveVisionPages(${JSON.stringify(file)},2,[0]);return window.api.runVisionPage(t,0,${JSON.stringify(lastImage)})})()`)
  assert.equal(failure.status,'failed');assert.match(failure.error,/截断/);assert.deepEqual(db.prepare('SELECT * FROM paragraph ORDER BY id').all(),stable)
  const preserved=db.prepare("SELECT value FROM project_meta WHERE key='recognition_paused'").get();assert.equal(preserved.value,'1')
  assert.ok(confirmations.some(c=>c.detail.includes('完整图像')&&c.detail.includes('测试功能')))
  console.log('Whole-page desktop: actual PDF rendering, image upload to local fake server, consent cancellation, editable reading order, explicit adoption, protected-page preview, truncation rejection, mobile overflow and untouched translations passed.')
  window.destroy();server.close();app.quit()
}).catch(error=>{console.error(error);server.close();app.exit(1)})
app.on('will-quit',()=>{
  database.closeDatabase();fs.rmSync(bundle,{force:true});fs.rmSync(html,{force:true});fs.rmSync(temporary,{recursive:true,force:true})
})
