import type { RecognizedBlock } from './ipc-api'
import type { VisionPageBlock } from './vision-page'

const normalize=(text:string)=>text.normalize('NFKC').replace(/\s+/gu,'').toLowerCase()

/** Use nearby, text-matched PDF geometry only; never replace the model's text. */
export function alignVisionPageBounds(blocks:VisionPageBlock[],anchors:RecognizedBlock[]):{blocks:VisionPageBlock[];aligned:number} {
  let aligned=0
  const normalizedAnchors=anchors.map(anchor=>({anchor,text:normalize(anchor.text)}))
  const result=blocks.map(block=>{
    const target=normalize(block.text),box=block.box
    if(target.length<3)return block
    const nearby=normalizedAnchors.filter(({anchor,text})=>{
      const b=anchor.box
      return text.length>=2&&target.includes(text)&&b.left>=box.left-.06&&b.top>=box.top-.035&&b.left+b.width<=box.left+box.width+.06&&b.top+b.height<=box.top+box.height+.035
    }).sort((a,b)=>b.text.length-a.text.length || distance(a.anchor.box,box)-distance(b.anchor.box,box))
    const used=new Uint8Array(target.length),matched:RecognizedBlock[]=[]
    for(const {anchor,text} of nearby) {
      for(let start=target.indexOf(text);start>=0;start=target.indexOf(text,start+1)) {
        if(used.slice(start,start+text.length).some(Boolean))continue
        used.fill(1,start,start+text.length);matched.push(anchor);break
      }
    }
    if(!matched.length||!used[0]||!used[target.length-1]||used.reduce((sum,value)=>sum+value,0)/target.length<.95)return block
    const left=Math.min(...matched.map(a=>a.box.left)),top=Math.min(...matched.map(a=>a.box.top))
    const right=Math.max(...matched.map(a=>a.box.left+a.box.width)),bottom=Math.max(...matched.map(a=>a.box.top+a.box.height))
    const area=(right-left)*(bottom-top)/(box.width*box.height)
    // Reject coincidental matches and implausible expansion across neighbouring panels.
    if(area<.25||area>4||right-left>box.width+.08||bottom-top>box.height+.04)return block
    const padding=.001
    const refined={left:Math.max(0,left-padding),top:Math.max(0,top-padding),width:Math.min(1,right+padding)-Math.max(0,left-padding),height:Math.min(1,bottom+padding)-Math.max(0,top-padding)}
    if(distance(refined,box)<.0005&&Math.abs(refined.width-box.width)+Math.abs(refined.height-box.height)<.001)return block
    aligned++;return {...block,box:refined}
  })
  return {blocks:result,aligned}
}

function distance(a:RecognizedBlock['box'],b:RecognizedBlock['box']):number {
  return Math.hypot(a.left+a.width/2-b.left-b.width/2,a.top+a.height/2-b.top-b.height/2)
}
