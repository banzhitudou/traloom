import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '@renderer/lib/ipc'
import type { RecentProject } from '@shared/ipc-api'

interface Props {
  hasOpenProject: boolean
  onCurrentRemoved: () => void
  onContinue: () => void
  onOpenProject: () => void
  onNewProject: () => void
}

function formatOpenedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

/** 启动首页：明确区分继续工作、打开已有项目和新建项目。 */
export default function ProjectHome({ hasOpenProject, onCurrentRemoved, onContinue, onOpenProject, onNewProject }: Props) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [currentMeta, setCurrentMeta] = useState<Record<string, string>>({})
  const [currentPath, setCurrentPath] = useState('')
  const [busyPath, setBusyPath] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    const recent = await api.listRecentProjects()
    setRecentProjects(recent)
    if (hasOpenProject) {
      const [meta, files] = await Promise.all([api.getProjectMeta(), api.getProjectFiles()])
      setCurrentMeta(meta)
      setCurrentPath(files.projectPath)
    } else { setCurrentMeta({}); setCurrentPath('') }
  }

  useEffect(() => {
    void refresh()
  }, [hasOpenProject])

  const openRecent = async (project: RecentProject) => {
    if (!project.exists || busyPath) return
    setBusyPath(project.path)
    setError('')
    const result = await api.openProject(project.path)
    setBusyPath('')
    if (!result.ok) {
      setError(result.error ?? '项目打开失败')
      return
    }
    onOpenProject()
  }

  const openExisting = async () => {
    const filePath = await api.pickFile({
      title: '打开已有翻译项目',
      filters: [{ name: 'Traloom 翻译工程', extensions: ['twproj'] }]
    })
    if (!filePath) return
    setBusyPath(filePath)
    setError('')
    const result = await api.openProject(filePath)
    setBusyPath('')
    if (!result.ok) {
      setError(result.error ?? '项目打开失败')
      return
    }
    onOpenProject()
  }

  const forgetRecent = async (filePath: string) => {
    await api.forgetRecentProject(filePath)
    await refresh()
  }

  const removeCurrent = async () => {
    if (busyPath) return
    setBusyPath(currentPath || 'current'); setError('')
    try {
      const result = await api.removeCurrentProject()
      if (!result.ok) throw new Error(result.error || '项目移除失败')
      setCurrentMeta({}); setCurrentPath('')
      setRecentProjects(await api.listRecentProjects())
      onCurrentRemoved()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusyPath('') }
  }

  const currentTitle = currentMeta.book_title || recentProjects[0]?.title || '上次打开的项目'
  const otherRecent = recentProjects.filter((project) => project.path !== currentPath)

  return (
    <div className="h-screen overflow-y-auto bg-neutral-100">
      <main className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-8 py-12">
        <header className="mb-8 flex items-center justify-between border-b border-neutral-300 pb-5">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">Traloom</h1>
            <p className="mt-1 text-sm text-neutral-500">选择一个项目继续工作</p>
          </div>
          <button
            type="button"
            onClick={onNewProject}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            + 新建项目
          </button>
        </header>

        {hasOpenProject && (
          <section className="mb-8 border border-blue-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-5">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-blue-600">当前项目</div>
                <h2 className="mt-1 truncate text-lg font-medium text-neutral-900">{currentTitle}</h2>
                <p className="mt-1 truncate text-xs text-neutral-400" title={currentPath}>{currentPath}</p>
              </div>
              <button
                type="button"
                onClick={onContinue}
                disabled={Boolean(busyPath)}
                className="shrink-0 rounded bg-blue-600 px-5 py-2 text-sm text-white hover:bg-blue-700"
              >
                继续翻译 →
              </button>
              <button
                type="button"
                onClick={() => void removeCurrent()}
                disabled={Boolean(busyPath) || !currentPath}
                title="移除当前项目，不删除工程文件；以后可重新打开"
                aria-label="移除当前项目"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
              ><X size={16} /></button>
            </div>
          </section>
        )}

        <section className="min-h-0 bg-white px-5 py-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b pb-3">
            <h2 className="text-sm font-medium text-neutral-800">最近项目</h2>
            <button type="button" onClick={() => void openExisting()} className="rounded border px-3 py-1.5 text-xs hover:bg-neutral-50">
              打开项目文件
            </button>
          </div>

          {otherRecent.length === 0 ? (
            <div className="py-10 text-center text-sm text-neutral-400">暂无其他最近项目</div>
          ) : (
            <div className="divide-y">
              {otherRecent.slice(0, 10).map((project) => (
                <div key={project.path} className="flex items-center gap-3 py-3">
                  <button
                    type="button"
                    onClick={() => void openRecent(project)}
                    disabled={!project.exists || Boolean(busyPath)}
                    className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-neutral-700">{project.title}</span>
                      <span className="shrink-0 text-[11px] text-neutral-400">{formatOpenedAt(project.lastOpenedAt)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-neutral-400">{project.exists ? project.path : `文件已移动：${project.path}`}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void forgetRecent(project.path)}
                    title="从最近项目移除，不删除项目文件"
                    aria-label="从最近项目移除"
                    disabled={Boolean(busyPath)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {error && <div className="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      </main>
    </div>
  )
}
