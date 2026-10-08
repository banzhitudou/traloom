import type { ChatMessage } from './llm-adapter'

export interface AssistantContext {
  bookTitle: string
  pageNumber?: number
  paragraphId?: number
  currentEnglish?: string
  currentChinese?: string
  nearbyEnglish?: string[]
  documentSnippet?: string
  styleGuide?: string
  glossary?: { en: string; zh: string; note?: string }[]
}

export function buildAssistantMessages(
  context: AssistantContext,
  history: ChatMessage[],
  question: string
): ChatMessage[] {
  const contextText = [
    `书名：${context.bookTitle || '未命名项目'}`,
    context.paragraphId ? `当前位置：第 ${context.pageNumber} 页，段落 #${context.paragraphId}` : '当前未选中段落',
    context.currentEnglish ? `当前原文：\n${context.currentEnglish}` : '',
    context.currentChinese ? `当前译文：\n${context.currentChinese}` : '',
    context.nearbyEnglish?.length ? `前后文：\n${context.nearbyEnglish.join('\n\n')}` : '',
    context.glossary?.length
      ? `相关术语：\n${context.glossary.map((item) => `${item.en} = ${item.zh}${item.note ? `（${item.note}）` : ''}`).join('\n')}`
      : '',
    context.documentSnippet ? `MinerU 全文片段：\n${context.documentSnippet}` : '',
    context.styleGuide ? `风格指南：\n${context.styleGuide}` : ''
  ].filter(Boolean).join('\n\n')

  return [
    {
      role: 'system',
      content: [
        '你是一位守在译者旁边的中英图书翻译助手。',
        '优先根据当前稿件上下文回答，但用户也可以问开放性问题。',
        '识别到术语表时必须沿用既定译名。不确定的事实要明说，不要编造。',
        '默认简洁、可执行；只有在用户要求时才给出完整译文。',
        `\n【当前工作上下文】\n${contextText}`
      ].join('\n')
    },
    ...history.slice(-12),
    { role: 'user', content: question }
  ]
}
