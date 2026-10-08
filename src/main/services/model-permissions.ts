import { app, dialog } from 'electron'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { validateModelUrl } from './security-validation'

const pending = new Map<string, Promise<void>>()
export async function authorizeModelEndpoint(projectPath: string, baseUrl: string): Promise<void> {
  const url = validateModelUrl(baseUrl)
  const key = createHash('sha256').update(projectPath + '\n' + url.href).digest('hex')
  const file = join(app.getPath('userData'), 'model-endpoint-permissions.json')
  const read = (): string[] => {
    try { const value = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(value) ? value.filter(x => typeof x === 'string') : [] } catch { return [] }
  }
  if (read().includes(key)) return
  if (!pending.has(key)) pending.set(key, (async () => {
    const answer = await dialog.showMessageBox({ type: 'warning', title: '授权模型服务',
      message: '是否允许此工程向以下模型服务发送文本与 API Key？',
      detail: `${url.href}\n\n${url.protocol === 'http:' ? '此局域网/本机地址使用明文 HTTP。\n' : ''}仅授权你信任的服务。工程文件内的配置不会自动获得授权。`,
      buttons: ['取消', '允许此服务'], defaultId: 0, cancelId: 0, noLink: true })
    if (answer.response !== 1) throw new Error('未授权模型服务，请核对地址后重试。')
    writeFileSync(file + '.tmp', JSON.stringify([...new Set([...read(), key])]), { mode: 0o600 })
    renameSync(file + '.tmp', file)
  })().finally(() => pending.delete(key)))
  await pending.get(key)
}
