import { createRoot } from 'react-dom/client'
import BatchProcessing from '../src/renderer/src/pages/Workbench/BatchProcessing'

createRoot(document.getElementById('root')!).render(<BatchProcessing total={7} onClose={() => { document.getElementById('root')!.textContent = '批量处理已关闭' }} onChanged={async () => {}} onOpenSettings={() => { document.getElementById('root')!.textContent = '模型配置已打开' }} />)
