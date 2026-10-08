import { describe, expect, it } from 'vitest'
import { getProviderRequestOptions } from '../src/main/services/llm-request-options'

describe('getProviderRequestOptions', () => {
  it('disables thinking for SiliconFlow Qwen 3 models', () => {
    expect(getProviderRequestOptions({
      protocol: 'openai_chat',
      baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
      model: 'Qwen/Qwen3.5-35B-A3B'
    })).toEqual({ enable_thinking: false })
  })

  it('does not add provider fields for unrelated models', () => {
    expect(getProviderRequestOptions({
      protocol: 'openai_chat',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V3'
    })).toEqual({})
  })

  it('does not send SiliconFlow-only fields to other providers', () => {
    expect(getProviderRequestOptions({
      protocol: 'openai_chat',
      baseUrl: 'https://api.openai.com/v1',
      model: 'Qwen/Qwen3.5-35B-A3B'
    })).toEqual({})
  })

  it('uses low reasoning effort for BigModel GLM-5.2+ chat requests', () => {
    expect(getProviderRequestOptions({
      protocol: 'openai_chat',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5.3'
    })).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'low' })
  })

  it('does not send Chat-specific thinking fields to Responses', () => {
    expect(getProviderRequestOptions({
      protocol: 'openai_responses',
      baseUrl: 'https://open.bigmodel.cn/api/v1',
      model: 'glm-5.3'
    })).toEqual({})
  })
})
