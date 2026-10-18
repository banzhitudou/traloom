import { dialog, nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import { ipcMain } from './secure-ipc'
import { getDb } from '../db'
import { getConfigForTask } from './llm'
import type { Database } from 'better-sqlite3'
import type { LlmCallConfig } from '../services/llm-adapter'
import { chat } from '../services/llm-adapter'
import { recordGeneration, finishGeneration } from '../services/revision-history'
import { storeResource } from '../services/project-resources'
import { VISION_OCR_PROMPT, VISION_OCR_NOTICE, parseVisionOcr, type VisionOcrInput } from '../../shared/vision-ocr'

export function registerVisionOcrHandlers() {
  ipcMain.handle('ocr:vision', (_event, input: VisionOcrInput) => runVisionOcr(input))
}
export async function runVisionOcr(input: VisionOcrInput, approved?: { db: Database; config: LlmCallConfig }) {
    if (!input || !Number.isSafeInteger(input.pageIdx) || input.pageIdx < 0 || ![0,90,180,270,-90].includes(input.rotation) || !Array.isArray(input.crops) || !input.crops.length || input.crops.length > 16) throw new Error('无效的视觉识别区域。')
    const db = getDb()
    if (approved && approved.db !== db) throw new Error('工程已切换。')
    if (input.paragraphId !== undefined && (!Number.isSafeInteger(input.paragraphId) || !db.prepare('SELECT 1 FROM paragraph WHERE id=? AND page_idx=?').get(input.paragraphId,input.pageIdx))) throw new Error('翻译段不存在或页面不匹配。')
    const images = input.crops.map(crop => {
      if (!crop || typeof crop.dataUrl !== 'string' || crop.dataUrl.length > 12000000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(crop.dataUrl)) throw new Error('图片必须是 PNG 或 JPEG，大小不超过约 9 MB。')
      const b = crop.box
      if (!b || ![b.left,b.top,b.width,b.height].every(Number.isFinite) || b.left < 0 || b.top < 0 || b.width <= 0 || b.height <= 0 || b.left+b.width > 1.001 || b.top+b.height > 1.001) throw new Error('图片区域坐标无效。')
      const bytes = Buffer.from(crop.dataUrl.split(',')[1], 'base64')
      const size = nativeImage.createFromBuffer(bytes).getSize()
      if (!size.width || !size.height || size.width * size.height > 16000000) throw new Error('图片尺寸无效或超过1600万像素。')
      return { crop, bytes, hash: createHash('sha256').update(bytes).digest('hex'), ...size }
    })
    if (images.reduce((n,image) => n+image.bytes.length,0) > 20000000) throw new Error('一次识别的图片总量过大，请减少区域。')
    const config = approved?.config ?? await getConfigForTask('vision_ocr')
    if (!config) throw new Error('请在“设置 → 模型配置 → 用途分配”指定 AI 视觉识别模型。')
    if (!approved) {
      const answer = await dialog.showMessageBox({ type: 'warning', title: input.test ? '测试图片识别' : 'AI 视觉识别', message: '是否向模型服务发送这些图片？', detail: `${VISION_OCR_NOTICE}\n\n模型：${config.model}\n服务：${new URL(config.baseUrl.replace(/#$/, '')).origin}\n${input.test ? '内容：软件生成的测试图片' : `范围：PDF 第 ${input.pageIdx+1} 页，${images.length} 个框选区域`}\n请求数：${images.length}。可能产生费用，并非免费试用。只发送所选区域图片，不发送整本 PDF。\n结果仅预览，确认后才改动原文。`, buttons: ['取消','发送图片并识别'], defaultId:0, cancelId:0, noLink:true })
      if (answer.response !== 1) return { ok:false, error:'已取消，未发送图片。' }
    }
    if (db !== getDb() || !db.open) throw new Error('工程已切换，未发送图片。')
    const texts: string[] = [], generationIds: number[] = []
    for (const image of images) {
      if (db !== getDb() || !db.open) throw new Error('工程已切换，已停止发送后续图片。')
      const resource = `files/recognition/vision/${image.hash}.${image.crop.dataUrl.startsWith('data:image/png') ? 'png' : 'jpg'}`
      storeResource(db, resource, image.bytes)
      const generation = recordGeneration(db, { paragraphId:input.paragraphId, task:'vision_ocr', input:{ pageIdx:input.pageIdx, rotation:input.rotation, box:image.crop.box, resource, sha256:image.hash, width:image.width,height:image.height, prompt:VISION_OCR_PROMPT }, model:{ protocol:config.protocol, model:config.model, temperature:config.temperature,maxTokens:config.maxTokens } })
      const result = await chat(config,[{role:'system',content:VISION_OCR_PROMPT},{role:'user',content:[{type:'text',text:'请识别这张区域图片中的原文。'},{type:'image_url',image_url:{url:image.crop.dataUrl}}]}])
      if (db !== getDb() || !db.open) throw new Error('工程已切换，结果未写入当前工程。')
      const raw = result.rawResponse as any
      let text = ''
      let error = result.error
      if (result.ok) try {
        if (raw?.choices?.some((choice: any) => choice.finish_reason === 'length') || raw?.stop_reason === 'max_tokens' || raw?.status === 'incomplete') throw new Error('模型输出被截断，请增大最大 token 后重试。')
        text = parseVisionOcr(result.text || '')
      } catch (e) { error = String(e) }
      const generationId = finishGeneration(db,generation,{ ...result, error, text:text || result.text })
      if (!text) return { ok:false,error:error || '视觉识别失败。',generationId }
      texts.push(text); generationIds.push(generationId)
    }
    return { ok:true,text:texts.join('\n\n'),generationId:generationIds[generationIds.length-1],generationIds }
}
