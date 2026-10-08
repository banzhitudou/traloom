import { ipcMain as nativeIpc, type WebContents, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

const trusted = new Map<WebContents, string>()

export function trustRenderer(contents: WebContents, url: string): void {
  trusted.set(contents, url)
  contents.once('destroyed', () => trusted.delete(contents))
}

export function assertTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const expected = trusted.get(event.sender)
  if (!expected || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url.split('#')[0] !== expected.split('#')[0]) {
    throw new Error('拒绝非工作台页面的 IPC 请求。')
  }
}

export const ipcMain = {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
    nativeIpc.handle(channel, (event, ...args) => {
      assertTrustedSender(event)
      return listener(event, ...args)
    })
  },
  on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
    nativeIpc.on(channel, (event, ...args) => {
      try { assertTrustedSender(event) } catch { event.returnValue = { ok: false, error: '不受信任的页面。' }; return }
      listener(event, ...args)
    })
  }
}
