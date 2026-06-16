/**
 * rebuild-test-abi.mjs — 重生 `.abi-node-bsq3/`（測試用 Node-ABI 版 better-sqlite3）。
 *
 * 背景（ABI escape hatch）：
 *   app 的 `node_modules/better-sqlite3` 是為 **Electron ABI** 編譯（`electron-builder
 *   install-app-deps` / `npm run rebuild:electron`），app 才跑得起來。但 vitest 跑在
 *   **系統 Node**（不同 NODE_MODULE_VERSION），需要 **Node-ABI** 版的 `.node`。
 *   平常切換靠 `npm run rebuild:node` ↔ `rebuild:electron` 二選一原地重編。但當
 *   Electron 開發實例正在執行、佔住 `node_modules/better-sqlite3/build/.../better_sqlite3.node`
 *   時，原地 `npm rebuild` 會失敗（檔案被鎖）。
 *
 *   逃生艙（vitest.config.ts BSQ3_NODE_ABI=1 別名）：把 better-sqlite3 別名到一份
 *   **獨立、預先以 Node-ABI 編好**的拷貝 `.abi-node-bsq3/better-sqlite3`。設了
 *   `BSQ3_NODE_ABI=1` → vitest 用這份 Node-ABI 拷貝跑 SQLite 測試，**完全不碰**
 *   `node_modules`（app 的 Electron-ABI binding 原封不動，dev 實例可同時開著）。
 *   不設此 env → vitest 行為與原本完全相同（直接吃 node_modules，user 正常 flow 零影響）。
 *
 * 本腳本做什麼（重生 `.abi-node-bsq3/`）：
 *   1. 從 `node_modules/better-sqlite3` 複製整包到 `.abi-node-bsq3/better-sqlite3`
 *      （含 lib/、deps/、src/、package.json、binding.gyp）。
 *   2. 刪掉拷貝裡可能殘留的 build 產物（避免帶到 Electron-ABI 的 .node）。
 *   3. 在拷貝目錄內、用**目前這支系統 Node** 跑 `prebuild-install`：它依執行期 ABI
 *      下載對應的預編譯 binary → 落在 `build/Release/better_sqlite3.node`（即 Node-ABI 版）。
 *   4. 載入測試確認該 `.node` 在系統 Node 下可開（new Database(':memory:')）。
 *
 * 用法：
 *   node .claude/scripts/rebuild-test-abi.mjs
 *   （或 package.json script：`npm run rebuild:test-abi`）
 *   完成後即可：`BSQ3_NODE_ABI=1 npx vitest run --pool=forks`（SQLite 測試全綠）。
 *
 * 注意：
 *   - `.abi-node-bsq3/` 已列入 .gitignore（產物，不入版控；換機/重裝後跑本腳本重生）。
 *   - 若 prebuild-install 無對應 ABI 的 prebuilt（極新 Node），會 fallback `node-gyp rebuild`，
 *     需本機具備編譯工具鏈（Windows: VS Build Tools；不裝則維持舊拷貝、報錯退出）。
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = process.cwd()
const SRC_PKG = path.join(ROOT, 'node_modules', 'better-sqlite3')
const DEST_ROOT = path.join(ROOT, '.abi-node-bsq3')
const DEST_PKG = path.join(DEST_ROOT, 'better-sqlite3')

function log(msg) {
  console.log(`[rebuild-test-abi] ${msg}`)
}

function fail(msg) {
  console.error(`[rebuild-test-abi] ERROR: ${msg}`)
  process.exit(1)
}

// --- 0. 前置檢查 ----------------------------------------------------------
if (!fs.existsSync(SRC_PKG)) {
  fail(`找不到來源套件 ${SRC_PKG}（先 npm install）。`)
}
log(`系統 Node ${process.version}（ABI ${process.versions.modules}）`)

const srcVersion = JSON.parse(
  fs.readFileSync(path.join(SRC_PKG, 'package.json'), 'utf-8'),
).version
log(`來源 better-sqlite3 版本：${srcVersion}`)

// --- 1. 清掉舊拷貝、整包複製 ----------------------------------------------
log(`清除舊拷貝 ${DEST_PKG} …`)
fs.rmSync(DEST_PKG, { recursive: true, force: true })
fs.mkdirSync(DEST_ROOT, { recursive: true })

log('複製套件樹（node_modules → .abi-node-bsq3）…')
// 排除 node_modules（巢狀依賴；prebuild-install 由本套件的 bin 跑，不需內層 deps），
// 其餘 lib/deps/src/package.json/binding.gyp 全帶上。
fs.cpSync(SRC_PKG, DEST_PKG, {
  recursive: true,
  filter: (s) => path.basename(s) !== 'node_modules',
})

// --- 2. 刪掉拷貝內可能殘留的 build 產物（可能是 Electron-ABI 的 .node）-------
const destBuild = path.join(DEST_PKG, 'build')
if (fs.existsSync(destBuild)) {
  log('刪除拷貝內既有 build/ 產物（避免帶到 Electron-ABI binary）…')
  fs.rmSync(destBuild, { recursive: true, force: true })
}

// --- 3. 在拷貝目錄內、用系統 Node 跑 prebuild-install（取 Node-ABI binary）----
// prebuild-install 的 bin 由 better-sqlite3 的相依提供；用 require.resolve 取其入口，
// 確保用「本專案 node_modules 內」的 prebuild-install，且以系統 Node 執行（= 取本 ABI）。
const req = createRequire(path.join(SRC_PKG, 'package.json'))
let prebuildInstallBin
try {
  prebuildInstallBin = req.resolve('prebuild-install/bin.js')
} catch {
  fail('找不到 prebuild-install（better-sqlite3 的相依，應隨 npm install 一併裝上）。')
}

log('prebuild-install（依目前系統 Node ABI 取預編譯 binary）…')
try {
  execFileSync(process.execPath, [prebuildInstallBin, '--tag-prefix', 'v'], {
    cwd: DEST_PKG,
    stdio: 'inherit',
  })
} catch (err) {
  // prebuild-install 失敗（無對應 prebuilt 或網路）→ 嘗試 node-gyp 本地編譯。
  log(`prebuild-install 失敗（${err?.message ?? err}）→ 改試 node-gyp rebuild …`)
  try {
    execFileSync('npx', ['--yes', 'node-gyp', 'rebuild', '--release'], {
      cwd: DEST_PKG,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
  } catch (err2) {
    fail(
      `prebuild-install 與 node-gyp rebuild 皆失敗。需網路取 prebuilt 或本機編譯工具鏈。\n` +
        `  node-gyp 錯誤：${err2?.message ?? err2}`,
    )
  }
}

// --- 4. 載入測試（系統 Node 下可開即成功）---------------------------------
const builtNode = path.join(DEST_PKG, 'build', 'Release', 'better_sqlite3.node')
if (!fs.existsSync(builtNode)) {
  fail(`編譯後找不到 ${builtNode}。`)
}
log(`驗證載入 ${path.relative(ROOT, builtNode)} …`)
try {
  const reqDest = createRequire(path.join(DEST_PKG, 'package.json'))
  const Database = reqDest('./lib/index.js')
  const db = new Database(':memory:')
  db.exec('CREATE TABLE t(x)')
  db.prepare('INSERT INTO t(x) VALUES (?)').run(1)
  const n = db.prepare('SELECT COUNT(*) AS c FROM t').get().c
  db.close()
  if (n !== 1) fail(`載入測試異常（count=${n}）。`)
} catch (err) {
  fail(`載入測試失敗：${err?.message ?? err}`)
}

log('完成 ✓  之後可跑：BSQ3_NODE_ABI=1 npx vitest run --pool=forks')
