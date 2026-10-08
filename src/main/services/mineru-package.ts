import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, dirname, extname, join, relative } from 'path'
import type { MineruPackagePreview } from '@shared/ipc-api'

const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.cache', 'dist', 'out'])

function walkFiles(rootPath: string, maxDepth = 6): string[] {
  const files: string[] = []
  const visit = (directory: string, depth: number): void => {
    if (depth > maxDepth) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) visit(fullPath, depth + 1)
      else if (entry.isFile()) files.push(fullPath)
    }
  }
  visit(rootPath, 0)
  return files
}

function stemFromContentList(filePath: string): string {
  return basename(filePath)
    .replace(/_content_list_v2\.json$/i, '')
    .replace(/_content_list\.json$/i, '')
}

function findSibling(files: string[], directory: string, fileName: string): string | undefined {
  const exact = join(directory, fileName)
  if (existsSync(exact)) return exact
  return files.find((file) => basename(file).toLowerCase() === fileName.toLowerCase())
}

function countPages(jsonPath: string): number {
  try {
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8')) as unknown
    if (!Array.isArray(data)) return 0
    if (data.length === 0) return 0
    if (Array.isArray(data[0])) return data.length
    return Math.max(...data.map((item) => {
      if (!item || typeof item !== 'object') return 0
      const value = Number((item as Record<string, unknown>).page_idx)
      return Number.isFinite(value) ? value + 1 : 0
    }))
  } catch {
    return 0
  }
}

export function scanMineruPackage(rootPath: string): MineruPackagePreview {
  if (!rootPath || !existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    throw new Error('请选择有效的 MinerU 输出文件夹。')
  }

  const files = walkFiles(rootPath)
  const v2Files = files.filter((file) => /_content_list_v2\.json$/i.test(file))
  const legacyFiles = files.filter((file) => /_content_list\.json$/i.test(file) && !/_content_list_v2\.json$/i.test(file))
  const jsonPath = v2Files[0] ?? legacyFiles[0] ?? ''
  const stem = jsonPath ? stemFromContentList(jsonPath) : ''
  const dataDirectory = jsonPath ? dirname(jsonPath) : rootPath

  const pdfFiles = files.filter((file) => extname(file).toLowerCase() === '.pdf')
  const pdfPath = stem
    ? findSibling(files, dataDirectory, `${stem}.pdf`) ?? pdfFiles.find((file) => !/(?:_layout|_span|layout|span)\.pdf$/i.test(file)) ?? ''
    : pdfFiles.find((file) => !/(?:_layout|_span|layout|span)\.pdf$/i.test(file)) ?? ''
  const markdownFiles = files.filter((file) => extname(file).toLowerCase() === '.md')
  const primaryMarkdownPath = stem
    ? findSibling(files, dataDirectory, `${stem}.md`) ?? markdownFiles[0]
    : markdownFiles[0]
  const modelJsonPath = stem ? findSibling(files, dataDirectory, `${stem}_model.json`) : undefined
  const middleJsonPath = stem ? findSibling(files, dataDirectory, `${stem}_middle.json`) : undefined
  const layoutPdfPath = stem
    ? findSibling(files, dataDirectory, `${stem}_layout.pdf`) ?? pdfFiles.find((file) => /layout\.pdf$/i.test(file))
    : pdfFiles.find((file) => /layout\.pdf$/i.test(file))
  const imageDirectory = files
    .map((file) => dirname(file))
    .find((directory) => basename(directory).toLowerCase() === 'images')

  const warnings: string[] = []
  if (!pdfPath) warnings.push('未找到原始 PDF')
  if (!jsonPath) warnings.push('未找到 content_list_v2.json 或 content_list.json')
  if (!primaryMarkdownPath) warnings.push('未找到主 Markdown')
  if (!modelJsonPath) warnings.push('未找到 model.json，将使用 content_list 坐标')

  return {
    rootPath,
    bookTitle: stem || (pdfPath ? basename(pdfPath, extname(pdfPath)) : basename(rootPath)),
    pdfPath,
    jsonPath,
    modelJsonPath,
    middleJsonPath,
    primaryMarkdownPath,
    layoutPdfPath,
    imageDirectory,
    markdownFiles: markdownFiles.sort((a, b) => relative(rootPath, a).localeCompare(relative(rootPath, b))),
    pageCount: jsonPath ? countPages(jsonPath) : 0,
    warnings
  }
}
