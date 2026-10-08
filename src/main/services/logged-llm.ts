import { getDb } from '../db'
import { chat, buildLlmRequest, type ChatMessage, type LlmCallConfig, type LlmCallResult } from './llm-adapter'
import { recordGeneration, finishGeneration } from './revision-history'

export async function loggedChat(config: LlmCallConfig, messages: ChatMessage[], task: string, paragraphId?: number): Promise<LlmCallResult & { generationId?: number }> {
  const db = getDb()
  const model = { protocol: config.protocol, model: config.model, temperature: config.temperature, maxTokens: config.maxTokens }
  let request: unknown = null
  try {
    const prepared = buildLlmRequest(config, messages)
    const endpoint = new URL(prepared.url)
    request = { endpoint: endpoint.origin + endpoint.pathname, body: prepared.body }
  } catch { /* Invalid configuration is recorded by chat as a failed result. */ }
  const requestId = recordGeneration(db, { paragraphId, task, input: messages, model, context: { request } })
  const result = await chat(config, messages)
  if (db !== getDb() || !db.open) return { ok: false, error: '工程已切换，AI 结果未写入当前工程。' }
  const generationId = finishGeneration(db, requestId, result)
  return { ...result, generationId }
}
