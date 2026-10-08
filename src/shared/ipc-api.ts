/**
 * IPC API 声明（契约层）
 * 定义渲染进程通过 window.api 能调用主进程的全部方法。
 * 主进程的 ipc handler 必须与此一一对应。
 * 来源：《技术方案文档》第 3 节 ipc/ 模块。
 */
import type {
  Paragraph,
  GlossaryEntry,
  LlmConfig,
  LlmStatus,
  AiTask,
  AlignResult,
  AiAlignVerdict,
  Progress,
  ParaStatus,
  TermConflict,
  VocabularySuggestion,
  GlossaryInput,
  GlossaryImpact,
  GlossaryReviewStatus
} from './types'

/** 新建项目参数 */
export interface CreateProjectParams {
  bookTitle: string
  pdfPath: string
}

export interface RecognizedBlock { text: string; box: { left: number; top: number; width: number; height: number } }
export interface RecognitionState { projectPath: string; enabled: boolean; total: number; completed: number[] }
export interface ReferenceProfile { name: string; instructions: string }
export interface ReferenceSettings { count: number; profiles: ReferenceProfile[] }
export interface AutomaticBackup { id: string; createdAt: string; size: number }
export type ProjectResourceKind = 'names' | 'places' | 'terms' | 'document'

export interface MineruPackagePreview {
  rootPath: string
  bookTitle: string
  pdfPath: string
  jsonPath: string
  modelJsonPath?: string
  middleJsonPath?: string
  primaryMarkdownPath?: string
  layoutPdfPath?: string
  imageDirectory?: string
  markdownFiles: string[]
  pageCount: number
  warnings: string[]
}

export interface RecentProject {
  path: string
  title: string
  lastOpenedAt: string
  exists: boolean
}

export interface ProjectFiles {
  projectPath: string
  pdfPath: string
  pdfExists: boolean
  portable: boolean
}

/** AI 调用入参 */
export interface AiCallParams {
  task: AiTask
  paragraphId?: number
  selection?: string      // 选中的词/句（难词、难句用）
}

/** AI 调用结果（统一返回结构） */
export interface AiCallResult {
  ok: boolean
  generationId?: number
  text?: string           // 展示文本（结构化文本或纯译文）
  translationOptions?: TranslationOption[]
  termConflicts?: TermConflict[]   // 第二关全表校验发现的术语冲突
  error?: string
}

export interface TranslationOption {
  label: string
  text: string
}

export interface CreateManualParagraphParams {
  ocrRecordId?: number
  generationId?: number
  pageIdx: number
  enText: string
  bboxJson: string
  insertAfterParagraphId?: number
}

export interface UpdateParagraphRegionParams {
  ocrRecordId?: number
  generationId?: number
  id: number
  enText: string
  bboxJson: string
}

/**
 * 暴露给渲染进程的全局 API。
 * preload.ts 通过 contextBridge 把它挂到 window.api。
 */
