import { createRoot } from 'react-dom/client'
import VisionPageRecognition from '../src/renderer/src/pages/Workbench/VisionPageRecognition'

createRoot(document.getElementById('root')!).render(<VisionPageRecognition onClose={()=>{document.getElementById('root')!.textContent='整页识别已关闭'}} onChanged={async()=>{}} onSettings={()=>{document.getElementById('root')!.textContent='模型配置已打开'}}/>)
