import { app, net, protocol } from 'electron'
import { join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'

protocol.registerSchemesAsPrivileged([{ scheme: 'workbench-ocr', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

export function registerOcrResources(): void {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked/resources/ocr')
    : join(app.getAppPath(), 'resources/ocr')
  protocol.handle('workbench-ocr', request => {
    const url = new URL(request.url)
    const file = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (url.hostname !== 'local' || !file.startsWith(root + sep)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).href)
  })
}
