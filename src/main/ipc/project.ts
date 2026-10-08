/**
 * 项目管理 IPC handlers
 * channel: project:create / project:open / project:meta / project:pickFile
 * create：解析文件、建库、导入段落/术语/大辞典
 */
import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import { basename, dirname, join, relative } from 'path'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { reserveNewProjectFile } from '../services/new-project-file'
import { openDatabase, initSchema, getCurrentDbPath, getDb, closeDatabase } from '../db'
import type { CreateProjectParams } from '../../shared/ipc-api'
import { registerRecognitionHandlers } from './recognition'
import { storeResource, readResource } from '../services/project-resources'
import { scanMineruPackage } from '../services/mineru-package'
import { loadGlossary, reloadGlossaryFromDatabase } from '../services/glossary-service'
import { withRevisionContext } from '../services/revision-history'
import { resolveProjectPath, storeProjectPath } from '../services/project-paths'
import { validateProjectPdf } from '../services/project-transfer'


function importMineruDocuments(
  db: ReturnType<typeof getDb>,
  rootPath: string
): number {
  const preview = scanMineruPackage(rootPath)
  const insertDocument = db.prepare(
    `INSERT OR REPLACE INTO project_document (path, title, kind, content, updated_at)
     VALUES (?, ?, 'mineru_markdown', ?, datetime('now'))`
  )
  const insertDocuments = db.transaction((files: string[]) => {
    for (const filePath of files) {
      const documentPath = relative(rootPath, filePath)
      const title = basename(filePath).replace(/\.md$/i, '')
      insertDocument.run(documentPath, title, readFileSync(filePath, 'utf-8'))
    }
  })
  insertDocuments(preview.markdownFiles)

  const insertMeta = db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)')
  insertMeta.run('mineru_root_path', rootPath)
  if (preview.primaryMarkdownPath) insertMeta.run('primary_markdown_path', preview.primaryMarkdownPath)
  if (preview.modelJsonPath) insertMeta.run('model_json_path', preview.modelJsonPath)
  return preview.markdownFiles.length
}

function backfillMineruDocuments(db: ReturnType<typeof getDb>): void {
  const documentCount = (db.prepare('SELECT COUNT(*) AS n FROM project_document').get() as { n: number }).n
  if (documentCount > 0) return
  const rows = db.prepare(
    "SELECT key, value FROM project_meta WHERE key IN ('mineru_root_path', 'json_path')"
  ).all() as { key: string; value: string }[]
  const meta = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  const projectPath = getCurrentDbPath()!
  const rootPath = meta.mineru_root_path ? resolveProjectPath(projectPath, meta.mineru_root_path) : (meta.json_path ? dirname(resolveProjectPath(projectPath, meta.json_path)) : '')
  if (!rootPath || !existsSync(rootPath)) return

  try {
    importMineruDocuments(db, rootPath)
  } catch (error) {
    console.warn('[project] MinerU Markdown 回填失败:', error)
  }
}


