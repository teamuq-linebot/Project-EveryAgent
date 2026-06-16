/**
 * electronApp fixture — 啟動 E2E 專用 Electron app（tests/e2e/fixtures/e2eMain.cjs），
 * 跑「真實 preload + 真實 renderer + 假 IPC 後端」。
 *
 * 為什麼不直接跑 out/main/index.js：見 e2eMain.cjs 檔頭說明（外部相依切斷 + ABI blocker
 * 規避 + contextBridge window.tuq 凍結無法從 page 覆蓋）。
 *
 * 切面：
 *   - 真 preload（out/preload/index.js）→ renderer 拿到真正的 contextBridge window.tuq。
 *   - 真 renderer bundle（out/renderer/index.html）→ 驗真實 UI 元件鏈。
 *   - 假 main IPC handler（e2eMain.cjs）→ 固定 fixture，確定性可重跑。
 *
 * 前提：先 `npm run build`（產 out/preload + out/renderer）。
 *   不需要 better-sqlite3 / node-pty 可載入（e2eMain 不碰真實 backend）。
 */
import { test as base, _electron as electron, type Page } from '@playwright/test'
import { resolve } from 'path'

const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const E2E_MAIN = resolve(REPO_ROOT, 'tests', 'e2e', 'fixtures', 'e2eMain.cjs')

export const test = base.extend<{ win: Page }>({
  // eslint-disable-next-line no-empty-pattern
  win: async ({}, use) => {
    const app = await electron.launch({
      args: [E2E_MAIN],
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_ENV: 'production' },
    })
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    // 等 React 掛載出 app shell（renderer bundle 解析 + 首渲染）。
    await win.locator('.app-shell').waitFor({ state: 'visible', timeout: 20_000 })
    await use(win)
    await app.close()
  },
})

export const expect = test.expect
