const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(process.execPath, [resolve(__dirname, '../node_modules/electron-vite/bin/electron-vite.js'), ...process.argv.slice(2)], {
  env,
  stdio: 'inherit'
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
