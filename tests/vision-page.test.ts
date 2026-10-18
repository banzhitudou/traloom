import { describe,expect,it } from 'vitest'
import { VISION_PAGE_PROMPT,parseVisionPage,validateVisionPageBlocks,visionPageWarnings } from '../src/shared/vision-page'

const block={text:'省エネ性 2.36 kW',bbox:[100,200,500,300],type:'paragraph'}
describe('whole-page transcription and layout',()=>{
  it('specifies hierarchical panel order, distinct labels and complete multi-line bounds',()=>{
    for(const rule of ['版面层级','产品比较按每件产品','最后一行和行尾','原始整张图片','必须分块','顶部的栏目名不能误标为页脚'])expect(VISION_PAGE_PROMPT).toContain(rule)
  })
  it('preserves source text, region coordinates and declared reading order',()=>{
    const result=parseVisionPage(JSON.stringify({blocks:[{...block,text:'縦の右列',bbox:[800,100,900,800]}, {...block,text:'縦の左列',bbox:[600,100,700,800]}]}))
    expect(result.map(b=>b.text)).toEqual(['縦の右列','縦の左列'])
    expect(result[0].box).toEqual({left:.8,top:.1,width:.1,height:.7})
    expect(parseVisionPage('```json\n'+JSON.stringify({blocks:[block]})+'\n```')[0].text).toBe(block.text)
  })
  it('rejects absent, truncated, malformed and out-of-page regions',()=>{
    for(const value of ['{}','{"blocks":[','not JSON',JSON.stringify({blocks:[{...block,bbox:[0,0,1001,100]}]}),JSON.stringify({blocks:[{...block,bbox:[500,200,100,300]}]}),JSON.stringify({blocks:[{...block,bbox:['100',200,500,300]}]}),JSON.stringify({blocks:[{...block,type:'invented'}]})]) expect(()=>parseVisionPage(value)).toThrow()
  })
  it('requires real coordinates, nonempty text and bounded block counts',()=>{
    expect(()=>validateVisionPageBlocks([{text:'x',type:'paragraph',box:{left:0,top:0,width:undefined,height:1}}])).toThrow()
    expect(()=>validateVisionPageBlocks(Array(501).fill({}))).toThrow()
    expect(()=>parseVisionPage(JSON.stringify({blocks:[{...block,text:''}]}))).toThrow()
  })
  it('accepts explicit empty-page candidates but warns for human confirmation',()=>{
    expect(parseVisionPage('{"blocks":[]}')).toEqual([])
    expect(visionPageWarnings([])[0]).toContain('无文字')
  })
  it('warns about overlapping blocks, tables and unreadable text',()=>{
    const blocks=parseVisionPage(JSON.stringify({blocks:[block,{...block,type:'table',text:'［无法辨认］'}]}))
    expect(visionPageWarnings(blocks)).toHaveLength(3)
  })
})
