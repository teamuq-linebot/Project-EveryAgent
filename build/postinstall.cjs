/**
 * postinstall.cjs — 跨平台（Windows / macOS / Linux）安裝後處理。
 *
 * 以單一 node 腳本取代 shell 串接（`&&` / `||` / `;` / `true` 在 cmd.exe 與 POSIX
 * sh 行為不一致，無法寫出兩平台都正確的一行命令）。本檔在任一平台跑法完全相同。
 *
 * 步驟：
 *   1. electron-builder install-app-deps —— 依當前 Electron ABI 重建原生模組
 *      （better-sqlite3 / node-pty）。失敗只警告不中斷（離線 / 無網路時容錯）。
 *   2. 補回 node-pty `spawn-helper` 的執行權限（僅 macOS 需要；Windows 走 conpty，
 *      chmod 對不存在的 darwin prebuild 會被靜默略過）。
 */
const { execSync } = require('node:child_process')
const { fixNodeModules } = require('./fix-pty-perms.cjs')

// 1) 重建原生模組（best-effort）。npm 生命週期腳本已把 node_modules/.bin 注入 PATH，
//    故 `electron-builder`（Windows 為 electron-builder.cmd）可被 execSync 解析。
try {
  execSync('electron-builder install-app-deps', { stdio: 'inherit' })
} catch (err) {
  console.warn('[postinstall] install-app-deps 失敗，繼續：', err && err.message)
}

// 2) 修 spawn-helper 執行權限（跨平台安全：非 macOS 無對應檔 → 靜默略過）。
fixNodeModules(process.cwd())
