/**
 * IPC handlers 注册入口。
 * 主进程启动时调用 registerAll() 注册所有模块的 handler。
 * 各模块独立文件，互不依赖。
 */
import { registerProjectHandlers } from './project'
import { registerParagraphHandlers } from './paragraph'
import { registerAiHandlers } from './ai'
import { registerGlossaryHandlers } from './glossary'
import { registerLlmHandlers } from './llm'
import { registerExportHandlers } from './export'
import { registerVocabularyHandlers } from './vocabulary'
import { registerRevisionHandlers } from './revisions'

export async function registerAll(): Promise<void> {
  registerProjectHandlers()
  registerParagraphHandlers()
  registerAiHandlers()
  registerGlossaryHandlers()
  registerLlmHandlers()
  registerExportHandlers()
  registerVocabularyHandlers()
  registerRevisionHandlers()
  console.log('[ipc] 所有 handler 已注册')
}
