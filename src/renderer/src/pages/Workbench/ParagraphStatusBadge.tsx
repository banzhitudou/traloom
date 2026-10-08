import { Check, Circle, TriangleAlert } from 'lucide-react'
import type { ParaStatus } from '@shared/types'

export default function ParagraphStatusBadge({ status }: { status: ParaStatus }) {
  const style = status === 'done' ? 'bg-emerald-100 text-emerald-800' : status === 'review' ? 'bg-orange-100 text-orange-800' : status === 'doing' ? 'bg-blue-100 text-blue-800' : 'bg-neutral-100 text-neutral-600'
  const Icon = status === 'done' ? Check : status === 'review' ? TriangleAlert : Circle
  return <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${style}`}><Icon size={12} />{status === 'done' ? '通过' : status === 'review' ? '存疑' : status === 'doing' ? '待审' : '待译'}</span>
}
