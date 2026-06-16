/**
 * fix-pty-perms.cjs — 確保 node-pty 的 `spawn-helper` 在 macOS 保有執行權限。
 *
 * 背景：node-pty 1.x 在 macOS 以一支原生小程式 `spawn-helper` 開 PTY。其 prebuild
 *   解壓後常被還原成 0644（無執行位），導致 `pty.spawn` 失敗、終端報
 *   `posix_spawnp failed`（posix_spawnp 執行該檔得到 EACCES）。Windows 走 conpty
 *   不受影響，故只需處理 darwin。
 *
 * 兩種用途（同一檔）：
 *   1. postinstall：直接執行 → 修 `node_modules` 內的 spawn-helper（dev 用，也是
 *      electron-builder 打包的來源）。
 *   2. electron-builder `afterPack` hook：module.exports → 再修打進 .app 的副本，
 *      防 builder 處理過程丟失權限（雙保險）。
 */
const fs = require('node:fs')
const path = require('node:path')

const MODE = 0o755

/** 對單一檔案補執行位；不存在 / 失敗則靜默（該 arch 在此平台沒有 prebuild 是正常的）。 */
function chmodIfPresent(file) {
  try {
    fs.chmodSync(file, MODE)
    console.log('[fix-pty-perms] chmod +x', file)
    return true
  } catch {
    return false
  }
}

/** 修 node_modules 內的 darwin prebuild spawn-helper。 */
function fixNodeModules(root) {
  const base = path.join(root, 'node_modules', 'node-pty', 'prebuilds')
  for (const arch of ['darwin-arm64', 'darwin-x64']) {
    chmodIfPresent(path.join(base, arch, 'spawn-helper'))
  }
}

/** 遞迴尋找並修打包目錄內所有名為 spawn-helper 的檔（路徑含 CJK app 名，故用遞迴而非寫死）。 */
function fixPackaged(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      fixPackaged(full)
    } else if (e.name === 'spawn-helper') {
      chmodIfPresent(full)
    }
  }
}

// electron-builder afterPack hook：context.appOutDir = 含 .app 的輸出目錄。
// （electron-builder 會 require 此檔並呼叫預設匯出的函式。）
module.exports = async function afterPack(context) {
  if (context && context.appOutDir) fixPackaged(context.appOutDir)
}

// 具名匯出供 postinstall 包裝腳本（build/postinstall.cjs）重用。
module.exports.fixNodeModules = fixNodeModules
module.exports.fixPackaged = fixPackaged

// 直接執行（node build/fix-pty-perms.cjs）：修 node_modules。
if (require.main === module) {
  fixNodeModules(process.cwd())
}
