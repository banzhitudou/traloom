/**
 * LLM 适配层。
 * 分别支持 OpenAI Chat Completions、OpenAI Responses 与 Anthropic Messages。
 */
import type { LlmProtocol } from '@shared/types'
import { session } from 'electron'
import { getProviderRequestOptions } from './llm-request-options'
import { recordLlmStatus } from './llm-status'

export interface LlmCallConfig {
  protocol: LlmProtocol
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCallResult {
  ok: boolean
  text?: string
  error?: string
  rawResponse?: unknown
}

export interface PreparedLlmRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

export function extractChatResponseText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const response = data as {
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>
    content?: unknown
    output_text?: unknown
    output?: Array<{ content?: Array<{ text?: unknown }> }>
  }

  const candidates: unknown[] = [
    response.choices?.[0]?.message?.content,
    response.choices?.[0]?.text,
    response.output_text,
    response.content
  ]
  for (const candidate of candidates) {
    const text = extractContentParts(candidate)
    if (text) return text
  }

  return response.output?.flatMap((item) => item.content ?? []).flatMap((part) => (
    typeof part.text === 'string' ? [part.text] : []
  )).join('\n').trim() ?? ''
}

function extractContentParts(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => {
    if (typeof part === 'string') return [part]
    if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
      return [part.text]
    }
    return []
  }).join('\n').trim()
}

function parseBaseUrl(baseUrl: string): { url: string; pathname: string; disableVersion: boolean } {
  let url = baseUrl.trim().replace(/\/+$/, '')
  const disableVersion = url.endsWith('#')
  if (disableVersion) url = url.slice(0, -1).replace(/\/+$/, '')
  const parsed = new URL(url)
  return { url, pathname: parsed.pathname, disableVersion }
}

function hasApiVersion(pathname: string): boolean {
  return /\/v\d+(?:alpha|beta)?(?:\/|$)/i.test(pathname)
}

function appendEndpoint(
  baseUrl: string,
  endpoint: '/chat/completions' | '/responses' | '/v1/messages'
): string {
  const parsed = parseBaseUrl(baseUrl)
  if (endpoint === '/chat/completions' && /\/chat\/completions$/i.test(parsed.url)) return parsed.url
  if (endpoint === '/responses' && /\/responses$/i.test(parsed.url)) return parsed.url
  if (endpoint === '/v1/messages' && /\/(?:v1\/)?messages$/i.test(parsed.url)) return parsed.url

  let url = parsed.url
  if (endpoint === '/v1/messages') return `${url}/v1/messages`
  if (!parsed.disableVersion && !hasApiVersion(parsed.pathname)) url += '/v1'
  return `${url}${endpoint}`
}

export function buildLlmRequest(
  config: LlmCallConfig,
  messages: ChatMessage[]
): PreparedLlmRequest {
  if (config.protocol === 'openai_chat') {
    return {
      url: appendEndpoint(config.baseUrl, '/chat/completions'),
      headers: bearerHeaders(config.apiKey),
      body: {
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false,
        ...getProviderRequestOptions(config)
      }
    }
  }

  if (config.protocol === 'openai_responses') {
    const instructions = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    const input = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }))

    return {
      url: appendEndpoint(config.baseUrl, '/responses'),
      headers: bearerHeaders(config.apiKey),
      body: {
        model: config.model,
        ...(instructions ? { instructions } : {}),
        input,
        temperature: config.temperature,
        max_output_tokens: config.maxTokens,
        stream: false
      }
    }
  }

  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
  const anthropicMessages = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: message.content }))
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01'
  }
  if (config.apiKey) headers['x-api-key'] = config.apiKey

  return {
    url: appendEndpoint(config.baseUrl, '/v1/messages'),
    headers,
    body: {
      model: config.model,
      ...(system ? { system } : {}),
      messages: anthropicMessages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: false
    }
  }
}

function bearerHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

interface NetworkErrorCause {
  code?: string
  message?: string
}

let systemProxyReady: Promise<void> | null = null

function ensureSystemProxy(): Promise<void> {
  if (!systemProxyReady) systemProxyReady = session.defaultSession.setProxy({ mode: 'system' })
  return systemProxyReady
}

