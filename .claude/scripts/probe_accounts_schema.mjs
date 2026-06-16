// probe_accounts_schema.mjs — B1.5 真機 schema 探針（非破壞性）。
//
// 目的：在隔離的臨時 TEAMUQ_HOME 下，用「與 app 啟動同一條」openTeamuqDb()/ensureSchema()
//   路徑開實檔 DB，驗證 accounts 表 + 2 索引被建立、欄位/型別正確、可重入（重開不報錯、
//   不動 user_version）。**完全不碰 live ~/.teamuq/teamuq.db**（吃臨時 HOME 隔離）。
//
// 為何不直接跑 run_dev_probe.mjs：B1.5 是純 repo 層（不接線），啟動全 Electron 只能間接證
//   ensureSchema 跑過；本探針直接驗 schema 結果，更精確、零鎖風險。
//
// 執行（Node ABI，繞過 package-name 解析直接吃 marker 的 Node-ABI 預編譯 binary）：
//   node --experimental-strip-types .claude/scripts/probe_accounts_schema.mjs
//   （ensureSchema(db) 接受注入連線；本探針自開 marker 的 better-sqlite3，避開 Electron-ABI 預設拷貝。）
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import process from 'node:process'

const home = mkdtempSync(join(tmpdir(), 'tuq-b15-probe-'))
const prev = process.env.TEAMUQ_HOME
process.env.TEAMUQ_HOME = home

const log = (m) => process.stdout.write(m + '\n')
let failed = false
const assert = (cond, msg) => {
  if (cond) log('  ok  ' + msg)
  else {
    failed = true
    log('  FAIL ' + msg)
  }
}

try {
  // Node-ABI better-sqlite3（marker 預編譯，ABI 137）— 繞過預設 Electron-ABI 拷貝。
  const Database = (await import('../../.abi-node-bsq3/better-sqlite3/lib/database.js')).default
  // ensureSchema / teamuqDbPath 走 repo 真實程式碼（同 app 啟動路徑的 schema 建立邏輯）。
  const { ensureSchema, teamuqDbPath } = await import(
    '../../src/main/repo/sqliteTaskRepository.ts'
  )

  // 1) 開實檔 DB（與 openTeamuqDb 同路徑/同 pragma），ensureSchema 建全部表（含 accounts）。
  const dbPath = teamuqDbPath()
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  ensureSchema(db)
  assert(existsSync(dbPath), 'live-path DB file created under temp HOME: ' + dbPath)

  // 2) accounts 表存在。
  const tbl = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
    .get()
  assert(!!tbl, "table 'accounts' exists")

  // 3) 欄位齊全 + cognito_sub NOT NULL + backend_user_id nullable（兩欄分離證據）。
  const cols = db.prepare('PRAGMA table_info(accounts)').all()
  const byName = Object.fromEntries(cols.map((c) => [c.name, c]))
  for (const c of [
    'account_local_id',
    'platform_local_id',
    'template_local_id',
    'cognito_sub',
    'backend_user_id',
    'email',
    'display_name',
    'avatar_url',
    'last_login_at',
    'created_at',
    'updated_at',
  ]) {
    assert(!!byName[c], 'column present: ' + c)
  }
  assert(byName['account_local_id'].pk === 1, 'account_local_id is PRIMARY KEY')
  assert(byName['cognito_sub'].notnull === 1, 'cognito_sub is NOT NULL')
  assert(byName['backend_user_id'].notnull === 0, 'backend_user_id is nullable (分離兩欄)')

  // 4) 2 索引存在。
  const idx = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='accounts'")
    .all()
    .map((r) => r.name)
  assert(idx.includes('idx_accounts_template'), 'index idx_accounts_template exists')
  assert(idx.includes('idx_accounts_backend_user'), 'index idx_accounts_backend_user exists')

  // 5) 可重入 + 不動 user_version：再開同檔（ensureSchema 重跑）不報錯、版本不變。
  const v1 = db.pragma('user_version', { simple: true })
  db.close()
  const db2 = new Database(dbPath)
  ensureSchema(db2) // 重入：CREATE IF NOT EXISTS 全程不報錯
  const v2 = db2.pragma('user_version', { simple: true })
  assert(v1 === v2, `user_version unchanged across re-open (${v1} === ${v2})`)
  db2.close()

  log(failed ? '\nPROBE RESULT: FAIL' : '\nPROBE RESULT: PASS (no error)')
} catch (e) {
  failed = true
  log('PROBE ERROR: ' + (e && e.stack ? e.stack : String(e)))
} finally {
  if (prev === undefined) delete process.env.TEAMUQ_HOME
  else process.env.TEAMUQ_HOME = prev
  try {
    rmSync(home, { recursive: true, force: true })
  } catch {}
}
process.exit(failed ? 1 : 0)
