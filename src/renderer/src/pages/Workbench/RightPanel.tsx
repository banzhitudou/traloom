import { useState } from 'react'
import type { Paragraph } from '@shared/types'
import GlossaryPanel from './GlossaryPanel'
import NotesPanel from './NotesPanel'
import RevisionPanel from './RevisionPanel'

interface Props {
  paragraph: Paragraph | null
  activeTab: RightPanelTab
  onSelectParagraph?: (id: number) => void
  onProjectChanged?: () => void
  onBeforeRestore?: () => Promise<void>
}
export type RightPanelTab = 'glossary' | 'records'

export default function RightPanel({ paragraph, activeTab, onSelectParagraph, onProjectChanged, onBeforeRestore }: Props) {
  const [mode, setMode] = useState<'notes' | 'revisions'>('notes')
  return <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
    {activeTab === 'glossary' ? <GlossaryPanel onSelectParagraph={onSelectParagraph} onProjectChanged={onProjectChanged} /> : <>
      <div className="mb-2 flex shrink-0 gap-1 border-b text-xs">
        <button type="button" aria-pressed={mode === 'notes'} onClick={() => setMode('notes')} className={`px-3 py-2 ${mode === 'notes' ? 'border-b-2 border-blue-600 text-blue-700' : ''}`}>备注</button>
        <button type="button" aria-pressed={mode === 'revisions'} onClick={() => setMode('revisions')} className={`px-3 py-2 ${mode === 'revisions' ? 'border-b-2 border-blue-600 text-blue-700' : ''}`}>修订记录</button>
      </div>
      {mode === 'notes' ? <NotesPanel active currentId={paragraph?.id ?? null} onSelectParagraph={onSelectParagraph} /> : <RevisionPanel active onBeforeRestore={onBeforeRestore} onChanged={onProjectChanged} onSelectParagraph={onSelectParagraph} />}
    </>}
  </div>
}
