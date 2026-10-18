import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  db: {open:true,prepare:vi.fn(() => ({get:() => ({id:1})}))},
  confirm:vi.fn(), chat:vi.fn(), store:vi.fn(), finish:vi.fn(() => 7),
  config:{model:'test-vision',baseUrl:'https://example.com/v1',protocol:'openai_chat',apiKey:'test',temperature:0,maxTokens:2048}
}))
vi.mock('electron',() => ({dialog:{showMessageBox:mocks.confirm},nativeImage:{createFromBuffer:() => ({getSize:() => ({width:100,height:100})})}}))
vi.mock('../src/main/ipc/secure-ipc',() => ({ipcMain:{handle:vi.fn()}}))
vi.mock('../src/main/db',() => ({getDb:() => mocks.db}))
vi.mock('../src/main/ipc/llm',() => ({getConfigForTask:async () => mocks.config}))
vi.mock('../src/main/services/llm-adapter',() => ({chat:mocks.chat}))
vi.mock('../src/main/services/revision-history',() => ({recordGeneration:() => 7,finishGeneration:mocks.finish}))
vi.mock('../src/main/services/project-resources',() => ({storeResource:mocks.store}))
import { runVisionOcr } from '../src/main/ipc/vision-ocr'
const input = {paragraphId:1,pageIdx:0,rotation:0,crops:[{dataUrl:'data:image/png;base64,YWJj',box:{left:0,top:0,width:1,height:1}}]}
beforeEach(() => { vi.clearAllMocks(); mocks.confirm.mockResolvedValue({response:1}); mocks.chat.mockResolvedValue({ok:true,text:'{"text":"2.36 kW"}'}) })
describe('vision upload consent and preview',() => {
  it('does not upload or store images when cancelled',async () => {
    mocks.confirm.mockResolvedValue({response:0})
    expect((await runVisionOcr(input)).ok).toBe(false)
    expect(mocks.chat).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled()
  })
  it('rejects invalid input before contacting a model',async () => {
    await expect(runVisionOcr({...input,crops:[{...input.crops[0],box:{left:-1,top:0,width:1,height:1}}]})).rejects.toThrow()
    expect(mocks.chat).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled()
  })
  it('returns transcription and records image evidence without updating paragraphs',async () => {
    const result = await runVisionOcr(input)
    expect(result).toMatchObject({ok:true,text:'2.36 kW',generationId:7})
    expect(mocks.confirm).toHaveBeenCalledOnce(); expect(mocks.chat).toHaveBeenCalledOnce(); expect(mocks.store).toHaveBeenCalledOnce()
    expect(mocks.db.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.db.prepare.mock.calls[0][0]).toMatch(/^SELECT/)
  })
  it('does not accept truncated or malformed output',async () => {
    mocks.chat.mockResolvedValue({ok:true,text:'{"text":"guess"}',rawResponse:{choices:[{finish_reason:'length'}]}})
    expect((await runVisionOcr(input)).ok).toBe(false)
    mocks.chat.mockResolvedValue({ok:true,text:'not JSON'})
    expect((await runVisionOcr(input)).ok).toBe(false)
  })
})
