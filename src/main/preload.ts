import { contextBridge, ipcRenderer } from 'electron'

/**
 * preload：通过 contextBridge 把受限的 IPC 接口暴露给渲染进程。
 * 渲染进程只能通过 window.api.* 调用，无法直接访问 Node/Electron 能力。
 * 接口契约见 src/shared/ipc-api.ts
 */

const api = {
  // ── 项目 ──
  createProject: (params) => ipcRenderer.invoke('project:create', params),
  openProject: (filePath: string) => ipcRenderer.invoke('project:open', filePath),
  restoreLastProject: () => ipcRenderer.invoke('project:restoreLast'),
  listRecentProjects: () => ipcRenderer.invoke('project:listRecent'),
  forgetRecentProject: (filePath: string) => ipcRenderer.invoke('project:forgetRecent', filePath),
  removeCurrentProject: () => ipcRenderer.invoke('project:removeCurrent'),
  getProjectMeta: () => ipcRenderer.invoke('project:meta'),
  updateProjectInfo: (info) => ipcRenderer.invoke('project:updateInfo', info),
  getRecognitionState: () => ipcRenderer.invoke('project:recognitionState'),
  initializeRecognition: (projectPath, total) => ipcRenderer.invoke('project:recognitionInit', projectPath, total),
  saveRecognizedPage: (projectPath, pageIdx, blocks, method) => ipcRenderer.invoke('project:recognitionPage', projectPath, pageIdx, blocks, method),
  getReferenceSettings: () => ipcRenderer.invoke('ai:referenceSettings'),
  saveReferenceSettings: (settings) => ipcRenderer.invoke('ai:saveReferenceSettings', settings),
  updateBookPageOffset: (offset) => ipcRenderer.invoke('project:bookPageOffset', offset),
  updateBookPageMapping: (offset, pagesPerPdf, rightFirst) => ipcRenderer.invoke('project:bookPageMapping', offset, pagesPerPdf, rightFirst),
  getProjectFiles: () => ipcRenderer.invoke('project:files'),
  relinkProjectPdf: () => ipcRenderer.invoke('project:relinkPdf'),
  pickFile: (opts: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('project:pickFile', opts),
  pickDirectory: (title?: string) => ipcRenderer.invoke('project:pickDirectory', title),
  readPdf: () => ipcRenderer.invoke('project:readPdf'),

  // ── 段落 ──
  listParagraphs: () => ipcRenderer.invoke('paragraph:list'),
  getParagraph: (id: number) => ipcRenderer.invoke('paragraph:get', id),
  updateTranslation: (id: number, zhText: string) =>
    ipcRenderer.invoke('paragraph:updateTranslation', { id, zhText }),
  flushTranslation: (id: number, zhText: string) =>
    ipcRenderer.sendSync('paragraph:flushTranslation', { id, zhText }),
  updateStatus: (id: number, status: string) =>
    ipcRenderer.invoke('paragraph:updateStatus', { id, status }),
  getProgress: () => ipcRenderer.invoke('paragraph:progress'),
  updateOriginalText: (id: number, enText: string, generationId?: number) =>
    ipcRenderer.invoke('paragraph:updateOriginalText', { id, enText, generationId }),
  createManualParagraph: (params) => ipcRenderer.invoke('paragraph:createManual', params),
  createManualParagraphBatch: (params) => ipcRenderer.invoke('paragraph:createManualBatch', params),
  updateParagraphRegion: (params) => ipcRenderer.invoke('paragraph:updateRegion', params),
  reorderParagraphs: (pageIdx: number, paragraphIds: number[]) =>
    ipcRenderer.invoke('paragraph:reorder', { pageIdx, paragraphIds }),
  mergeParagraphs: (paragraphIds: number[]) => ipcRenderer.invoke('paragraph:merge', paragraphIds),
  unmergeParagraph: (id) => ipcRenderer.invoke('paragraph:unmerge', id),
  deleteParagraph: (id: number) => ipcRenderer.invoke('paragraph:delete', id),
  getParagraphNote: (id: number) => ipcRenderer.invoke('paragraph:getNote', id),
  saveParagraphNote: (id: number, content: string) => ipcRenderer.invoke('paragraph:saveNote', id, content),
  listParagraphNotes: () => ipcRenderer.invoke('paragraph:listNotes'),
  getProjectNote: () => ipcRenderer.invoke('notes:getProject'),
  saveProjectNote: (content: string) => ipcRenderer.invoke('notes:saveProject', content),
  listRevisions: (filter) => ipcRenderer.invoke('revision:list', filter),
  getRevisionDetail: (id) => ipcRenderer.invoke('revision:detail', id),
  restoreRevision: (params) => ipcRenderer.invoke('revision:restore', params),
  annotateRevision: (id, category, reason) => ipcRenderer.invoke('revision:annotate', id, category, reason),
  exportRevisions: () => ipcRenderer.invoke('revision:export'),
  adoptTranslationCandidate: (params) => ipcRenderer.invoke('revision:adoptCandidate', params),
  recordOcrResult: (params) => ipcRenderer.invoke('revision:recordOcr', params),
  deleteParagraphs: (ids: number[]) => ipcRenderer.invoke('paragraph:delete-many', ids),
  getLastViewedParagraph: () => ipcRenderer.invoke('paragraph:lastViewed'),
  setLastViewedParagraph: (id: number) => ipcRenderer.invoke('paragraph:setLastViewed', id),

  // ── 译稿对齐 ──
  runSimilarityAlign: () => ipcRenderer.invoke('align:similarity'),
  aiJudgeAlign: (jsonId: number, draftIdx: number) =>
    ipcRenderer.invoke('align:aiJudge', { jsonId, draftIdx }),
  commitAlign: (adjustments) => ipcRenderer.invoke('align:commit', adjustments),

  // ── AI ──
  getTranslationOptions: (paragraphId: number) => ipcRenderer.invoke('ai:translationOptions', paragraphId),
  cleanOcrLineBreaks: (enText: string, paragraphId?: number) => ipcRenderer.invoke('ai:cleanOcrLineBreaks', enText, paragraphId),
  getVocabularySuggestions: (paragraphId: number) => ipcRenderer.invoke('vocabulary:suggestions', paragraphId),

  // ── 术语 ──
  searchGlossary: (query: string) => ipcRenderer.invoke('glossary:search', query),
  listGlossary: (params) => ipcRenderer.invoke('glossary:list', params),
  listGlossaryCategories: () => ipcRenderer.invoke('glossary:categories'),
  listGlossaryAcceptances: () => ipcRenderer.invoke('glossary:acceptances'),
  setGlossaryAcceptance: (params) => ipcRenderer.invoke('glossary:setAcceptance', params),
  setGlossaryAcceptances: (params) => ipcRenderer.invoke('glossary:setAcceptance', params),
  createGlossary: (input) => ipcRenderer.invoke('glossary:create', input),
  updateGlossary: (id: number, input) => ipcRenderer.invoke('glossary:update', { id, input }),
  deleteGlossary: (id: number) => ipcRenderer.invoke('glossary:delete', id),
  getGlossaryImpacts: (changeId: number) => ipcRenderer.invoke('glossary:impacts', changeId),
  resolveGlossaryImpact: (id: number, action: string) => ipcRenderer.invoke('glossary:resolveImpact', { id, action }),
  applyGlossaryConsistency: (params) => ipcRenderer.invoke('glossary:applyConsistency', params),
  listGlossaryOldTranslations: (entryId) => ipcRenderer.invoke('glossary:oldTranslations', entryId),
  auditGlossary: () => ipcRenderer.invoke('glossary:audit'),
  applyGlossaryAudit: (params) => ipcRenderer.invoke('glossary:applyAudit', params),
  bulkReplaceGlossaryImpacts: (changeId: number) => ipcRenderer.invoke('glossary:bulkReplace', changeId),
  undoGlossaryImpact: (id: number) => ipcRenderer.invoke('glossary:undoImpact', id),
  searchOfflineDictionary: (query: string) => ipcRenderer.invoke('glossary:offlineDictionary', query),

  // ── LLM 配置 ──
  listLlmConfigs: () => ipcRenderer.invoke('llm:list'),
  getLlmStatus: () => ipcRenderer.invoke('llm:status'),
  saveLlmConfig: (config) => ipcRenderer.invoke('llm:save', config),
  testLlmConnection: (config) => ipcRenderer.invoke('llm:test', config),
  getLlmAssignments: () => ipcRenderer.invoke('llm:assignments'),
  setLlmAssignment: (task: string, configId: number) =>
    ipcRenderer.invoke('llm:assign', { task, configId }),

  // ── 导出 ──
  exportTranslation: (options) => ipcRenderer.invoke('export:run', options)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}
