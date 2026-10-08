import { describe, expect, it } from 'vitest'
import { validateModelUrl, sameModelEndpoint, validateModelConfig, positiveId, validateParagraphStatus, isSafeExternalUrl } from '../src/main/services/security-validation'

describe('security input boundaries', () => {
  it.each(['file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com', 'http://example.com', 'http://169.254.169.254', 'https://[fe80::1]', 'https://example.com?key=x'])('rejects unsafe model URL %s', url => {
    expect(() => validateModelUrl(url)).toThrow()
  })
  it.each(['https://api.example.com/v1', 'http://localhost:11434', 'http://192.168.1.2:8080', 'http://[::1]:8080'])('keeps supported model URL %s', url => {
    expect(validateModelUrl(url).href).toBeTruthy()
  })
  it('does not reuse keys across endpoints or protocols', () => {
    const a = { baseUrl: 'https://api.example.com/v1', protocol: 'openai_chat' as const }
    expect(sameModelEndpoint(a, { ...a, baseUrl: a.baseUrl + '/' })).toBe(true)
    expect(sameModelEndpoint(a, { ...a, baseUrl: 'https://evil.example/v1' })).toBe(false)
    expect(sameModelEndpoint(a, { ...a, protocol: 'anthropic' })).toBe(false)
  })
  it('rejects malformed config and database values', () => {
    expect(() => validateModelConfig(null)).toThrow()
    for (const id of [0, -1, 1.2, '1', NaN]) expect(() => positiveId(id)).toThrow()
    expect(() => validateParagraphStatus('invalid')).toThrow()
    expect(() => validateParagraphStatus('review')).not.toThrow()
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
  })
})
