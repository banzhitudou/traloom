import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))
import { assertTrustedSender, trustRenderer } from '../src/main/ipc/secure-ipc'

describe('IPC sender authorization', () => {
  it('only accepts the registered main frame at the expected URL', () => {
    const mainFrame = { url: 'file:///app/index.html' }
    const sender = { mainFrame, once: vi.fn() }
    const event = { sender, senderFrame: mainFrame } as any
    expect(() => assertTrustedSender(event)).toThrow()
    trustRenderer(sender as any, mainFrame.url)
    expect(() => assertTrustedSender(event)).not.toThrow()
    expect(() => assertTrustedSender({ ...event, senderFrame: { ...mainFrame } })).toThrow()
    mainFrame.url = 'https://evil.example/'
    expect(() => assertTrustedSender(event)).toThrow()
  })
})
