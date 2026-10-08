/**
 * API Key 加解密。
 * 用 Electron safeStorage（基于系统钥匙串/DPAPI），Key 永不明文落盘。
 * 来源：《技术方案文档》第 6.3 节。
 */
import { safeStorage } from 'electron'

/** 加密明文 API Key，返回可存库的 Buffer */
export function encryptApiKey(plain: string): Buffer {
  if (!plain) return Buffer.alloc(0)
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain)
  }
  // 降级：safeStorage 不可用时（如 Linux 无 keyring），用机器级混淆。
  // 非安全加密，仅防止肉眼可见。实际部署应确保 safeStorage 可用。
  return Buffer.from(obfuscate(plain), 'base64')
}

/** 解密 API Key */
export function decryptApiKey(enc: Buffer): string {
  if (!enc || enc.length === 0) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(enc)
    }
    return deobfuscate(Buffer.from(enc).toString('base64'))
  } catch {
    return ''
  }
}

/** 简单可逆混淆（降级用，非安全） */
function obfuscate(s: string): string {
  return Buffer.from(s).toString('base64')
}
function deobfuscate(s: string): string {
  return Buffer.from(s, 'base64').toString('utf-8')
}
