import { describe, expect, it } from 'vitest'
import { getLlmIdentity, resolveLlmStatus } from '../src/main/services/llm-status'

const config = {
  baseUrl: 'https://api.siliconflow.cn/v1/chat/completions/',
  model: 'Qwen/Qwen3.5-35B-A3B'
}

describe('LLM runtime status', () => {
  it('shows configured before a request has verified connectivity', () => {
    expect(resolveLlmStatus(config, '硅基流动')).toEqual({
      state: 'configured',
      configName: '硅基流动',
      model: config.model
    })
  })

  it('restores a matching successful result', () => {
    expect(resolveLlmStatus(config, '硅基流动', {
      identity: getLlmIdentity(config),
      state: 'online',
      checkedAt: '2026-07-15T00:00:00.000Z'
    }).state).toBe('online')
  })

  it('ignores stale status from a different model', () => {
    expect(resolveLlmStatus(config, '硅基流动', {
      identity: 'old endpoint\nold model',
      state: 'online',
      checkedAt: '2026-07-15T00:00:00.000Z'
    }).state).toBe('configured')
  })
})
