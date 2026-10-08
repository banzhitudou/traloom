/**
 * API Key 加解密。
 * 用 Electron safeStorage（基于系统钥匙串/DPAPI），Key 永不明文落盘。
 * 来源：《技术方案文档》第 6.3 节。
 */
import { safeStorage } from 'electron'

/** 加密明文 API Key，返回可存库的 Buffer */
export function encryptApiKey(plain: string): Buffer {
  if (!plain) return Buffer.alloc(0)
  if (secureStorageAvailable()) {
    return safeStorage.encryptString(plain)
  }
  throw new Error('系统安全密钥存储不可用，不能保存 API Key。请启用系统钥匙串后重试。')
}

/** 解密 API Key */
export function decryptApiKey(enc: Buffer): string {
  if (!enc || enc.length === 0) return ''
  try {
    if (secureStorageAvailable()) {
      return safeStorage.decryptString(enc)
    }
    throw new Error('安全存储不可用。')
  } catch {
    throw new Error('无法解密 API Key；请检查系统钥匙串或重新填写密钥。工程可能来自其他电脑或旧版不安全存储。')
  }
}

function secureStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
    && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
}
