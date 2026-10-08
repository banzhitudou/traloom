import { app, shell, BrowserWindow, screen } from 'electron'
import { fitWindowToWorkArea } from './window-bounds'
import { registerOcrResources } from './ocr-resources'
import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'

// 注意：不要在模块顶层读取 app.isPackaged / app.xxx。
// Electron 33 在某些加载路径下，主进程模块求值时 app 尚未初始化，
// 顶层访问会触发 "Cannot read properties of undefined (reading 'isPackaged')"。
// 所有对 app 的使用都推迟到 whenReady() 回调内。

function writeLifecycleLog(message: string): void {
  try {
    const logDirectory = join(app.getPath('userData'), 'logs')
    mkdirSync(logDirectory, { recursive: true })
    appendFileSync(
      join(logDirectory, 'workbench.log'),
      `${new Date().toISOString()} ${message}\n`,
      'utf-8'
    )
  } catch {
    // 日志失败不能影响工作台启动。
  }
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'Traloom',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = window

  let boundaryTimer: ReturnType<typeof setTimeout> | undefined
  const fitDisplay = (restorePosition = false) => {
    if (window.isDestroyed() || window.isFullScreen() || window.isMinimized()) return
    const bounds = window.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const area = display.workArea
    window.setMinimumSize(Math.min(1100, area.width), Math.min(700, area.height))
    const fitted = fitWindowToWorkArea(bounds, area)
    // Cross-screen movement must keep the user's chosen position, including straddling screens.
    if (!restorePosition) {
      fitted.x = bounds.x
      fitted.y = bounds.y
    }
    if (Object.keys(fitted).some(key => fitted[key as keyof typeof fitted] !== bounds[key as keyof typeof bounds])) {
      window.setBounds(fitted)
      writeLifecycleLog(`window-fit display=${display.id} workArea=${JSON.stringify(area)} bounds=${JSON.stringify(fitted)}`)
    }
  }
  const scheduleFit = () => {
    clearTimeout(boundaryTimer)
    boundaryTimer = setTimeout(() => fitDisplay(), 600)
  }
  const onDisplayMetricsChanged = () => scheduleFit()
  window.on('move', scheduleFit)
  window.on('resize', scheduleFit)
  window.on('leave-full-screen', scheduleFit)
  screen.on('display-metrics-changed', onDisplayMetricsChanged)
  screen.on('display-removed', onDisplayMetricsChanged)
  fitDisplay(true)

  window.on('ready-to-show', () => {
    writeLifecycleLog('main-window ready-to-show')
    window.show()
  })

  window.on('closed', () => {
    clearTimeout(boundaryTimer)
    screen.removeListener('display-metrics-changed', onDisplayMetricsChanged)
    screen.removeListener('display-removed', onDisplayMetricsChanged)
    writeLifecycleLog('main-window closed')
    if (mainWindow === window) mainWindow = null
  })
  window.on('unresponsive', () => writeLifecycleLog('main-window unresponsive'))
  window.webContents.on('render-process-gone', (_event, details) => {
    writeLifecycleLog(`renderer-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发环境加载 dev server，生产加载打包文件
  const isDev = !app.isPackaged
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  app.setName('Traloom')
  registerOcrResources()
  // Development builds keep their recent projects separate from the installed app.
  app.setPath('userData', join(app.getPath('appData'), app.isPackaged ? 'translation-workbench' : 'translation-workbench-dev'))
  writeLifecycleLog(`app-ready packaged=${app.isPackaged}`)

  if (!app.requestSingleInstanceLock()) {
    writeLifecycleLog('second-instance rejected')
    app.quit()
    return
  }

  app.on('second-instance', () => {
    if (!mainWindow) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  // macOS/Windows 任务栏应用名
  if (process.platform === 'win32') {
    app.setAppUserModelId(!app.isPackaged ? process.execPath : 'com.yutian.translationworkbench')
  }

  // 注册 IPC handlers（各模块）
  const { registerAll } = await import('./ipc')
  await registerAll()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  writeLifecycleLog('window-all-closed')
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => writeLifecycleLog('before-quit'))