function describeNetworkError(error: Error & { cause?: NetworkErrorCause }): string {
  const cause = error.cause
  switch (cause?.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `无法解析服务器域名：${cause.message ?? cause.code}`
    case 'ECONNREFUSED':
      return `服务器拒绝连接：${cause.message ?? cause.code}`
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `连接服务器超时：${cause.message ?? cause.code}`
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `HTTPS 证书校验失败：${cause.message ?? cause.code}`
    default:
      if (cause?.message) return `${error.message}：${cause.message}`
      return error.message || String(error)
  }
}

function isBailianUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl.replace(/#$/, '')).hostname.toLowerCase()
    return hostname === 'dashscope.aliyuncs.com'
      || hostname.endsWith('.dashscope.aliyuncs.com')
      || hostname.endsWith('.maas.aliyuncs.com')
  } catch {
    return false
  }
}

function readProviderErrorMessage(errorText: string): string {
  try {
    const data = JSON.parse(errorText) as {
      error?: { message?: unknown }
      message?: unknown
    }
    if (typeof data.error?.message === 'string') return data.error.message
    if (typeof data.message === 'string') return data.message
  } catch {
    // Non-JSON provider responses fall back to their original text.
  }
  return errorText.trim()
}

export function describeHttpError(
  status: number,
  errorText: string,
  config: Pick<LlmCallConfig, 'baseUrl' | 'model'>
): string {
  const providerMessage = readProviderErrorMessage(errorText)
  const unsupportedModel = providerMessage.match(/Unsupported model:\s*['"]?([^'"]+)['"]?/i)
  if (unsupportedModel) {
    const model = unsupportedModel[1].trim()
    const bailianHint = isBailianUrl(config.baseUrl)
      ? 'Base URL 已成功连通百炼；请在该 Base URL 对应的业务空间开通此模型，并确认 API Key 与 Base URL 属于同一地域和业务空间。'
      : '请确认模型名称准确，并且当前 API Key 有权调用该模型。'
    return `HTTP ${status}：服务端不支持模型“${model}”。${bailianHint}`
  }

  if (/product is not activated/i.test(providerMessage) && isBailianUrl(config.baseUrl)) {
    return `HTTP ${status}：百炼尚未开通当前模型产品。请在该 Base URL 对应的业务空间开通“${config.model}”后重试。\n服务端原文：${providerMessage}`
  }

  const detail = providerMessage || errorText
  return `HTTP ${status}: ${detail.slice(0, 500)}`
}

/** 调用 LLM，返回文本。 */
export async function chat(
  config: LlmCallConfig,
  messages: ChatMessage[]
): Promise<LlmCallResult> {
  let request: PreparedLlmRequest
  try {
    request = buildLlmRequest(config, messages)
  } catch {
    const error = 'Base URL 格式无效'
    recordLlmStatus(config, 'error', error)
    return { ok: false, error }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  try {
    await ensureSystemProxy()
    const resp = await session.defaultSession.fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      const error = describeHttpError(resp.status, errText, config)
      recordLlmStatus(config, 'error', error)
      return { ok: false, error, rawResponse: { status: resp.status, body: errText } }
    }

    const data = await resp.json()
    const text = extractChatResponseText(data)
    if (!text) {
      const error = '模型返回成功，但没有可用的文本内容。请确认所选协议与 Base URL 匹配，或适当增加最大 token。'
      recordLlmStatus(config, 'error', error)
      return { ok: false, error, rawResponse: data }
    }
    recordLlmStatus(config, 'online')
    return { ok: true, text, rawResponse: data }
  } catch (e: unknown) {
    const err = e as Error & { cause?: NetworkErrorCause }
    const error = err.name === 'AbortError' ? '请求超时（60秒）' : describeNetworkError(err)
    recordLlmStatus(config, 'error', error)
    return { ok: false, error }
  } finally {
    clearTimeout(timeout)
  }
}

/** 测试连通性（发一条极短消息）。 */
export async function testConnection(config: LlmCallConfig): Promise<LlmCallResult> {
  return chat(config, [{ role: 'user', content: '回复"OK"两个字。' }])
}
