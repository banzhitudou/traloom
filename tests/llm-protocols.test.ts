import { describe, expect, it } from 'vitest'
import {
  buildLlmRequest,
  describeHttpError,
  extractChatResponseText
} from '../src/main/services/llm-adapter'

const baseConfig = {
  apiKey: 'secret',
  model: 'glm-5.3',
  temperature: 0.3,
  maxTokens: 2048
}

const messages = [
  { role: 'system' as const, content: 'Translate into Chinese.' },
  { role: 'user' as const, content: 'Hello.' }
]

describe('LLM protocol request builders', () => {
  it('builds a Chat Completions request', () => {
    const request = buildLlmRequest({
      ...baseConfig,
      protocol: 'openai_chat',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4'
    }, messages)

    expect(request.url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions')
    expect(request.headers.Authorization).toBe('Bearer secret')
    expect(request.body).toMatchObject({ messages, max_tokens: 2048 })
  })

  it('appends Chat Completions to an Alibaba Model Studio workspace URL', () => {
    const request = buildLlmRequest({
      ...baseConfig,
      protocol: 'openai_chat',
      baseUrl: 'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      model: 'ZHIPU/GLM-5.3'
    }, messages)

    expect(request.url).toBe(
      'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
    )
  })

  it('builds a Responses request with instructions and max_output_tokens', () => {
    const request = buildLlmRequest({
      ...baseConfig,
      protocol: 'openai_responses',
      baseUrl: 'https://open.bigmodel.cn/api/v1'
    }, messages)

    expect(request.url).toBe('https://open.bigmodel.cn/api/v1/responses')
    expect(request.body).toMatchObject({
      instructions: 'Translate into Chinese.',
      input: [{ role: 'user', content: 'Hello.' }],
      max_output_tokens: 2048
    })
    expect(request.body).not.toHaveProperty('messages')
  })

  it('builds an Anthropic Messages request with a separate system prompt', () => {
    const request = buildLlmRequest({
      ...baseConfig,
      protocol: 'anthropic',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic'
    }, messages)

    expect(request.url).toBe('https://open.bigmodel.cn/api/anthropic/v1/messages')
    expect(request.headers['x-api-key']).toBe('secret')
    expect(request.body).toMatchObject({
      system: 'Translate into Chinese.',
      messages: [{ role: 'user', content: 'Hello.' }],
      max_tokens: 2048
    })
  })
})

describe('LLM protocol response parsing', () => {
  it('parses Chat Completions text', () => {
    expect(extractChatResponseText({
      choices: [{ message: { content: '你好。' } }]
    })).toBe('你好。')
  })

  it('parses Responses output blocks', () => {
    expect(extractChatResponseText({
      output: [{ content: [{ type: 'output_text', text: '你好。' }] }]
    })).toBe('你好。')
  })

  it('parses Anthropic content blocks', () => {
    expect(extractChatResponseText({
      content: [{ type: 'text', text: '你好。' }]
    })).toBe('你好。')
  })
})

describe('LLM provider errors', () => {
  it('explains an unavailable Alibaba Model Studio model', () => {
    const error = describeHttpError(400, JSON.stringify({
      error: { type: 'InvalidParameter', message: "Unsupported model: 'ZHIPU/GLM-5.3'." }
    }), {
      baseUrl: 'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      model: 'ZHIPU/GLM-5.3'
    })

    expect(error).toContain('Base URL 已成功连通百炼')
    expect(error).toContain('API Key 与 Base URL 属于同一地域和业务空间')
  })

  it('explains an Alibaba Model Studio product activation error', () => {
    const error = describeHttpError(400, JSON.stringify({
      message: 'The product is not activated, please confirm that you have activated products and try again after activation.'
    }), {
      baseUrl: 'https://llm-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      model: 'ZHIPU/GLM-5.3'
    })

    expect(error).toContain('百炼尚未开通当前模型产品')
    expect(error).toContain('服务端原文')
  })
})
