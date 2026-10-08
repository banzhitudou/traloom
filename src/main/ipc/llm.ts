/**
 * LLM 配置管理 IPC handlers
 * channel: llm:list / llm:save / llm:test / llm:assign / llm:getAssignment
 * API Key 用 safeStorage 加解密。
 */
import { ipcMain } from './secure-ipc'
import { getDb, getCurrentDbPath } from '../db'
import { encryptApiKey, decryptApiKey } from '../services/crypto'
import { chat, type LlmCallConfig } from '../services/llm-adapter'
import { readLlmStatus } from '../services/llm-status'
import type { LlmConfig, LlmStatus, AiTask } from '@shared/types'
import { positiveId, sameModelEndpoint, validateModelConfig } from '../services/security-validation'
import { authorizeModelEndpoint } from '../services/model-permissions'

function normalizeProtocol(protocol: string): LlmConfig['protocol'] {
  if (protocol === 'openai_responses' || protocol === 'anthropic') return protocol
  return 'openai_chat'
}

interface LlmConfigRow {
  id: number
  name: string
  protocol: string
  base_url: string
  api_key_enc: Buffer | null
  model: string
  temperature: number
  max_tokens: number
  system_prompt: string
  is_default: number
}

function rowToConfig(r: LlmConfigRow): LlmConfig {
  return {
    id: r.id,
    name: r.name,
    protocol: normalizeProtocol(r.protocol),
    baseUrl: r.base_url,
    model: r.model,
    temperature: r.temperature,
    maxTokens: r.max_tokens,
    systemPrompt: r.system_prompt,
    isDefault: r.is_default === 1
  }
}

/** 取某个任务的已分配配置（含解密后的 key），供 ai:call 用 */
export async function getConfigForTask(task: AiTask): Promise<LlmCallConfig | null> {
  const db = getDb()
  const row = db.prepare(
    `SELECT c.* FROM llm_assignment a
     JOIN llm_config c ON a.config_id = c.id
     WHERE a.task = ?`
  ).get(task) as LlmConfigRow | undefined

  if (!row) {
    // 未分配，尝试默认配置
    const def = db.prepare('SELECT * FROM llm_config WHERE is_default = 1 LIMIT 1').get() as
      | LlmConfigRow
      | undefined
    if (!def) return null
    await authorizeModelEndpoint(getCurrentDbPath()!, def.base_url)
    if (db !== getDb()) throw new Error('工程已切换，请重试。')
    return rowToCallConfig(def)
  }
  await authorizeModelEndpoint(getCurrentDbPath()!, row.base_url)
  if (db !== getDb()) throw new Error('工程已切换，请重试。')
  return rowToCallConfig(row)
}

function rowToCallConfig(r: LlmConfigRow): LlmCallConfig {
  return {
    protocol: normalizeProtocol(r.protocol),
    baseUrl: r.base_url,
    apiKey: r.api_key_enc ? decryptApiKey(r.api_key_enc) : '',
    model: r.model,
    temperature: r.temperature,
    maxTokens: r.max_tokens
  }
}

const ASSIGNABLE_TASKS: AiTask[] = ['whole_para']

function assignAsDefault(db: ReturnType<typeof getDb>, configId: number): void {
  db.prepare('UPDATE llm_config SET is_default = 0').run()
  db.prepare('UPDATE llm_config SET is_default = 1 WHERE id = ?').run(configId)
  const assign = db.prepare(
    `INSERT INTO llm_assignment (task, config_id) VALUES (?, ?)
     ON CONFLICT(task) DO UPDATE SET config_id = excluded.config_id`
  )
  for (const task of ASSIGNABLE_TASKS) assign.run(task, configId)
}

