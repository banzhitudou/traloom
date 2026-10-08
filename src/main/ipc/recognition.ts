import { ipcMain } from 'electron'
import { getCurrentDbPath, getDb } from '../db'
import { dirname, join } from 'path'
import { mkdirSync, writeFileSync, renameSync } from 'fs'
import type { RecognizedBlock } from '../../shared/ipc-api'
import { commitRecognizedPage } from '../services/pdf-recognition'
import { storeResource } from '../services/project-resources'

function checkProject(path: string): void {
  if (path !== getCurrentDbPath()) throw new Error('工程已切换，已停止识别。')
  const enabled = getDb().prepare("SELECT value FROM project_meta WHERE key='recognition_enabled'").get() as { value: string } | undefined
  if (enabled?.value !== '1') throw new Error('此工程未启用自动识别。')
}

function updateRecognitionFiles(): void {
  const db = getDb()
  const pages = db.prepare('SELECT page_idx,method,blocks_json FROM recognized_page ORDER BY page_idx').all() as { page_idx: number; method: string; blocks_json: string }[]
  const recognized = pages.map(p => ({ page: p.page_idx + 1, method: p.method, blocks: JSON.parse(p.blocks_json) as RecognizedBlock[] }))
  const markdown = recognized.map(p => `# PDF ${p.page}\n\n${p.blocks.map(b => b.text).join('\n\n')}`).join('\n\n')
  const root = join(dirname(getCurrentDbPath()!), 'files', 'recognition')
  const embeddedOnly = (db.prepare("SELECT value FROM project_meta WHERE key='resource_storage'").get() as { value: string } | undefined)?.value === 'embedded'
  if (!embeddedOnly) mkdirSync(root, { recursive: true })
  for (const [name, content] of [['original.json', JSON.stringify(recognized, null, 2)], ['original.md', markdown]]) {
    storeResource(db, 'files/recognition/' + name, Buffer.from(content))
    if (!embeddedOnly) {
      const file = join(root, name)
      writeFileSync(file + '.tmp', content)
      renameSync(file + '.tmp', file)
    }
  }
  db.prepare("INSERT INTO project_document(path,title,kind,content) VALUES('files/recognition/original.md','识别原文','recognized_markdown',?) ON CONFLICT(path) DO UPDATE SET content=excluded.content,updated_at=datetime('now')").run(markdown)
}

export function registerRecognitionHandlers(): void {
  ipcMain.handle('project:recognitionState', () => {
    const db = getDb()
    const meta = Object.fromEntries((db.prepare("SELECT key,value FROM project_meta WHERE key LIKE 'recognition_%'").all() as { key: string; value: string }[]).map(r => [r.key, r.value]))
    return { projectPath: getCurrentDbPath()!, enabled: meta.recognition_enabled === '1', total: Number(meta.recognition_total || 0), completed: (db.prepare('SELECT page_idx FROM recognized_page ORDER BY page_idx').all() as { page_idx: number }[]).map(p => p.page_idx) }
  })
  ipcMain.handle('project:recognitionInit', (_e, path: string, total: number) => {
    checkProject(path)
    if (!Number.isInteger(total) || total < 1 || total > 20000) throw new Error('无效的 PDF 页数。')
    const save = getDb().prepare('INSERT INTO project_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    save.run('recognition_total', String(total))
    save.run('json_path', 'files/recognition/original.json')
    save.run('primary_markdown_path', 'files/recognition/original.md')
    updateRecognitionFiles()
  })
  ipcMain.handle('project:recognitionPage', (_e, path: string, pageIdx: number, blocks: RecognizedBlock[], method: string) => {
    checkProject(path)
    commitRecognizedPage(getDb(), pageIdx, blocks, method)
    updateRecognitionFiles()
  })
}
