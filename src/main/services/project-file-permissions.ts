import { dialog } from 'electron'
import { lstatSync, realpathSync } from 'fs'
import { extname } from 'path'
import { resolveProjectPath } from './project-paths'

const approved = new Set<string>()
export async function authorizeProjectFile(projectPath: string, storedPath: string, extension: '.pdf' | '.md'): Promise<string> {
  const file = resolveProjectPath(projectPath, storedPath)
  if (extname(file).toLowerCase() !== extension || !lstatSync(file).isFile()) throw new Error('工程引用了无效的外部文件。请重新关联原书 PDF。')
  const resolved = realpathSync(file)
  const key = projectPath + '\n' + resolved
  if (!approved.has(key)) {
    const answer = await dialog.showMessageBox({ type: 'warning', title: '授权外部工程资源',
      message: '此旧工程引用了工程文件之外的资源。是否允许读取？', detail: resolved,
      buttons: ['取消', '允许读取'], defaultId: 0, cancelId: 0, noLink: true })
    if (answer.response !== 1) throw new Error('未授权外部资源。可重新关联原书 PDF，将其收入工程。')
    approved.add(key)
  }
  return resolved
}
