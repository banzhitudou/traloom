import { useEffect, useState } from 'react'
import ProjectWizard from './pages/ProjectWizard'
import Workbench from './pages/Workbench'
import Settings from './pages/Settings'
import ProjectHome from './pages/ProjectHome'
import { api } from '@renderer/lib/ipc'

/** 简易路由（MVP 不引入 react-router，状态切换即可） */
type Route = 'home' | 'wizard' | 'workbench' | 'settings'

export default function App() {
  const [route, setRoute] = useState<Route>('home')
  const [restoring, setRestoring] = useState(true)
  const [hasOpenProject, setHasOpenProject] = useState(false)

  useEffect(() => {
    api.restoreLastProject()
      .then((result) => {
        if (result.ok && result.restored) {
          setHasOpenProject(true)
        }
      })
      .finally(() => setRestoring(false))
  }, [])

  if (restoring) {
    return <div className="flex h-screen items-center justify-center bg-neutral-50 text-sm text-neutral-500">正在准备项目首页...</div>
  }

  switch (route) {
    case 'home':
      return (
        <ProjectHome
          hasOpenProject={hasOpenProject}
          onCurrentRemoved={() => setHasOpenProject(false)}
          onContinue={() => setRoute('workbench')}
          onOpenProject={() => {
            setHasOpenProject(true)
            setRoute('workbench')
          }}
          onNewProject={() => setRoute('wizard')}
        />
      )
    case 'wizard':
      return (
        <ProjectWizard
          onNext={() => {
            setHasOpenProject(true)
            setRoute('workbench')
          }}
          onBack={() => setRoute('home')}
        />
      )
    case 'workbench':
      return (
        <Workbench
          onOpenSettings={() => setRoute('settings')}
          onManageProjects={() => setRoute('home')}
        />
      )
    case 'settings':
      return <Settings onBack={() => setRoute('workbench')} />
  }
}
