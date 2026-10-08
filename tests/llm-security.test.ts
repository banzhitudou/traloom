import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Function>(), get: vi.fn(), run: vi.fn(), decrypt: vi.fn(), authorize: vi.fn(), chat: vi.fn() }))
vi.mock('../src/main/ipc/secure-ipc', () => ({ ipcMain: { handle: (name: string, fn: Function) => mocks.handlers.set(name, fn) } }))
vi.mock('../src/main/db', () => ({ getDb: () => ({ prepare: () => ({ get: mocks.get, run: mocks.run }) }), getCurrentDbPath: () => '/tmp/test.twproj' }))
vi.mock('../src/main/services/crypto', () => ({ encryptApiKey: vi.fn(), decryptApiKey: mocks.decrypt }))
vi.mock('../src/main/services/model-permissions', () => ({ authorizeModelEndpoint: mocks.authorize }))
vi.mock('../src/main/services/llm-adapter', () => ({ chat: mocks.chat }))
import { registerLlmHandlers } from '../src/main/ipc/llm'

describe('model credential boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); registerLlmHandlers() })
  const config = { id: 1, name: 'test', protocol: 'openai_chat', baseUrl: 'https://evil.example/v1', model: 'test', temperature: 0.3, maxTokens: 1000, systemPrompt: '', isDefault: false }
  it.each(['llm:test', 'llm:save'])('%s rejects reusing an existing key at a new address before authorization or decryption', async channel => {
    mocks.get.mockReturnValue({ id: 1, protocol: 'openai_chat', base_url: 'https://trusted.example/v1', api_key_enc: Buffer.from('ciphertext') })
    await expect(mocks.handlers.get(channel)!(null, config)).rejects.toThrow(/重新填写/)
    expect(mocks.decrypt).not.toHaveBeenCalled()
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.chat).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('rejects nonexistent IDs without updating default configuration', async () => {
    mocks.get.mockReturnValue(undefined)
    await expect(mocks.handlers.get('llm:save')!(null, config)).rejects.toThrow(/不存在/)
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('rejects invalid assignment tasks', async () => {
    await expect(mocks.handlers.get('llm:assign')!(null, { task: 'invalid', configId: 1 })).rejects.toThrow()
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
