import {describe,it,expect} from 'vitest'
import {alignVisionPageBounds} from '../src/shared/vision-layout'
import type {VisionPageBlock} from '../src/shared/vision-page'
const block:VisionPageBlock={text:'省エネ性 2.36 kW',type:'paragraph',box:{left:.1,top:.2,width:.3,height:.04}}
describe('conservative PDF geometry alignment',()=>{
  it('unions matched fragments including the final line, preserving text and order',()=>{
    const anchors=[{text:'省エネ性',box:{left:.11,top:.21,width:.12,height:.02}},{text:'2.36 kW',box:{left:.11,top:.235,width:.2,height:.02}}]
    const result=alignVisionPageBounds([block],anchors)
    expect(result.aligned).toBe(1);expect(result.blocks[0].text).toBe(block.text)
    expect(result.blocks[0].box.top+result.blocks[0].box.height).toBeCloseTo(.256)
    expect(block.box.top).toBe(.2)
  })
  it('ignores missing, garbled, distant and partial text layers',()=>{
    for(const anchors of [[],[{text:'省エネ性',box:block.box}],[{text:block.text,box:{...block.box,top:.7}}],[{text:'garbled',box:block.box}]])expect(alignVisionPageBounds([block],anchors)).toEqual({blocks:[block],aligned:0})
  })
  it('uses nearest duplicate anchor without combining unrelated repeated labels',()=>{
    const b={...block,text:'waybee',box:{left:.2,top:.2,width:.1,height:.02}}
    const result=alignVisionPageBounds([b],[{text:'waybee',box:{left:.23,top:.2,width:.09,height:.018}},{text:'waybee',box:{left:.19,top:.2,width:.09,height:.018}}])
    expect(result.blocks[0].box.width).toBeCloseTo(.092)
  })
  it('matches Unicode-width and subscript variants without rewriting source',()=>{
    const b={...block,text:'ＣＯ₂ 2.36 kW'}
    expect(alignVisionPageBounds([b],[{text:'CO2 2.36 kW',box:{...block.box,left:.11}}]).blocks[0].text).toBe(b.text)
  })
  it('does not remove a sign or decimal to force a false match',()=>{
    expect(alignVisionPageBounds([{...block,text:'-2.36kW'}],[{text:'236kW',box:block.box}]).aligned).toBe(0)
  })
  it('does not trim an unmatched final character from a long paragraph',()=>{
    const b={...block,text:'a'.repeat(100)+'Z'}
    expect(alignVisionPageBounds([b],[{text:'a'.repeat(100),box:block.box}]).aligned).toBe(0)
  })
})
