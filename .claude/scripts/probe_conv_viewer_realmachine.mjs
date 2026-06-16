/**
 * probe_conv_viewer_realmachine.mjs — D25 真機切線實證（conversation viewer 路徑）。
 *
 * 目的：在**真機 ~/.teamuq**（不隔離 TEAMUQ_HOME）對著真實 claude session JSONL，跑
 *   ConversationStore 的實際程式路徑（與 app 同一份 conversationStore.ts，經 esbuild 編譯），
 *   驗證 D25 切線：
 *     - 舊 conversations.db（連 -wal/-shm）改名 .migrated.<日期>。
 *     - conv cache 寫進 ~/.teamuq/teamuq.db（schema_meta.parser_version 守門；不碰 user_version）。
 *     - viewer 路徑（getWindow / getSegments / getMessagesRange）不炸、回得到段與訊息。
 *     - teamuq.db 其他表（tasks/punches/...）完好。
 *
 * better-sqlite3：用 .abi-node-bsq3 的 **Node-ABI** 拷貝（系統 Node 可載），與 app 跑 Electron-ABI
 *   是不同 binary、相同 schema/同一 DB 檔；對「真機 DB 切線」的驗證等效（同一份 SQL 程式路徑）。
 *
 * 用法：node .claude/scripts/probe_conv_viewer_realmachine.mjs [sessionJsonlPath]
 *   省略路徑 → 自動挑 ~/.claude/projects 下第一個 >2KB 的 .jsonl。
 */
import { build } from 'esbuild'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const TEAMUQ_DIR = path.join(os.homedir(), '.teamuq')
const ABI_PKG = path.join(ROOT, '.abi-node-bsq3', 'better-sqlite3')

function log(m) {
  console.log(`[conv-probe] ${m}`)
}

// --- 0. 找 session jsonl ---------------------------------------------------
function findSession() {
  if (process.argv[2]) return process.argv[2]
  const projRoot = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(projRoot)) return null
  for (const p of fs.readdirSync(projRoot)) {
    const dir = path.join(projRoot, p)
    let kids
    try {
      if (!fs.statSync(dir).isDirectory()) continue
      kids = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const j of kids.filter((f) => f.endsWith('.jsonl'))) {
      const fp = path.join(dir, j)
      try {
        if (fs.statSync(fp).size > 2000) return fp
      } catch {
        /* skip */
      }
    }
  }
  return null
}

const sessionFile = findSession()
if (!sessionFile) {
  log('找不到 session jsonl，跳過（非失敗）。')
  process.exit(0)
}
log(`session: ${sessionFile} (${fs.statSync(sessionFile).size}B)`)

// --- 1. 切線前狀態 ---------------------------------------------------------
function listTeamuq() {
  try {
    return fs.readdirSync(TEAMUQ_DIR)
  } catch {
    return []
  }
}
const before = listTeamuq()
log(`BEFORE: conversations.db=${before.includes('conversations.db')} teamuq.db=${before.includes('teamuq.db')}`)

// --- 2. 編譯 conversationStore.ts（別名 better-sqlite3 → Node-ABI 拷貝）-------
const SRC = path.join(ROOT, 'src/main/services/conversationStore.ts')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convprobe-'))
const outFile = path.join(outDir, 'conversationStore.cjs')

// CJS 輸出（避免 ESM 下 esbuild 的 __require shim 對 better-sqlite3 內部 require('fs') 報錯）。
// better-sqlite3 **真正 external（不打包、不 alias）**：原生模組無法被 bundle（`bindings` 會
//   從 bundle 位置找不到 .node）。改在 runtime 用 Module._resolveFilename hook 把
//   `require('better-sqlite3')` 重導到 Node-ABI 拷貝（.abi-node-bsq3/better-sqlite3），
//   讓 `bindings` 從真實套件目錄定位 build/Release/better_sqlite3.node。
await build({
  entryPoints: [SRC],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
  external: ['better-sqlite3'],
  logLevel: 'silent',
})

const Module = (await import('node:module')).default
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'better-sqlite3') {
    return origResolve.call(this, path.join(ABI_PKG, 'lib', 'index.js'), ...rest)
  }
  return origResolve.call(this, request, ...rest)
}

const cjsReq = (await import('node:module')).createRequire(pathToFileURL(outFile).href)
const mod = cjsReq(outFile)
const { ConversationStore } = mod

// --- 3. 跑 viewer 路徑（真機 ~/.teamuq，不隔離）-----------------------------
let crashed = null
let result = {}
try {
  const store = new ConversationStore()
  // getWindow 內部走 getByFile（觸發 _ensureDb：退役舊檔 + 開 teamuq.db + 守門 + 寫 cache）。
  const win = store.getWindow(sessionFile)
  const segs = store.getSegments(sessionFile)
  let rangeOk = false
  if (segs.totalCount > 0) {
    const r = store.getMessagesRange(sessionFile, 0, Math.min(50, segs.totalCount - 1))
    rangeOk = Array.isArray(r)
  }
  result = {
    windowMsgs: win.messages.length,
    startSeq: win.startSeq,
    totalCount: win.totalCount,
    segCount: segs.segments.length,
    rangeOk,
  }
} catch (e) {
  crashed = e?.stack || String(e)
}

// --- 4. 切線後狀態 + teamuq.db 驗證 ----------------------------------------
const after = listTeamuq()
const migrated = after.filter((f) => f.startsWith('conversations.db') && f.includes('.migrated.'))

// 直接開 teamuq.db（Node-ABI 拷貝）查 conv cache 與其他表完好。
const reqDest = (await import('node:module')).createRequire(path.join(ABI_PKG, 'package.json'))
const Database = reqDest('./lib/index.js')
let dbCheck = {}
try {
  const db = new Database(path.join(TEAMUQ_DIR, 'teamuq.db'), { readonly: true })
  try {
    const tbl = (n) =>
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(n)?.name === n
    const cnt = (n) => {
      try {
        return db.prepare(`SELECT COUNT(*) AS c FROM ${n}`).get().c
      } catch {
        return 'N/A'
      }
    }
    const pv = db.prepare('SELECT value FROM schema_meta WHERE key=?').get('parser_version')?.value
    dbCheck = {
      conv_state: tbl('conv_state'),
      conv_segments: tbl('conv_segments'),
      conv_state_rows: cnt('conv_state'),
      conv_segments_rows: cnt('conv_segments'),
      parser_version: pv,
      tasks_table: tbl('tasks'),
      punches_table: tbl('punches'),
      secrets_table: tbl('secrets'),
      tasks_rows: cnt('tasks'),
      punches_rows: cnt('punches'),
    }
  } finally {
    db.close()
  }
} catch (e) {
  dbCheck = { error: String(e) }
}

// --- 5. 報告 --------------------------------------------------------------
log('=== RESULT ===')
log(`viewer crashed: ${crashed ? 'YES' : 'no'}`)
if (crashed) log(crashed)
log(`viewer result: ${JSON.stringify(result)}`)
log(`AFTER: conversations.db=${after.includes('conversations.db')} migrated=[${migrated.join(', ')}]`)
log(`teamuq.db check: ${JSON.stringify(dbCheck)}`)

try {
  fs.rmSync(outDir, { recursive: true, force: true })
} catch {
  /* ignore */
}

const pass =
  !crashed &&
  dbCheck.conv_state === true &&
  dbCheck.conv_segments === true &&
  dbCheck.tasks_table === true &&
  dbCheck.punches_table === true &&
  (result.totalCount ?? 0) > 0
log(pass ? 'PASS ✓' : 'FAIL ✗')
process.exit(pass ? 0 : 1)
