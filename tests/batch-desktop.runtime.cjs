const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
require('tsx/cjs')
const { app, BrowserWindow } = require('electron')
const Database = require('better-sqlite3')
const { ipcMain, trustRenderer } = require('../src/main/ipc/secure-ipc.ts')
const service = require('../src/main/services/batch-processing.ts')
const { initializeRevisionHistory, recordGeneration, finishGeneration } = require('../src/main/services/revision-history.ts')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'traloom-batch-ui-'))
const directory = path.resolve('out/renderer')
const bundle = path.join(directory, 'batch-check.mjs')
const html = path.join(directory, 'batch-check.html')
const buildReady = require('esbuild').build({ entryPoints: ['tests/browser-batch.runtime.tsx'], bundle: true, platform: 'browser', format: 'esm', outfile: bundle, jsx: 'automatic', plugins: [{name:'worker-url',setup(build) {
  build.onResolve({filter:/pdf\.worker.*\?url$/},args => ({path:args.path,namespace:'worker-url'}))
  build.onLoad({filter:/.*/,namespace:'worker-url'},() => ({contents:`export default ${JSON.stringify(pathToFileURL(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')).href)}`,loader:'js'}))
}}], alias: { '@renderer': path.resolve('src/renderer/src'), '@shared': path.resolve('src/shared') } })
const css = fs.readdirSync(path.join(directory, 'assets')).find(name => name.endsWith('.css'))
fs.writeFileSync(html, `<html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./assets/${css}"></head><body><div id="root"></div><script type="module" src="./batch-check.mjs"></script></body></html>`)
app.setPath('userData', temporary)
app.setName('Traloom batch test')
const db = new Database(':memory:')
db.exec(fs.readFileSync('src/main/db/schema.sql', 'utf8'))
db.pragma('recursive_triggers = ON')
db.exec(`INSERT INTO paragraph(id,page_idx,type,en_text,zh_text,status,sort_order) VALUES
  (1,0,'paragraph','A garden grows.\nFlowers bloom.','','todo',1),
  (2,0,'paragraph','Existing\ntranslation','已有人工译文','done',2),
  (3,0,'title','A title','','todo',3),
  (4,1,'paragraph','Rice is food.\nMaize is food.','','todo',4),
  (5,1,'paragraph','Another\nparagraph','','todo',5),
  (6,1,'paragraph','Needs review','存疑稿','review',6),
  (7,1,'paragraph','Pending','待审稿','doing',7)`)