export interface ExposedApi {
  // ── 项目 ──
  createProject(params: CreateProjectParams): Promise<{ ok: boolean; error?: string; stats?: { paragraphs: number; glossary: number; names: number; places: number; documents: number } }>
  openProject(filePath: string): Promise<{ ok: boolean; error?: string }>
  restoreLastProject(): Promise<{ ok: boolean; restored: boolean; error?: string }>
  listRecentProjects(): Promise<RecentProject[]>
  forgetRecentProject(filePath: string): Promise<void>
  removeCurrentProject(): Promise<{ ok: boolean; error?: string }>
  getProjectMeta(): Promise<Record<string, string>>
  updateProjectInfo(info: Record<string, string>): Promise<void>
  getRecognitionState(): Promise<RecognitionState>
  initializeRecognition(projectPath: string, total: number): Promise<void>
  saveRecognizedPage(projectPath: string, pageIdx: number, blocks: RecognizedBlock[], method: string): Promise<void>
  getReferenceSettings(): Promise<ReferenceSettings>
  saveReferenceSettings(settings: ReferenceSettings): Promise<void>
  updateBookPageOffset(offset: number): Promise<void>
  updateBookPageMapping(offset: number, pagesPerPdf: number, rightFirst: boolean): Promise<void>
  getProjectFiles(): Promise<ProjectFiles>
  relinkProjectPdf(): Promise<{ ok: boolean; canceled?: boolean; error?: string }>
  /** 文件选择对话框，返回路径或 null（取消） */
  pickFile(opts?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>
  pickDirectory(title?: string): Promise<string | null>
  /** 读取项目 PDF 为 ArrayBuffer（供 pdf.js 加载） */
  readPdf(): Promise<ArrayBuffer | null>

  // ── 段落 ──
  listParagraphs(): Promise<Paragraph[]>
  getParagraph(id: number): Promise<Paragraph | null>
  updateTranslation(id: number, zhText: string): Promise<void>
  flushTranslation(id: number, zhText: string): void
  updateStatus(id: number, status: ParaStatus): Promise<void>
  getProgress(): Promise<Progress>
  updateOriginalText(id: number, enText: string, generationId?: number): Promise<Paragraph>
  createManualParagraph(params: CreateManualParagraphParams): Promise<Paragraph>
  createManualParagraphBatch(params: CreateManualParagraphParams[]): Promise<Paragraph[]>
  updateParagraphRegion(params: UpdateParagraphRegionParams): Promise<Paragraph>
  reorderParagraphs(pageIdx: number, paragraphIds: number[]): Promise<void>
  mergeParagraphs(paragraphIds: number[]): Promise<Paragraph>
  unmergeParagraph(id: number): Promise<Paragraph[]>
  deleteParagraph(id: number): Promise<void>
  getParagraphNote(id: number): Promise<string>
  saveParagraphNote(id: number, content: string): Promise<void>
  listParagraphNotes(): Promise<import('./notes').ParagraphNoteSummary[]>
  getProjectNote(): Promise<string>
  saveProjectNote(content: string): Promise<void>
  listRevisions(filter?: import('./revisions').RevisionFilter): Promise<import('./revisions').RevisionPage>
  getRevisionDetail(id: number): Promise<import('./revisions').RevisionDetail>
  restoreRevision(params: import('./revisions').RestoreRevisionParams): Promise<{ paragraphId: number | null }>
  annotateRevision(id: number, category: string, reason: string): Promise<number>
  exportRevisions(): Promise<{ ok: boolean; path?: string; error?: string }>
  adoptTranslationCandidate(params: { paragraphId: number; generationId: number; candidateIndex: number; expectedDraft: string }): Promise<string>
  recordOcrResult(params: { paragraphId?: number; pageIdx: number; boxes: unknown; rotation: number; method: string; text: string; regions?: unknown }): Promise<number>
  deleteParagraphs(ids: number[]): Promise<void>
  getLastViewedParagraph(): Promise<number | null>
  setLastViewedParagraph(id: number): Promise<void>

  // ── 译稿对齐 ──
  /** 第一遍：相似度匹配，返回对齐结果（含待核对段） */
  runSimilarityAlign(): Promise<AlignResult[]>
  /** 第二遍：对单个待核对段做 AI 判定 */
  aiJudgeAlign(jsonId: number, draftIdx: number): Promise<AiAlignVerdict>
  /** 确认对齐结果入库（译者核对后） */
  commitAlign(adjustments: AlignResult[]): Promise<{ ok: boolean; error?: string }>

  // ── AI ──
  getTranslationOptions(paragraphId: number): Promise<AiCallResult>
  cleanOcrLineBreaks(enText: string, paragraphId?: number): Promise<AiCallResult>
  getVocabularySuggestions(paragraphId: number): Promise<VocabularySuggestion[]>

  // ── 术语 ──
  searchGlossary(query: string): Promise<GlossaryEntry[]>
  listGlossary(params?: { query?: string; category?: string }): Promise<GlossaryEntry[]>
  listGlossaryCategories(): Promise<string[]>
  listGlossaryAcceptances(): Promise<import('./glossary-check').GlossaryAcceptance[]>
  setGlossaryAcceptance(params: { entry: Pick<GlossaryEntry, 'id' | 'en' | 'zh'>; paragraph: Pick<Paragraph, 'id' | 'enText' | 'zhText'>; accepted: boolean }): Promise<{ ok: boolean; error?: string }>
  setGlossaryAcceptances(params: { entry: Pick<GlossaryEntry, 'id' | 'en' | 'zh'>; paragraphs: Pick<Paragraph, 'id' | 'enText' | 'zhText'>[]; accepted: boolean }): Promise<{ ok: boolean; count?: number; error?: string }>
  createGlossary(input: GlossaryInput): Promise<{ ok: boolean; entry?: GlossaryEntry; changeId?: number; impactCount?: number; error?: string }>
  updateGlossary(id: number, input: GlossaryInput): Promise<{ ok: boolean; entry?: GlossaryEntry; changeId?: number; impactCount?: number; error?: string }>
  deleteGlossary(id: number): Promise<{ ok: boolean; error?: string }>
  getGlossaryImpacts(changeId: number): Promise<GlossaryImpact[]>
  resolveGlossaryImpact(id: number, action: Exclude<GlossaryReviewStatus, 'pending'>): Promise<{ ok: boolean; error?: string }>
  applyGlossaryConsistency(params: import('./glossary-check').GlossaryConsistencyAction): Promise<{ ok: boolean; count: number; changeId?: number; error?: string }>
  listGlossaryOldTranslations(entryId: number): Promise<string[]>
  auditGlossary(): Promise<import('./glossary-audit').GlossaryAuditReport>
  applyGlossaryAudit(params: import('./glossary-audit').GlossaryAuditApply): Promise<import('./glossary-audit').GlossaryAuditApplyResult>
  bulkReplaceGlossaryImpacts(changeId: number): Promise<{ ok: boolean; replaced: number; error?: string }>
  undoGlossaryImpact(id: number): Promise<{ ok: boolean; error?: string }>
  searchOfflineDictionary(query: string): Promise<VocabularySuggestion | null>

  // ── LLM 配置 ──
  listLlmConfigs(): Promise<LlmConfig[]>
  getLlmStatus(): Promise<LlmStatus>
  saveLlmConfig(config: Partial<LlmConfig> & { id?: number }): Promise<LlmConfig>
  testLlmConnection(config: Partial<LlmConfig>): Promise<{ ok: boolean; error?: string }>
  getLlmAssignments(): Promise<Partial<Record<AiTask, number>>>
  setLlmAssignment(task: AiTask, configId: number): Promise<void>

  // ── 导出 ──
  exportTranslation(options: import('./translation-export').TranslationExportOptions): Promise<{ ok: boolean; path?: string; error?: string }>
}
