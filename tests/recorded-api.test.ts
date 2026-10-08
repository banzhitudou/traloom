import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('wraps frozen Electron bridge methods without blocking saves or synchronous flushes', async () => {
  const updateTranslation = vi.fn().mockResolvedValue(undefined)
  const flushTranslation = vi.fn().mockReturnValue(true)
  const listParagraphs = vi.fn().mockResolvedValue([])
  const dispatchEvent = vi.fn()
  vi.stubGlobal('window', { api: Object.freeze({ updateTranslation, flushTranslation, listParagraphs }), dispatchEvent })
  const { api, REVISION_CHANGED } = await import('../src/renderer/src/lib/ipc')
  await api.updateTranslation(5, '修订译文')
  expect(updateTranslation).toHaveBeenCalledWith(5, '修订译文')
  expect(dispatchEvent.mock.calls[0][0].type).toBe(REVISION_CHANGED)
  expect(api.flushTranslation(5, '最后输入')).toBe(true)
  expect(dispatchEvent).toHaveBeenCalledTimes(2)
  await api.listParagraphs()
  expect(dispatchEvent).toHaveBeenCalledTimes(2)
})

it('preserves save errors rather than turning failures into successful notifications', async () => {
  const dispatchEvent = vi.fn()
  vi.stubGlobal('window', { api: Object.freeze({ updateTranslation: vi.fn().mockRejectedValue(new Error('保存失败')) }), dispatchEvent })
  const { api } = await import('../src/renderer/src/lib/ipc')
  await expect(api.updateTranslation(5, '稿件')).rejects.toThrow('保存失败')
  expect(dispatchEvent).toHaveBeenCalledTimes(1)
})