export function registerLlmHandlers(): void {
  // 列出所有配置（不含明文 key）
  ipcMain.handle('llm:list', async () => {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM llm_config ORDER BY is_default DESC, name ASC').all() as LlmConfigRow[]
    return rows.map(rowToConfig)
  })

  ipcMain.handle('llm:status', async (): Promise<LlmStatus> => {
    const db = getDb()
    const row = db.prepare(
      `SELECT c.* FROM llm_assignment a
       JOIN llm_config c ON a.config_id = c.id
       WHERE a.task = 'whole_para'`
    ).get() as LlmConfigRow | undefined
    const active = row ?? db.prepare(
      'SELECT * FROM llm_config WHERE is_default = 1 LIMIT 1'
    ).get() as LlmConfigRow | undefined

    if (!active) return { state: 'unconfigured' }
    return readLlmStatus({ baseUrl: active.base_url, model: active.model }, active.name)
  })

  // 保存（新增或更新）配置；apiKey 加密存储
  ipcMain.handle('llm:save', async (_event, config) => {
    validateModelConfig(config)
    const db = getDb()
    const saved = config.id ? db.prepare('SELECT * FROM llm_config WHERE id=?').get(config.id) as LlmConfigRow | undefined : undefined
    if (config.id && !saved) throw new Error('模型配置不存在。')
    if (saved?.api_key_enc && !config.apiKey && !sameModelEndpoint(config, rowToConfig(saved))) throw new Error('服务地址或协议已改变，请重新填写 API Key。')
    await authorizeModelEndpoint(getCurrentDbPath()!, config.baseUrl)
    if (db !== getDb()) throw new Error('工程已切换，请重试。')
    return db.transaction(() => {
    const apiKeyEnc = config.apiKey ? encryptApiKey(config.apiKey) : null
    const protocol = normalizeProtocol(config.protocol)
    let configId: number

    if (config.id) {
      // 更新：apiKey 为空时保留原值
      if (apiKeyEnc) {
        db.prepare(
          `UPDATE llm_config SET name=?, protocol=?, base_url=?, api_key_enc=?, model=?, temperature=?, max_tokens=?, system_prompt=?, is_default=? WHERE id=?`
        ).run(
          config.name, protocol, config.baseUrl, apiKeyEnc, config.model,
          config.temperature, config.maxTokens, config.systemPrompt,
          config.isDefault ? 1 : 0, config.id
        )
      } else {
        db.prepare(
          `UPDATE llm_config SET name=?, protocol=?, base_url=?, model=?, temperature=?, max_tokens=?, system_prompt=?, is_default=? WHERE id=?`
        ).run(
          config.name, protocol, config.baseUrl, config.model,
          config.temperature, config.maxTokens, config.systemPrompt,
          config.isDefault ? 1 : 0, config.id
        )
      }
      configId = config.id
    } else {
      const info = db.prepare(
        `INSERT INTO llm_config (name, protocol, base_url, api_key_enc, model, temperature, max_tokens, system_prompt, is_default)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        config.name, protocol, config.baseUrl, apiKeyEnc, config.model,
        config.temperature, config.maxTokens, config.systemPrompt,
        config.isDefault ? 1 : 0
      )
      const count = (db.prepare('SELECT COUNT(*) AS n FROM llm_config').get() as { n: number }).n
      configId = Number(info.lastInsertRowid)
      if (count === 1 && !config.isDefault) {
        db.prepare('UPDATE llm_config SET is_default = 1 WHERE id = ?').run(configId)
        config.isDefault = true
      }
    }

    if (config.isDefault) assignAsDefault(db, configId)
    return rowToConfig(
      db.prepare('SELECT * FROM llm_config WHERE id=?').get(configId) as LlmConfigRow
    )
    })()
  })

  // 测试连通性
  ipcMain.handle('llm:test', async (_event, config) => {
    validateModelConfig(config)
    const db = getDb()
    const savedConfig = config.id ? db.prepare('SELECT * FROM llm_config WHERE id=?').get(config.id) as LlmConfigRow | undefined : undefined
    if (config.id && !savedConfig) throw new Error('模型配置不存在。')
    if (savedConfig?.api_key_enc && !config.apiKey && !sameModelEndpoint(config, rowToConfig(savedConfig))) throw new Error('服务地址或协议已改变，请重新填写 API Key，不能复用旧密钥。')
    await authorizeModelEndpoint(getCurrentDbPath()!, config.baseUrl)
    if (db !== getDb()) throw new Error('工程已切换，请重试。')
    let apiKey = config.apiKey || ''
    if (!apiKey && savedConfig?.api_key_enc) apiKey = decryptApiKey(savedConfig.api_key_enc)

    const result = await chat(
      {
        protocol: normalizeProtocol(config.protocol),
        baseUrl: config.baseUrl,
        apiKey,
        model: config.model,
        temperature: Number.isFinite(config.temperature) ? Math.max(0.01, config.temperature) : 0.3,
        maxTokens: Math.max(256, Number(config.maxTokens) || 0)
      },
      [{ role: 'user', content: '回复"OK"两个字。' }]
    )
    return { ok: result.ok, error: result.error }
  })

  ipcMain.handle('llm:assignments', async () => {
    const db = getDb()
    const rows = db.prepare('SELECT task, config_id FROM llm_assignment').all() as { task: AiTask; config_id: number | null }[]
    return Object.fromEntries(rows.filter((row) => row.config_id !== null).map((row) => [row.task, row.config_id]))
  })

  // 设置任务-模型分配
  ipcMain.handle('llm:assign', async (_event, args: { task: AiTask; configId: number }) => {
    if (!args || typeof args !== 'object') throw new Error('无效的模型任务。')
    const { task, configId } = args
    positiveId(configId)
    if (!ASSIGNABLE_TASKS.includes(task)) throw new Error('无效的模型任务。')
    const db = getDb()
    if (!db.prepare('SELECT 1 FROM llm_config WHERE id=?').get(configId)) throw new Error('模型配置不存在。')
    db.prepare(
      `INSERT INTO llm_assignment (task, config_id) VALUES (?, ?)
       ON CONFLICT(task) DO UPDATE SET config_id = excluded.config_id`
    ).run(task, configId)
  })
}
