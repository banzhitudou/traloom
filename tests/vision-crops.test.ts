import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { renderVisionCrops } from '../src/renderer/src/lib/vision-crops'

afterEach(() => vi.unstubAllGlobals())
function fixture(fail=false) {
  const captured: Record<string,unknown>[] = []
  const context = {fillRect:vi.fn(),translate:vi.fn(),rotate:vi.fn(),drawImage:vi.fn()}
  const canvases: {width:number;height:number}[] = []
  vi.stubGlobal('document',{createElement:() => {
    const canvas = {width:0,height:0,getContext:() => context,toDataURL:() => {captured.push({width:canvas.width,height:canvas.height});return 'data:image/png;base64,YWJj'}}
    canvases.push(canvas); return canvas
  }})
  const render = vi.fn(() => ({promise:fail ? Promise.reject(new Error('render failed')) : Promise.resolve()}))
  const pdf = {getPage:async () => ({getViewport:({scale}:{scale:number}) => ({width:1000*scale,height:2000*scale}),render})} as unknown as PDFDocumentProxy
  return {pdf,render,captured,context,canvases}
}
describe('vision region rendering',() => {
  it('renders a small region directly at high resolution',async () => {
    const f=fixture(), box={left:.2,top:.3,width:.1,height:.02}
    expect(await renderVisionCrops(f.pdf,1,[box])).toEqual([{box,dataUrl:'data:image/png;base64,YWJj'}])
    expect(f.captured).toEqual([{width:600,height:240}])
    expect(f.render.mock.calls[0][0]).toMatchObject({transform:[1,0,0,1,-1200,-3600]})
    expect(f.canvases.every(canvas=>canvas.width===0 && canvas.height===0)).toBe(true)
  })
  it('caps large regions and supports rotated crops',async () => {
    const f=fixture()
    await renderVisionCrops(f.pdf,1,[{left:0,top:0,width:1,height:1}],90)
    expect(f.captured).toEqual([{width:2200,height:1100}])
    expect(f.context.rotate).toHaveBeenCalledWith(Math.PI/2)
  })
  it('rejects invalid regions and releases failed render canvases',async () => {
    const f=fixture(true)
    await expect(renderVisionCrops(f.pdf,1,[{left:0,top:0,width:0,height:1}])).rejects.toThrow('区域无效')
    await expect(renderVisionCrops(f.pdf,1,[{left:0,top:0,width:1,height:1}])).rejects.toThrow('render failed')
    expect(f.canvases.every(canvas=>canvas.width===0)).toBe(true)
  })
})
