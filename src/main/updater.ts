/**
 * updater.ts — electron-updater 自動更新封裝
 *
 * 只在「打包後生產環境」啟動；dev / test 環境不跑，避免雜訊。
 * 呼叫點：src/main/index.ts，app.whenReady() 後（非 dev）。
 *
 * env gate：
 *   - ELECTRON_RENDERER_URL 存在 → dev server → 跳過
 *   - app.isPackaged === false → 跳過
 *
 * 使用方式：
 *   import { initAutoUpdater } from './updater'
 *   initAutoUpdater()
 */

import { autoUpdater } from 'electron-updater'
import { app, dialog } from 'electron'

export function initAutoUpdater(): void {
  // dev 環境：ELECTRON_RENDERER_URL 由 electron-vite 注入
  if (process.env['ELECTRON_RENDERER_URL']) return
  // 未打包（npx electron . 直接跑 src）也跳過
  if (!app.isPackaged) return

  // 靜默背景檢查：有更新時僅發通知，不強制打斷使用者
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] update available: ${info.version}`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] update downloaded: ${info.version}`)
    // 下載完畢後提示使用者重啟；非強制
    dialog
      .showMessageBox({
        type: 'info',
        title: 'TeamUQ 有新版本',
        message: `版本 ${info.version} 已下載完成，重新啟動後生效。`,
        buttons: ['立即重啟', '稍後'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err.message)
  })

  // 非同步檢查，不阻塞主程序啟動
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] checkForUpdatesAndNotify failed:', err.message)
  })
}
