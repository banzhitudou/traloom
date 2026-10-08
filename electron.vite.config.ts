import { readFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const devNonce = randomBytes(18).toString('base64')

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      {
        name: 'copy-main-assets',
        generateBundle() {
          const assets = [
            ['src/main/db/schema.sql', 'chunks/schema.sql'],
            ['src/main/assets/ecdict-core.json', 'chunks/ecdict-core.json'],
            ['src/main/assets/ECDICT-LICENSE.md', 'chunks/ECDICT-LICENSE.md']
          ] as const
          for (const [sourcePath, outputPath] of assets) {
            this.emitFile({
              type: 'asset',
              fileName: outputPath,
              source: readFileSync(resolve(__dirname, sourcePath))
            })
          }
        }
      }
    ],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/preload.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    html: { cspNonce: devNonce },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react(), {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          return html.replace("script-src 'self'", `script-src 'self' 'nonce-${devNonce}'`)
            .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
        }
      }
    }]
  }
})
