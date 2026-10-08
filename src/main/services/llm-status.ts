import { getDb } from '../db'
import type { LlmStatus } from '@shared/types'
import type { LlmCallConfig } from './llm-adapter'

const STATUS_META_KEY = 'llm_runtime_status'

interface StoredLlmStatus {
  identity: string
  state: 'online' | 'error'
  checkedAt: string
  error?: string
}

type StatusConfig = Pick<LlmCallConfig, 'baseUrl' | 'model'>

export function getLlmIdentity(config: StatusConfig): string {
  return `${config.baseUrl.trim().replace(/\/+$/, '')}\n${config.model.trim()}`
}

export function resolveLlmStatus(
  config: StatusConfig,
  configName: string,
  stored?: StoredLlmStatus | null
): LlmStatus {
  const base = { configName, model: config.model }
  if (!stored || stored.identity !== getLlmIdentity(config)) {
    return { ...base, state: 'configured' }
  }
  return {
    ...base,
    state: stored.state,
    checkedAt: stored.checkedAt,
    error: stored.error
  }
}

export function recordLlmStatus(
  config: StatusConfig,
  state: 'online' | 'error',
  error?: string
): void {
  try {
    const value: StoredLlmStatus = {
      identity: getLlmIdentity(config),
      state,
      checkedAt: new Date().toISOString(),
      ...(error ? { error: error.slice(0, 500) } : {})
    }
    getDb().prepare(
      `INSERT INTO project_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(STATUS_META_KEY, JSON.stringify(value))
  } catch {
    // 状态记录失败不能影响 AI 请求。
  }
}

export function readLlmStatus(config: StatusConfig, configName: string): LlmStatus {
  try {
    const row = getDb().prepare('SELECT value FROM project_meta WHERE key = ?').get(STATUS_META_KEY) as
      | { value: string }
      | undefined
    const stored = row ? JSON.parse(row.value) as StoredLlmStatus : null
    return resolveLlmStatus(config, configName, stored)
  } catch {
    return resolveLlmStatus(config, configName, null)
  }
}
