import { beforeEach, describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({ isEncryptionAvailable: vi.fn(), encryptString: vi.fn(), decryptString: vi.fn(), getSelectedStorageBackend: vi.fn() }))
vi.mock('electron', () => ({ safeStorage: storage }))
import { encryptApiKey, decryptApiKey } from '../src/main/services/crypto'

describe('API key storage', () => {
  beforeEach(() => vi.resetAllMocks())
  it('never falls back to plaintext when secure storage is unavailable', () => {
    storage.isEncryptionAvailable.mockReturnValue(false)
    expect(() => encryptApiKey('test-secret')).toThrow()
    expect(storage.encryptString).not.toHaveBeenCalled()
  })
  it('reports unreadable old keys instead of silently dropping them', () => {
    storage.isEncryptionAvailable.mockReturnValue(true)
    storage.decryptString.mockImplementation(() => { throw new Error('bad ciphertext') })
    expect(() => decryptApiKey(Buffer.from('old-plaintext'))).toThrow(/重新填写/)
  })
  it('uses operating-system encryption when available', () => {
    storage.isEncryptionAvailable.mockReturnValue(true)
    storage.encryptString.mockReturnValue(Buffer.from('encrypted'))
    expect(encryptApiKey('test-secret').toString()).toBe('encrypted')
    expect(storage.encryptString).toHaveBeenCalledWith('test-secret')
  })
})
