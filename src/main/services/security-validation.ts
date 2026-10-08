import type { LlmConfig } from '../../shared/types'

export function positiveId(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('无效的记录编号。')
}

export function validateModelUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Base URL 格式无效。')
  const url = new URL(value.trim().replace(/#$/, ''))
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 仅支持不含登录信息或查询参数的 HTTP/HTTPS 地址。')
  const host = url.hostname.toLowerCase()
  if (host.startsWith('169.254.') || /^\[fe[89ab]/.test(host) || host.startsWith('[::ffff:') || host === '[::]' || host === '0.0.0.0') throw new Error('不允许使用链路本地或未指定的服务地址。')
  const local = host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host)
    || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  if (url.protocol === 'http:' && !local) throw new Error('远程模型服务必须使用 HTTPS；HTTP 仅用于本机或局域网模型。')
  return url
}

export function sameModelEndpoint(a: Pick<LlmConfig, 'baseUrl' | 'protocol'>, b: Pick<LlmConfig, 'baseUrl' | 'protocol'>): boolean {
  return a.protocol === b.protocol && validateModelUrl(a.baseUrl).href.replace(/\/$/, '') === validateModelUrl(b.baseUrl).href.replace(/\/$/, '')
}

export function validateModelConfig(input: unknown): asserts input is LlmConfig & { apiKey?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的模型配置。')
  const c = input as Record<string, unknown>
  if (c.id !== undefined) positiveId(c.id)
  for (const key of ['name', 'model']) if (typeof c[key] !== 'string' || !c[key].trim() || c[key].length > 500) throw new Error('模型名称与配置名不能为空或过长。')
  if (!['openai_chat', 'openai_responses', 'anthropic'].includes(String(c.protocol))) throw new Error('无效的模型协议。')
  validateModelUrl(c.baseUrl)
  if (c.apiKey !== undefined && (typeof c.apiKey !== 'string' || c.apiKey.length > 8192 || /[\r\n]/.test(c.apiKey))) throw new Error('无效的 API Key。')
  if (typeof c.systemPrompt !== 'string' || c.systemPrompt.length > 100000) throw new Error('无效的模型提示词。')
  if (typeof c.isDefault !== 'boolean' || typeof c.temperature !== 'number' || !Number.isFinite(c.temperature) || c.temperature < 0 || c.temperature > 2
    || !Number.isSafeInteger(c.maxTokens) || Number(c.maxTokens) < 1 || Number(c.maxTokens) > 1000000) throw new Error('无效的模型参数。')
}

export function validateParagraphStatus(value: unknown): void {
  if (typeof value !== 'string' || !['todo', 'doing', 'done', 'review'].includes(value)) throw new Error('无效的翻译段状态。')
}

export function isSafeExternalUrl(value: string): boolean {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}
