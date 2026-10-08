import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { createHash } from 'crypto'
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'fs'
import { copyFile, mkdir, mkdtemp, open, rename, rm, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { configureRevisionFunctions } from './revision-history'
import { projectFileKeys, projectPathKeys, resolveProjectPath, storeProjectPath } from './project-paths'
import { readResource, storeResource } from './project-resources'

function metadata(db: DatabaseType): Record<string, string> {
  return Object.fromEntries((db.prepare('SELECT key,value FROM project_meta').all() as { key: string; value: string }[]).map(row => [row.key, row.value]))
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function validateProjectPdf(file: string): Promise<void> {
  const handle = await open(file, 'r')
  try {
    const bytes = Buffer.alloc(1024)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (!bytes.subarray(0, bytesRead).includes(Buffer.from('%PDF-'))) throw new Error('所选文件不是可识别的 PDF。')
  } finally { await handle.close() }
}

function openSnapshot(file: string): DatabaseType {
  const db = new Database(file)
  configureRevisionFunctions(db)
  db.pragma('journal_mode = DELETE')
  db.exec('CREATE TABLE IF NOT EXISTS project_resource(path TEXT PRIMARY KEY, content BLOB NOT NULL, sha256 TEXT NOT NULL)')
  return db
}

function savePaths(db: DatabaseType, changes: Record<string, string>): void {
  db.transaction(() => {
    const save = db.prepare('INSERT INTO project_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    for (const [key, value] of Object.entries(changes)) save.run(key, value)
  })()
  if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('工程副本完整性校验失败。')
}

export async function backupProjectDatabase(db: DatabaseType, sourcePath: string, destination: string): Promise<void> {
  if (resolve(sourcePath) === resolve(destination) || (existsSync(destination) && (
    realpathSync(sourcePath) === realpathSync(destination) ||
    (statSync(sourcePath).ino === statSync(destination).ino && statSync(sourcePath).dev === statSync(destination).dev)
  ))) throw new Error('备份不能覆盖当前正在使用的工程。')
  const temporary = await mkdtemp(join(dirname(destination), '.workbench-backup-'))
  const copy = join(temporary, 'project.twproj')
  let snapshot: DatabaseType | undefined
  try {
    await db.backup(copy)
    snapshot = openSnapshot(copy)
    const meta = metadata(snapshot)
    const paths = Object.fromEntries(projectPathKeys.filter(key => key in meta).map(key => [key, readResource(snapshot!, meta[key]) ? meta[key] : resolveProjectPath(sourcePath, meta[key])]))
    savePaths(snapshot, { ...paths, project_path: destination })
    snapshot.close(); snapshot = undefined
    await rename(copy, destination)
  } finally {
    snapshot?.close()
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function createPortableProject(db: DatabaseType, sourcePath: string, parentDirectory: string): Promise<{ path: string; projectPath: string; warnings: string[] }> {
  const temporary = await mkdtemp(join(parentDirectory, '.workbench-portable-'))
  const copy = join(temporary, 'project.twproj')
  let snapshot: DatabaseType | undefined
  try {
    await db.backup(copy)
    snapshot = openSnapshot(copy)
    const meta = metadata(snapshot)
    const pdf = resolveProjectPath(sourcePath, meta.pdf_path ?? '')
    const embeddedPdf = readResource(snapshot, meta.pdf_path ?? '')
    if (!embeddedPdf && (!pdf || !existsSync(pdf))) throw new Error('原书 PDF 缺失，请先重新关联，再创建可搬移副本。')
    if (!embeddedPdf) await validateProjectPdf(pdf)
    const warnings: string[] = []
    const files: { key: string; path: string; sha256: string }[] = []
    const changes: Record<string, string> = { mineru_root_path: '', project_path: 'project.twproj', portable_version: '1' }
    for (const key of projectFileKeys) {
      const stored = meta[key]
      if (!stored) continue
      const original = resolveProjectPath(sourcePath, stored)
      const embedded = readResource(snapshot, stored)
      // Optional import sources are already represented in the database; do not wait for cloud placeholders.
      if (!embedded && key !== 'pdf_path' && (!existsSync(original) || !statSync(original).isFile() || (statSync(original).size > 0 && statSync(original).blocks === 0))) {
        changes[key] = ''
        warnings.push(`未附带可选资料：${basename(stored)}`)
        continue
      }
      const destination = join(temporary, 'files', key, basename(original))
      await mkdir(dirname(destination), { recursive: true })
      if (embedded) await writeFile(destination, embedded)
      else await copyFile(original, destination)
      const sha256 = await hashFile(destination)
      if (!embedded && sha256 !== await hashFile(original)) throw new Error(`复制校验失败：${basename(original)}`)
      changes[key] = storeProjectPath(copy, destination)
      storeResource(snapshot, changes[key], readFileSync(destination))
      files.push({ key, path: changes[key], sha256 })
    }
    const csvCell = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"'
    for (const [table, name, columns] of [['name_dict', 'names.csv', ['en','zh','source']], ['place_dict','places.csv',['en','zh']], ['glossary','terms.csv',['en','zh','category','note']]] as const) {
      const rows = snapshot.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all() as Record<string, string>[]
      if (!rows.length) continue
      const content = Buffer.from(columns.join(',') + '\n' + rows.map(row => columns.map(key => csvCell(row[key])).join(',')).join('\n'))
      const resourcePath = 'files/dictionaries/' + name
      await mkdir(join(temporary, 'files/dictionaries'), { recursive: true })
      await writeFile(join(temporary, resourcePath), content)
      storeResource(snapshot, resourcePath, content)
    }
    const docs = snapshot.prepare('SELECT id,title,content FROM project_document').all() as { id: number; title: string; content: string }[]
    for (const doc of docs) {
      const resourcePath = `files/documents/${doc.id}.md`
      await mkdir(join(temporary, 'files/documents'), { recursive: true })
      await writeFile(join(temporary, resourcePath), doc.content)
      storeResource(snapshot, resourcePath, Buffer.from(doc.content))
    }
    savePaths(snapshot, changes)
    snapshot.close(); snapshot = undefined
    await writeFile(join(temporary, 'manifest.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), project: 'project.twproj', projectSha256: await hashFile(copy), files, warnings }, null, 2))
    await writeFile(join(temporary, '打开工程.txt'), '请在 Traloom 中打开 project.twproj。PDF 和已附带的资源已收入工程内部，单独移动工程文件也可打开。files 子目录是便于查阅的资源副本。\n译文、术语、备注、修订记录及已导入词典保存在工程中。\n此副本包含私人资料和模型配置，请妥善保管。换电脑后可能需要重新填写 API 密钥。\n原始资料包中未被工程引用的图片、历史导出和备份不包含在此工作副本中。\n' + warnings.join('\n'))
    const title = (meta.book_chinese_title || meta.book_title || 'translation').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 64).replace(/[. ]+$/g, '') || 'translation'
    const folder = `${title}-工程副本-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${basename(temporary).slice(-6)}`
    const destination = join(parentDirectory, folder)
    if (existsSync(destination)) throw new Error('目标文件夹已存在，请重新创建。')
    await rename(temporary, destination)
    return { path: destination, projectPath: join(destination, 'project.twproj'), warnings }
  } catch (error) {
    snapshot?.close()
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}
