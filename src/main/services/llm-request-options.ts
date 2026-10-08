import type { LlmCallConfig } from './llm-adapter'

type ProviderOptions = Record<string, unknown>

/** Provider-specific OpenAI-compatible options that are safe to send. */
export function getProviderRequestOptions(
  config: Pick<LlmCallConfig, 'protocol' | 'baseUrl' | 'model'>
): ProviderOptions {
  let hostname = ''
  try {
    hostname = new URL(config.baseUrl.replace(/#$/, '')).hostname.toLowerCase()
  } catch {
    return {}
  }

  const isSiliconFlow = hostname === 'siliconflow.cn' || hostname.endsWith('.siliconflow.cn')
  const isBigModel = hostname === 'bigmodel.cn' || hostname.endsWith('.bigmodel.cn')
  const isQwen3 = /(^|\/)qwen3(?:[.\-]|$)/i.test(config.model)
  const glm5Minor = config.model.match(/^glm-5\.(\d+)(?:[.\-]|$)/i)?.[1]
  const supportsReasoningEffort = glm5Minor !== undefined && Number(glm5Minor) >= 2

  // SiliconFlow enables thinking by default for Qwen 3/3.5. Translation tools
  // need the token budget for the visible answer rather than hidden reasoning.
  if (config.protocol === 'openai_chat' && isSiliconFlow && isQwen3) {
    return { enable_thinking: false }
  }

  // GLM-5.2 及以上支持 reasoning_effort；其中部分模型为强制思考，
  // 不能发送 disabled。翻译任务使用其接受的最低推理档位。
  if (config.protocol === 'openai_chat' && isBigModel && supportsReasoningEffort) {
    return { thinking: { type: 'enabled' }, reasoning_effort: 'low' }
  }

  return {}
}
