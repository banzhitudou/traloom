import { type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { ipcMain as electronIpc } from './secure-ipc'
import { getDb, hasDb } from '../db'
import { withRevisionContext } from '../services/revision-history'
import type { RevisionSource } from '../../shared/revisions'

const actions: Record<string, string> = {
  'paragraph:updateTranslation': '修改译文', 'paragraph:flushTranslation': '保存最后输入',
  'paragraph:updateStatus': '修改状态', 'paragraph:updateOriginalText': '修改原文',
  'paragraph:createManual': '补录翻译段', 'paragraph:createManualBatch': '批量补录翻译段',
  'paragraph:updateRegion': '调整识别区域', 'paragraph:reorder': '调整段落顺序',
  'paragraph:merge': '合并翻译段', 'paragraph:delete': '删除翻译段', 'paragraph:delete-many': '批量删除翻译段',
  'paragraph:unmerge': '解散合并翻译段',
  'paragraph:saveNote': '修改段落备注', 'notes:saveProject': '修改项目备注',
  'align:commit': '导入对齐译稿', 'glossary:create': '新增项目术语', 'glossary:update': '修改项目术语',
  'glossary:delete': '删除项目术语', 'glossary:resolveImpact': '处理术语影响',
  'glossary:setAcceptance': '修改此处译名认可',
  'glossary:applyConsistency': '处理术语一致性', 'glossary:applyAudit': '全书术语批量操作',
  'glossary:bulkReplace': '批量替换术语', 'glossary:undoImpact': '撤销术语替换'
}

function recorded<T>(channel: string, args: unknown[], work: () => T): T {
  if (!hasDb() || !actions[channel]) return work()
  const first = args[0]
  const metadata: Record<string, unknown> = { channel }
  if (Array.isArray(first)) metadata.items = first
  else if (first && typeof first === 'object') {
    for (const key of ['id', 'paragraphId', 'paragraphIds', 'pageIdx', 'action', 'changeId', 'oldZh', 'generationId', 'candidateIndex', 'ocrRecordId']) {
      if (key in first) metadata[key] = first[key as keyof typeof first]
    }
  } else if (typeof first === 'number') metadata.id = first
  const source: RevisionSource = channel === 'align:commit' ? 'import' : 'human'
  return withRevisionContext(getDb(), actions[channel], source, metadata, work)
}

export const recordedIpc = {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any) {
    electronIpc.handle(channel, (event, ...args) => recorded(channel, args, () => listener(event, ...args)))
  },
  on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) {
    electronIpc.on(channel, (event, ...args) => recorded(channel, args, () => listener(event, ...args)))
  }
}
