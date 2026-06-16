import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty'],
        // scanWorker：監測掃描 worker_thread 入口（與 index 同目錄輸出 scanWorker.js）
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          scanWorker: resolve(__dirname, 'src/main/worktime/scanWorker.ts')
        }
      }
    }
  },
  preload: {
    // zod 必須 bundle 進 preload：sandbox preload 不能 require 外部 npm 模組，
    // externalize 會變成 require('zod') 而在 sandbox 載入失敗（window.tuq 注入不了）。
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })]
  },
  renderer: {
    plugins: [react()]
  }
})
