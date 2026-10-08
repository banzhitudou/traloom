import type { TranslationOption } from './ipc-api'

const OPTION_LABELS = ['贴近原文', '自然出版', '简洁儿童读物']

export function parseTranslationOptions(raw: string, count = 5): TranslationOption[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(cleaned) as { options?: unknown } | unknown[]
    const values = Array.isArray(parsed) ? parsed : parsed.options
    if (Array.isArray(values)) {
      const options = values.flatMap((value, index) => {
        if (!value || typeof value !== 'object') return []
        const item = value as { label?: unknown; text?: unknown }
        const text = typeof item.text === 'string' ? item.text.trim() : ''
        if (!text) return []
        const label = typeof item.label === 'string' && item.label.trim()
          ? item.label.trim()
          : `参考 ${index + 1}`
        return [{ label, text }]
      })
      if (options.length > 0) return options.slice(0, count)
    }
  } catch {
    // 兼容旧模型按【标题】输出的格式。
  }

  return OPTION_LABELS.flatMap((label, index) => {
    const marker = `【${label}】`
    const start = cleaned.indexOf(marker)
    if (start < 0) return []
    const nextStarts = OPTION_LABELS
      .slice(index + 1)
      .map((nextLabel) => cleaned.indexOf(`【${nextLabel}】`, start + marker.length))
      .filter((position) => position >= 0)
    const end = nextStarts.length > 0 ? Math.min(...nextStarts) : cleaned.length
    const text = cleaned.slice(start + marker.length, end).trim()
    return text ? [{ label, text }] : []
  })
}