export function registerProjectHandlers(): void {
  registerRecognitionHandlers()
  let transferBusy = false
  let filePickerBusy = false
  const lastProjectPath = join(app.getPath('userData'), 'last-project.txt')
  const recentProjectsPath = join(app.getPath('userData'), 'recent-projects.json')
  interface RecentProjectRecord { path: string; title: string; lastOpenedAt: string }
  const readRecentProjects = (): RecentProjectRecord[] => {
    try {
      return JSON.parse(readFileSync(recentProjectsPath, 'utf-8')) as RecentProjectRecord[]
    } catch {
      return []
    }
  }
  const writeRecentProjects = (projects: RecentProjectRecord[]) => {
    writeFileSync(recentProjectsPath, JSON.stringify(projects.slice(0, 20), null, 2), 'utf-8')
  }
  const rememberProject = (filePath: string, title = '') => {
    writeFileSync(lastProjectPath, filePath, 'utf-8')
    const previous = readRecentProjects().filter((project) => project.path !== filePath)
    writeRecentProjects([{ path: filePath, title: title || basename(filePath, '.twproj'), lastOpenedAt: new Date().toISOString() }, ...previous])
  }

  ipcMain.handle('project:listRecent', async () => readRecentProjects().map((project) => ({
    ...project,
    exists: existsSync(project.path)
  })))

  ipcMain.handle('project:forgetRecent', async (_event, filePath: string) => {
    writeRecentProjects(readRecentProjects().filter((project) => project.path !== filePath))
  })

  ipcMain.handle('project:removeCurrent', () => {
    if (transferBusy) return { ok: false, error: '请等待工程文件任务完成后再移除。' }
    const currentPath = getCurrentDbPath()
    if (!currentPath) return { ok: true }
    try {
      writeRecentProjects(readRecentProjects().filter(project => project.path !== currentPath))
      if (existsSync(lastProjectPath) && readFileSync(lastProjectPath, 'utf8').trim() === currentPath) {
        rmSync(lastProjectPath, { force: true })
      }
      closeDatabase()
      loadGlossary([])
      return { ok: true }
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })

  // 文件选择对话框（向导页调用）
  ipcMain.handle('project:pickFile', async (event, opts: { filters?: { name: string; extensions: string[] }[]; title?: string; defaultPath?: string } = {}) => {
    if (filePickerBusy) return null
    filePickerBusy = true
    try {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const pdfOnly = opts.filters?.length === 1 && opts.filters[0].extensions.length === 1 && opts.filters[0].extensions[0] === 'pdf'
      const options: Electron.OpenDialogOptions = {
        title: opts.title ?? '选择文件',
        defaultPath: opts.defaultPath || (pdfOnly ? app.getPath('downloads') : undefined),
        properties: ['openFile'],
        filters: opts.filters
      }
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    } finally { filePickerBusy = false }
  })

  ipcMain.handle('project:pickDirectory', async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title ?? '选择文件夹',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('project:files', () => {
    const projectPath = getCurrentDbPath()!
    const rows = getDb().prepare("SELECT key,value FROM project_meta WHERE key IN ('pdf_path','portable_version')").all() as { key: string; value: string }[]
    const meta = Object.fromEntries(rows.map(row => [row.key, row.value]))
    const pdfPath = resolveProjectPath(projectPath, meta.pdf_path ?? '')
    const embedded = getDb().prepare('SELECT 1 FROM project_resource WHERE path=?').get(meta.pdf_path ?? '')
    return { projectPath, pdfPath, pdfExists: !!embedded || !!pdfPath && existsSync(pdfPath), portable: meta.portable_version === '1' }
  })

  ipcMain.handle('project:relinkPdf', async () => {
    if (transferBusy) return { ok: false, error: '请等待工程备份任务完成。' }
    try {
      const currentPath = getCurrentDbPath()!
      const result = await dialog.showOpenDialog({ title: '重新关联同一版本的原书 PDF', properties: ['openFile'], filters: [{ name: '原书 PDF', extensions: ['pdf'] }] })
      if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true }
      const file = result.filePaths[0]
      await validateProjectPdf(file)
      if (getCurrentDbPath() !== currentPath) throw new Error('当前工程已切换，请重新选择原书。')
      const stored = storeProjectPath(currentPath, file)
      getDb().transaction(() => {
        storeResource(getDb(), stored, readFileSync(file))
        getDb().prepare("INSERT INTO project_meta(key,value) VALUES('pdf_path',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(stored)
      })()
      return { ok: true }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  })

  // 新建项目：建库 + 导入全部数据
  ipcMain.handle('project:create', async (_event, params: CreateProjectParams) => {
    if (transferBusy) return { ok: false, error: '请等待工程备份任务完成后再切换工程。' }
    transferBusy = true
    const previous = getCurrentDbPath()
    let dbPath = ''
    try {
      await validateProjectPdf(params.pdfPath)
      dbPath = reserveNewProjectFile(params.pdfPath)
      openDatabase(dbPath)
      initSchema()
      const db = getDb()
      storeResource(db, 'files/original.pdf', readFileSync(params.pdfPath))
      withRevisionContext(db, '建立 PDF 工程', 'import', {}, () => {
      const insertMeta = db.prepare('INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)')
      insertMeta.run('book_title', params.bookTitle ?? '')
      insertMeta.run('pdf_path', 'files/original.pdf')
      insertMeta.run('project_path', basename(dbPath))
      insertMeta.run('resource_storage', 'embedded')
      insertMeta.run('portable_version', '1')
      insertMeta.run('recognition_enabled', '1')
      insertMeta.run('created_at', new Date().toISOString())
      insertMeta.run('schema_version', '3')
      })
      reloadGlossaryFromDatabase(db)
      rememberProject(dbPath, params.bookTitle)
      return { ok: true, projectPath: dbPath }
    } catch (e) {
      if (dbPath) {
        if (getCurrentDbPath() === dbPath) closeDatabase()
        for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
        if (previous) { openDatabase(previous); reloadGlossaryFromDatabase(getDb()) }
      }
      return { ok: false, error: String(e) }
    } finally { transferBusy = false }
  })

  // 打开已有项目
  ipcMain.handle('project:open', async (_event, filePath: string) => {
    if (transferBusy) return { ok: false, error: '请等待工程备份任务完成后再切换工程。' }
    try {
      openDatabase(filePath)
      initSchema()
      backfillMineruDocuments(getDb())
      reloadGlossaryFromDatabase(getDb())
      const title = (getDb().prepare("SELECT value FROM project_meta WHERE key = 'book_title'").get() as { value: string } | undefined)?.value
      rememberProject(filePath, title)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // 启动时自动恢复上一次使用的项目，避免重启后回到新建向导。
  ipcMain.handle('project:restoreLast', async () => {
    if (transferBusy) return { ok: false, restored: false, error: '请等待工程备份任务完成。' }
    try {
      if (!existsSync(lastProjectPath)) return { ok: true, restored: false }
      const filePath = readFileSync(lastProjectPath, 'utf-8').trim()
      if (!filePath || !existsSync(filePath)) return { ok: true, restored: false }
      openDatabase(filePath)
      initSchema()
      backfillMineruDocuments(getDb())
      reloadGlossaryFromDatabase(getDb())
      const title = (getDb().prepare("SELECT value FROM project_meta WHERE key = 'book_title'").get() as { value: string } | undefined)?.value
      rememberProject(filePath, title)
      return { ok: true, restored: true }
    } catch (e) {
      return { ok: false, restored: false, error: String(e) }
    }
  })

  ipcMain.handle('project:updateInfo', async (_event, info: Record<string, string>) => {
    const allowed = ['book_original_title', 'book_chinese_title', 'translator_name', 'translation_started_at', 'author_name', 'publisher_name']
    if (!info || typeof info !== 'object' || Object.entries(info).some(([key, value]) => !allowed.includes(key) || typeof value !== 'string' || value.length > 2000)) throw new Error('无效的项目资料。')
    const db = getDb()
    db.transaction(() => {
      const save = db.prepare('INSERT INTO project_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      for (const [key, value] of Object.entries(info)) save.run(key, value.trim())
    })()
  })

  // 读取项目元信息
  ipcMain.handle('project:bookPageMapping', async (_event, offset: number, pagesPerPdf: number, rightFirst: boolean) => {
    if (!Number.isSafeInteger(offset) || ![1, 2].includes(pagesPerPdf) || typeof rightFirst !== 'boolean') throw new Error('无效的书页映射。')
    const db = getDb()
    db.transaction(() => {
      const save = db.prepare('INSERT INTO project_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      save.run('book_page_offset', String(offset))
      save.run('book_pages_per_pdf', String(pagesPerPdf))
      save.run('book_right_first', String(rightFirst))
    })()
  })
  ipcMain.handle('project:bookPageOffset', async (_event, offset: number) => {
    if (!Number.isSafeInteger(offset)) throw new Error('页码偏移必须是整数。')
    getDb().prepare("INSERT INTO project_meta (key, value) VALUES ('book_page_offset', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(offset))
  })

  ipcMain.handle('project:meta', async () => {
    try {
      const db = getDb()
      const rows = db.prepare('SELECT key, value FROM project_meta').all() as { key: string; value: string }[]
      const meta: Record<string, string> = {}
      for (const r of rows) meta[r.key] = r.value
      return meta
    } catch {
      return {}
    }
  })

  // 读取 PDF 文件为 ArrayBuffer（供渲染进程 pdf.js 加载）
  ipcMain.handle('project:readPdf', async () => {
    try {
      const db = getDb()
      const row = db.prepare("SELECT value FROM project_meta WHERE key = 'pdf_path'").get() as
        | { value: string }
        | undefined
      if (!row?.value) return null
      const buf = readResource(db, row.value) ?? readFileSync(resolveProjectPath(getCurrentDbPath()!, row.value))
      // ArrayBuffer 经 IPC 传给渲染进程（Electron 自动处理为 Uint8Array）
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    } catch (e) {
      console.error('[project:readPdf]', e)
      return null
    }
  })

}
