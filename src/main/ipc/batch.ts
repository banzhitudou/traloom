import { ipcMain } from './secure-ipc'
import { getDb } from '../db'
import { getConfigForTask } from './llm'
import { loggedChat } from '../services/logged-llm'
import { buildOcrLineBreakPrompt, buildDraftTranslationPrompt } from '../services/prompt-builder'
import { createBatchJob, planBatch, listBatchJobs, getBatchJob, decideBatch, controlBatch, runBatch, validateBatchStart } from '../services/batch-processing'
import { parseBatchOutput, type BatchScope } from '../../shared/batch-processing'
import { originalRecognition, restoreRecognition } from '../services/restore-recognition'
import { dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { runVisionOcr } from './vision-ocr'
import { parseNormalizedBboxes } from '../../shared/bbox'
import { VISION_OCR_NOTICE, type VisionOcrInput } from '../../shared/vision-ocr'
import type { LlmCallConfig } from '../services/llm-adapter'
import type { Database } from 'better-sqlite3'

const visionApprovals = new Map<string, { db:Database; jobId:string; config:LlmCallConfig; remaining:Set<number>; expires:number }>()

export function registerBatchHandlers() {
  ipcMain.handle('batch:visionApprove', async (_event, id: string, limit: number) => {
    const db = getDb()
    const job = validateBatchStart(db,id,limit,false)
    if (job.task !== 'vision') throw new Error('不是视觉识别任务。')
    const config = await getConfigForTask('vision_ocr')
    if (!config) throw new Error('请先配置 AI 视觉识别模型。')
    const items = job.items.filter(item => item.state === 'pending').slice(0,limit)
    const requests = items.reduce((n,item) => n+parseNormalizedBboxes(item.bboxJson || '[]').length,0)
    const pages = [...new Set(items.map(item => item.pageIdx+1))]
    const answer = await dialog.showMessageBox({type:'warning',title:'批量 AI 视觉识别',message:`向模型服务发送 ${items.length} 段的区域图片？`,detail:`${VISION_OCR_NOTICE}\n\n模型：${config.model}\n服务：${new URL(config.baseUrl.replace(/#$/,'')).origin}\nPDF 页：${pages.slice(0,30).join('、')}${pages.length>30?'…':''}\n预计请求 ${requests} 次，可能产生费用。只上传区域图片，不上传整本 PDF。\n结果先预览，手动采用才会修改原文；译文和段号保留。暂停后不再发送下一段，已发请求可能计费。`,buttons:['取消','发送图片并识别'],defaultId:0,cancelId:0,noLink:true})
    if (answer.response !== 1) return null
    if (db !== getDb()) throw new Error('工程已切换。')
    for (const [token,value] of visionApprovals) if (value.expires < Date.now() || value.jobId === id) visionApprovals.delete(token)
    const token = randomUUID()
    visionApprovals.set(token,{db,jobId:id,config,remaining:new Set(items.map(item=>item.id)),expires:Date.now()+7200000})
    return token
  })
  ipcMain.handle('batch:visionStep', async (_event, token:string, input:VisionOcrInput) => {
    const approval = visionApprovals.get(token)
    const db = getDb()
    if (!approval || approval.db !== db || approval.expires < Date.now()) throw new Error('图像上传授权已失效，请重新确认。')
    const job = getBatchJob(db,approval.jobId)
    const next = job.items.find(item => item.state === 'pending')
    if (!next || next.id !== input?.paragraphId || next.pageIdx !== input.pageIdx || !approval.remaining.has(next.id) || input.test || input.rotation !== 0) throw new Error('请求不在本次确认的范围内。')
    const boxes = parseNormalizedBboxes(next.bboxJson || '[]')
    if (!Array.isArray(input.crops) || boxes.length !== input.crops.length || boxes.some((box,index) => ['left','top','width','height'].some(key => { const value = input.crops[index]?.box?.[key as keyof typeof box]; return !Number.isFinite(value) || Math.abs(box[key as keyof typeof box] - value) > .00001 }))) throw new Error('识别区域已变化，请重新建立任务。')
    approval.remaining.delete(next.id)
    await runBatch(db,job.id,1,false,async (_job,item) => {
      if (item.id !== next.id) throw new Error('段落已变化，请重新开始。')
      const result = await runVisionOcr(input, {db,config:approval.config})
      if (!result.ok || !result.text) throw new Error(result.error || '视觉识别失败。')
      return {text:result.text,generationId:result.generationId}
    },() => { try { return db === getDb() } catch { return false } })
    return getBatchJob(db,job.id)
  })
  ipcMain.handle('batch:restoreRecognition', (_event, from: number, to: number) => {
    const db = getDb()
    if (listBatchJobs(db).some(job => job.state === 'running' || job.inFlight)) throw new Error('请先暂停批量任务并等待当前请求结束，再恢复原文。')
    return restoreRecognition(db, from, to)
  })
  ipcMain.handle('paragraph:originalRecognition', (_event, id: number) => {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('无效段落。')
    return originalRecognition(getDb(), id)
  })
  ipcMain.handle('batch:plan', (_event, scope: BatchScope) => planBatch(getDb(), scope))
  ipcMain.handle('batch:list', () => listBatchJobs(getDb()))
  ipcMain.handle('batch:get', (_event, id: string) => getBatchJob(getDb(), id))
  ipcMain.handle('batch:create', (_event, scope: BatchScope, sampleIds: number[]) => createBatchJob(getDb(), scope, sampleIds))
  ipcMain.handle('batch:decide', (_event, id: string, ids: number[], adopt: boolean) => decideBatch(getDb(), id, ids, adopt))
  ipcMain.handle('batch:control', (_event, id: string, action: 'pause' | 'cancel' | 'retry') => controlBatch(getDb(), id, action))
  ipcMain.handle('batch:start', async (_event, id: string, limit: number, autoApply: boolean) => {
    const db = getDb()
    validateBatchStart(db, id, limit, autoApply)
    if (getBatchJob(db,id).task === 'vision') throw new Error('视觉识别需通过图片上传确认后运行。')
    const config = await getConfigForTask(getBatchJob(db, id).task === 'clean' ? 'ocr_line_breaks' : 'whole_para')
    if (!config) throw new Error('请先在设置中配置模型。')
    if (db !== getDb()) throw new Error('工程已切换。')
    validateBatchStart(db, id, limit, autoApply)
    const isCurrent = () => { try { return getDb() === db } catch { return false } }
    const running = runBatch(db, id, limit, autoApply, async (job, item) => {
      const prompt = job.task === 'clean' ? buildOcrLineBreakPrompt(item.source) : buildDraftTranslationPrompt(item.source, job.instructions)
      const result = await loggedChat(config, [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], job.task === 'clean' ? 'batch_line_breaks' : 'batch_draft', item.id)
      if (!result.ok || !result.text) throw new Error(result.error || '模型调用失败。')
      const response = result.rawResponse as { choices?: { finish_reason?: string }[]; stop_reason?: string; status?: string; incomplete_details?: unknown } | undefined
      if (response?.choices?.some(choice => choice.finish_reason === 'length') || response?.stop_reason === 'max_tokens' || response?.status === 'incomplete' || response?.incomplete_details) throw new Error('模型输出被截断，请增大最大 token 后重试。')
      const text = parseBatchOutput(result.text)
      return { text, generationId: result.generationId }
    }, isCurrent)
    // Observe rejection immediately; the renderer polls persisted progress instead of holding IPC open.
    void running.catch(error => console.error('[batch]', String(error)))
    const started = getBatchJob(db, id)
    if (started.state !== 'running') throw new Error('任务未启动，请等待当前请求结束或重新创建任务。')
    return started
  })
  ipcMain.handle('batch:dismissHint', () => { getDb().prepare("INSERT INTO project_meta(key,value) VALUES('batch_hint_dismissed','1') ON CONFLICT(key) DO UPDATE SET value='1'").run() })
}
