const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
require('tsx/cjs')
const { app, BrowserWindow } = require('electron')
const { ipcMain, trustRenderer } = require('../src/main/ipc/secure-ipc.ts')
const { registerOcrResources } = require('../src/main/ocr-resources.ts')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'traloom-desktop-security-'))
const bundle = path.resolve('out/renderer/ocr-security-check.mjs')
require('esbuild').buildSync({ entryPoints: ['tests/browser-ocr.runtime.ts'], bundle: true, platform: 'browser', format: 'esm', outfile: bundle })
app.setPath('userData', root)
app.setAppPath(path.resolve('.'))
const timeout = setTimeout(() => { fs.rmSync(bundle, { force: true }); console.error('Desktop security test timed out'); app.exit(1) }, 60000)
app.whenReady().then(async () => {
  registerOcrResources()
  ipcMain.handle('project:listRecent', () => [])
  ipcMain.handle('project:restoreLast', () => ({ ok: true, restored: false }))
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.resolve('out/preload/index.js') } })
  const file = path.resolve('out/renderer/index.html')
  trustRenderer(window.webContents, pathToFileURL(file).href)
  await window.loadFile(file)
  const result = await window.webContents.executeJavaScript(`(async () => {
    const api = window.api;
    const recent = await api.listRecentProjects();
    const asset = await fetch('workbench-ocr://local/lang/eng.traineddata.gz');
    return { api: !!api, recent, node: typeof require, asset: asset.status, root: document.getElementById('root').innerHTML.length, wasm: WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0])) };
  })()`)
  assert.equal(result.api, true)
  assert.deepEqual(result.recent, [])
  assert.equal(result.node, 'undefined')
  assert.equal(result.asset, 200)
  assert.ok(result.root > 0)
  assert.equal(result.wasm, true)
  const fixture = 'data:image/png;base64,' + fs.readFileSync('tests/fixtures/ocr-garden.png').toString('base64')
  const recognized = await window.webContents.executeJavaScript(`import(${JSON.stringify(pathToFileURL(bundle).href)}).then(module => module.recognizeFixture(${JSON.stringify(fixture)}))`)
  assert.match(recognized, /A small garden/i)
  console.log('Actual offline OCR recognition passed under renderer CSP:', recognized.trim())
  const content = '0 0 1 rg 10 10 30 30 re f\nBT /F1 16 Tf 10 60 Td (A small garden.) Tj ET'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  const assets = path.resolve('out/renderer/assets')
  const pdfWorker = pathToFileURL(path.join(assets, fs.readdirSync(assets).find(name => name.startsWith('pdf.worker.')))).href
  const rendered = await window.webContents.executeJavaScript(`import(${JSON.stringify(pathToFileURL(bundle).href)}).then(module => module.renderPdfFixture(${JSON.stringify(Array.from(Buffer.from(pdf)))}, ${JSON.stringify(pdfWorker)}))`)
  assert.match(rendered.text, /A small garden/)
  assert.ok(rendered.blue > 500)
  console.log('Actual PDF worker, text extraction and nonblank canvas passed:', rendered)
  console.log('Sandboxed renderer, preload IPC, CSP OCR resource and interface mount passed.', result)
  window.destroy()
}).then(() => { clearTimeout(timeout); fs.rmSync(bundle, { force: true }); fs.rmSync(root, { recursive: true, force: true }); app.exit(0) }).catch(error => { console.error(error); clearTimeout(timeout); fs.rmSync(bundle, { force: true }); app.exit(1) })
