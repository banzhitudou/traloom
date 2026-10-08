import { useEffect, useState } from 'react'
import { api } from '@renderer/lib/ipc'
import type { AlignResult } from '@shared/types'

interface Props {
  onDone: () => void
  onBack: () => void
}

/**
 * 译稿对齐预览表（两段式：相似度匹配 + AI 判定）。
 * 见《UI线框图》第 2 节。
 * 进入时自动跑相似度对齐，展示结果，译者核对后确认入库。
 */
export default function AlignPreview({ onDone, onBack }: Props) {
  const [results, setResults] = useState<AlignResult[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending'>('all')
  const [committing, setCommitting] = useState(false)
  const [committed, setCommitted] = useState(false)

  useEffect(() => {
    api.runSimilarityAlign().then((r) => {
      setResults(r)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50 text-neutral-500">
        ⏳ 正在解析译稿并对齐...
      </div>
    )
  }

  if (!results || results.length === 0) {
    // 无译稿，直接进入工作台
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-neutral-50">
        <p className="text-neutral-500">未检测到已有译稿，将直接开始翻译。</p>
        <button
          onClick={onDone}
          className="rounded bg-para-doing px-5 py-2 text-sm text-white hover:bg-blue-600"
        >
          开始翻译 →
        </button>
      </div>
    )
  }

  const pendingCount = results.filter((r) => r.status === 'pending').length
  const alignedCount = results.length - pendingCount
  const coverage =
    results.length > 0 ? Math.round((alignedCount / results.length) * 1000) / 10 : 0

  const shown = filter === 'pending' ? results.filter((r) => r.status === 'pending') : results

  const commit = async () => {
    setCommitting(true)
    const r = await api.commitAlign(results)
    setCommitting(false)
    if (r.ok) {
      setCommitted(true)
      setTimeout(onDone, 1000)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      <header className="border-b bg-white px-6 py-4">
        <h1 className="text-lg font-medium">译稿对齐预览</h1>
        <div className="mt-2 flex gap-6 text-sm">
          <span className="text-para-done">✅ 自动对齐 {alignedCount} 段</span>
          <span className={pendingCount > 0 ? 'text-para-review' : 'text-neutral-400'}>
            ⚠️ 待核对 {pendingCount} 段
          </span>
          <span className="text-neutral-500">覆盖率 {coverage}%</span>
        </div>
      </header>

      <div className="flex items-center gap-3 px-6 py-2 text-sm">
        <button
          onClick={() => setFilter('all')}
          className={`rounded px-3 py-1 text-xs ${filter === 'all' ? 'bg-para-doing text-white' : 'border hover:bg-neutral-50'}`}
        >
          全部 ({results.length})
        </button>
        <button
          onClick={() => setFilter('pending')}
          disabled={pendingCount === 0}
          className={`rounded px-3 py-1 text-xs ${
            filter === 'pending' ? 'bg-para-review text-white' : 'border hover:bg-neutral-50'
          } disabled:opacity-40`}
        >
          仅待核对 ({pendingCount})
        </button>
        <span className="ml-2 text-xs text-neutral-400">
          {pendingCount > 0 && 'AI 判定功能将在 S5 接入，目前请手动核对'}
        </span>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-4">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b text-left text-xs text-neutral-500">
              <th className="p-2 w-16">json#</th>
              <th className="p-2">英文(译稿)</th>
              <th className="p-2">英文(原书)</th>
              <th className="p-2 w-20">相似度</th>
              <th className="p-2">状态</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map((r, idx) => (
              <tr
                key={idx}
                className={`border-b ${r.status === 'pending' ? 'bg-red-50' : ''}`}
              >
                <td className="p-2 text-neutral-400">{r.jsonId > 0 ? r.jsonId : '-'}</td>
                <td className="p-2 text-neutral-700">{r.enMd.slice(0, 50) || '(空)'}</td>
                <td className="p-2 text-neutral-500">{r.enJson.slice(0, 50)}</td>
                <td className="p-2">{Math.round(r.similarity * 100)}%</td>
                <td className="p-2">
                  {r.status === 'aligned' ? (
                    <span className="text-para-done">✅ 已对齐</span>
                  ) : (
                    <span className="text-para-review">⚠️ 待核对</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > 500 && (
          <p className="py-3 text-center text-xs text-neutral-400">
            仅显示前 500 条（共 {shown.length} 条），确认入库将处理全部
          </p>
        )}
      </div>

      {committed && (
        <div className="border-t bg-green-50 px-6 py-2 text-sm text-green-700">
          ✅ 已入库，进入工作台...
        </div>
      )}

      <footer className="flex justify-end gap-2 border-t bg-white px-6 py-3">
        <button onClick={onBack} className="rounded border px-4 py-1.5 text-sm hover:bg-neutral-50">
          上一步
        </button>
        <button
          onClick={commit}
          disabled={committing || committed}
          className="rounded bg-para-doing px-4 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-40"
        >
          {committing ? '入库中...' : committed ? '已入库 ✓' : '确认入库，开始翻译 →'}
        </button>
      </footer>
    </div>
  )
}
