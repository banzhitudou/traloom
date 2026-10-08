const { dirname, resolve } = require('path')
const { spawn, spawnSync } = require('child_process')

const projectRoot = resolve(__dirname, '..')
const electronBinary = require('electron')
const electronApp = resolve(dirname(electronBinary), '../..')

// Keep one workbench window. Ignore the exit code when no older process exists.
spawnSync('pkill', ['-f', `${projectRoot}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`], {
  stdio: 'ignore'
})

const launcher = spawn('/usr/bin/open', ['-na', electronApp, '--args', projectRoot], {
  detached: true,
  stdio: 'ignore'
})
launcher.unref()
