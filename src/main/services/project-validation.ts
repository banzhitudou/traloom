import Database from 'better-sqlite3'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'fs'
import { extname } from 'path'

export function validateProjectHeader(filePath: unknown): asserts filePath is string {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0') || extname(filePath).toLowerCase() !== '.twproj') throw new Error('请选择有效的 .twproj 翻译工程。')
  if (!lstatSync(filePath).isFile()) throw new Error('工程必须是常规文件，不能是目录或符号链接。')
  const fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    const header = Buffer.alloc(16)
    if (!stat.isFile() || readSync(fd, header, 0, 16, 0) !== 16 || !header.equals(Buffer.from('SQLite format 3\0'))) throw new Error('不是有效的翻译工程数据库；文件不会被修改。')
  } finally { closeSync(fd) }
}

export function validateExistingProject(filePath: unknown): asserts filePath is string {
  validateProjectHeader(filePath)
  const check = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    const meta = check.pragma('table_info(project_meta)') as { name: string }[]
    const paragraphs = check.pragma('table_info(paragraph)') as { name: string }[]
    if (!['key', 'value'].every(name => meta.some(c => c.name === name))
      || !['id', 'en_text', 'zh_text', 'status', 'page_idx'].every(name => paragraphs.some(c => c.name === name))) throw new Error('此 SQLite 文件不是 Traloom 翻译工程。')
  } finally { check.close() }
}
