/**
 * 译稿导出：纯中文/中英对照 × TXT/Markdown。
 */
import { app, dialog, ipcMain } from 'electron'
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getDb, getCurrentDbPath } from '../db'
import { resolveProjectPath } from '../services/project-paths'
import { renderTranslationExport, type ExportParagraph, type TranslationExportOptions } from '../../shared/translation-export'
import { renderDocxExport, renderHtmlExport } from '../services/rich-export'
import { exportFileName, isExportPage, validateExportRange } from '../../shared/translation-export'

export function registerExportHandlers(): void {
  ipcMain.handle('export:run', async (_event, args: TranslationExportOptions) => {
    try {
      const db = getDb()
      if (!['txt', 'md', 'docx', 'html'].includes(args.format)) throw new Error('不支持的导出格式。')
      validateExportRange(args)
      const metaRows = db.prepare(
        'SELECT key, value FROM project_meta'
      ).all() as { key: string; value: string }[]
      const meta = Object.fromEntries(metaRows.map((row) => [row.key, row.value]))
      const rows = db.prepare(
        `SELECT p.id, p.page_idx, p.type, p.en_text, p.zh_text, p.status, p.bbox_json, n.content AS note
         FROM paragraph p LEFT JOIN paragraph_note n ON n.paragraph_id = p.id
         ORDER BY p.page_idx ASC, p.sort_order ASC, p.id ASC`
      ).all() as ExportParagraph[]

      if (!rows.some(row => isExportPage(row.page_idx, args) && (args.scope === 'all' || row.status === 'done'))) return { ok: false, error: '所选页码范围内没有可导出的段落。' }

      const defaultDirectory = meta.pdf_path ? dirname(resolveProjectPath(getCurrentDbPath()!, meta.pdf_path)) : app.getPath('documents')
      const defaultName = exportFileName(meta, args)
      const filterNames = { txt: '纯文本', md: 'Markdown', docx: 'Word 译稿', html: '离线双语网页' }
      const result = await dialog.showSaveDialog({
        title: '导出译稿',
        defaultPath: join(defaultDirectory, defaultName),
        filters: [{ name: filterNames[args.format], extensions: [args.format] }]
      })

      if (result.canceled || !result.filePath) return { ok: false, error: '已取消导出。' }

      if (args.format === 'docx') writeFileSync(result.filePath, await renderDocxExport(rows, args, meta))
      else if (args.format === 'html') writeFileSync(result.filePath, renderHtmlExport(rows, args, meta), 'utf-8')
      else writeFileSync(result.filePath, renderTranslationExport(rows, args), 'utf-8')
      return { ok: true, path: result.filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