initializeRevisionHistory(db)
app.whenReady().then(async () => {
  await buildReady
  const verifyMissingModel = process.argv.includes('--verify-missing-model')
  const verifyCompleted = process.argv.includes('--verify-completed')
  let completedId = ''
  if (verifyCompleted) {
    const job = service.createBatchJob(db, { task: 'clean' }, [])
    await service.runBatch(db, job.id, job.items.length, true, async (_job, item) => ({ text: item.source.replace(/\n/g, ' ') }), () => true)
    completedId = job.id
  }
  let createdJobs = 0, startedJobs = 0
  ipcMain.handle('llm:status', () => verifyMissingModel ? { state: 'unconfigured' } : { state: 'online', model: '本地测试模型（无费用）' })
  ipcMain.handle('batch:settings', () => '')
  ipcMain.handle('ai:referenceSettings', () => ({ count: 1, profiles: [{ name: '默认', instructions: '' }] }))
  ipcMain.handle('batch:saveSettings', () => {})
  ipcMain.handle('batch:plan', (_event, scope) => service.planBatch(db, scope))
  ipcMain.handle('batch:list', () => service.listBatchJobs(db))
  ipcMain.handle('batch:get', (_event, id) => service.getBatchJob(db, id))
  ipcMain.handle('batch:create', (_event, scope, ids) => { createdJobs++; return service.createBatchJob(db, scope, ids) })
  ipcMain.handle('batch:decide', (_event, id, ids, adopt) => service.decideBatch(db, id, ids, adopt))
  ipcMain.handle('batch:control', (_event, id, action) => service.controlBatch(db, id, action))
  ipcMain.handle('batch:start', (_event, id, limit, automatic) => {
    startedJobs++
    service.validateBatchStart(db, id, limit, automatic)
    void service.runBatch(db, id, limit, automatic, async (job, item) => {
      const text = job.task === 'clean' ? item.source.replace(/\n/g, ' ') : '这是本地测试生成的中文初稿。'
      const request = recordGeneration(db, { paragraphId: item.id, task: 'batch_test', input: item.source, model: { model: 'local fake' } })
      return { text, generationId: finishGeneration(db, request, { text }) }
    }, () => true).catch(console.error)
    return service.getBatchJob(db, id)
  })
  const window = new BrowserWindow({ show: !verifyMissingModel && !verifyCompleted, width: 1200, height: 850, title: 'Traloom batch test', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.resolve('out/preload/index.js') } })
  trustRenderer(window.webContents, pathToFileURL(html).href)
  await window.loadFile(html)
  if (verifyCompleted) {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const wait = async predicate => { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)) } throw new Error('Completed job UI timed out') }
      await wait(() => [...document.querySelectorAll('option')].some(option => option.value === ${JSON.stringify(completedId)}))
      const option = [...document.querySelectorAll('option')].find(option => option.value === ${JSON.stringify(completedId)})
      const historyLabel = option.textContent.includes('已完成')
      const select = option.parentElement; select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }))
      await wait(() => document.body.textContent.includes('本次任务已完成'))
      const buttons = [...document.querySelectorAll('button')]
      const next = buttons.find(button => button.textContent === '新建批量任务')
      const snapshot = { historyLabel, completed: true, primary: next.className.includes('bg-blue-600'), invalidActions: buttons.some(button => /剩余 0|再试 0|取消任务|采用全部试处理结果|准备重试/.test(button.textContent)), resultsVisible: document.body.textContent.includes('A garden grows. Flowers bloom.'), tabsEnabled: buttons.filter(button => ['整理原文断行', '生成译文初稿'].includes(button.textContent)).every(button => !button.disabled) }
      next.click()
      await wait(() => [...document.querySelectorAll('input')].some(input => input.getAttribute('aria-label') === '试处理数量'))
      return { ...snapshot, newTaskReady: !document.body.textContent.includes('本次任务已完成') }
    })()`)
    assert.deepEqual(result, { historyLabel: true, completed: true, primary: true, invalidActions: false, resultsVisible: true, tabsEnabled: true, newTaskReady: true })
    assert.equal(createdJobs, 0); assert.equal(startedJobs, 0)
    console.log('Completed job UI: clear completion, primary new task, visible results, enabled task tabs and no invalid actions.')
    window.destroy(); app.quit(); return
  }
  if (verifyMissingModel) {
    const result = await window.webContents.executeJavaScript(`(async () => {
      let confirms = 0; window.confirm = () => { confirms++; return true }
      for (let attempt = 0; attempt < 100; attempt++) {
        const settings = [...document.querySelectorAll('button')].find(button => button.textContent.includes('去配置模型'))
        if (settings && !settings.disabled) {
          const runs = [...document.querySelectorAll('button')].filter(button => button.textContent.includes('先试') || button.textContent.includes('处理范围内全部'))
          const disabled = runs.length === 2 && runs.every(button => button.disabled)
          runs.forEach(button => button.click())
          settings.click()
          return { disabled, confirms, navigated: document.getElementById('root').textContent === '模型配置已打开' }
        }
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      throw new Error('Model configuration guidance not rendered')
    })()`)
    assert.deepEqual(result, { disabled: true, confirms: 0, navigated: true })
    assert.equal(createdJobs, 0); assert.equal(startedJobs, 0)
    console.log('Missing model: setup navigation visible, requests disabled, no confirmation, no jobs created.')
    window.destroy(); app.quit(); return
  }
  console.log('Batch UI fixture ready. Only an in-memory synthetic project and fake model are used.')
  window.on('closed', () => app.quit())
}).catch(error => { console.error(error); app.exit(1) })
app.on('will-quit', () => {
  db.close()
  fs.rmSync(bundle, { force: true }); fs.rmSync(html, { force: true }); fs.rmSync(temporary, { recursive: true, force: true })
})
