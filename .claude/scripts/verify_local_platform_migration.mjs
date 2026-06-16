// verify_local_platform_migration.mjs
// 靜態驗證（不動真實 DB）：複製 live teamuq.db → 模擬 reconcile(builtin:local) + backfillLocalPlatform 的 SQL，
// 斷言 migration 邊界（純本地歸 builtin:local；已指派連線不動；remote 不動；punches 不碰；冪等）。
// 用 node:sqlite（built-in，與 query.mjs 同源），不碰 better-sqlite3 ABI。
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LIVE = process.env.TEAMUQ_DB || path.join(os.homedir(), '.teamuq', 'teamuq.db')
const tmp = path.join(os.tmpdir(), `verify-local-platform-${Date.now()}.db`)
fs.copyFileSync(LIVE, tmp)
const db = new DatabaseSync(tmp)

const ENTITIES = ['projects', 'milestones', 'tasks', 'subtasks']
const LOCAL_ID = 'builtin:local'

function snapshot(label) {
  const out = {}
  for (const t of ENTITIES) {
    const rows = db
      .prepare(
        `SELECT origin, platform_local_id AS p, COUNT(*) c FROM ${t} GROUP BY origin, platform_local_id`,
      )
      .all()
    out[t] = rows
  }
  console.log(`\n[${label}]`)
  for (const t of ENTITIES) console.log(' ', t, JSON.stringify(out[t]))
  return out
}

// 0) before
snapshot('BEFORE')
const localNullBefore = {}
for (const t of ENTITIES) {
  localNullBefore[t] = db
    .prepare(`SELECT COUNT(*) c FROM ${t} WHERE origin='local' AND platform_local_id IS NULL`)
    .get().c
}
const punchesBefore = db.prepare('SELECT COUNT(*) c FROM punches').get().c

// 1) reconcile builtin:local（只補不蓋）
const existsLocal = db.prepare('SELECT 1 FROM platforms WHERE local_id=?').get(LOCAL_ID)
if (!existsLocal) {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO platforms (local_id,name,protocol,base_url,auth_type,secret_ref,auth_config_json,is_builtin,enabled,created_at,updated_at) ' +
      "VALUES (?, '本地','graphql',NULL,'none',NULL,NULL,1,1,?,?)",
  ).run(LOCAL_ID, now, now)
  console.log('\nseeded builtin:local')
} else {
  console.log('\nbuiltin:local already present (idempotent)')
}
const localRow = db.prepare('SELECT * FROM platforms WHERE local_id=?').get(LOCAL_ID)
console.log('local platform row:', JSON.stringify({
  local_id: localRow.local_id, name: localRow.name, base_url: localRow.base_url,
  auth_type: localRow.auth_type, secret_ref: localRow.secret_ref, is_builtin: localRow.is_builtin, enabled: localRow.enabled,
}))
const localOps = db.prepare('SELECT COUNT(*) c FROM platform_operations WHERE platform_local_id=?').get(LOCAL_ID).c

// 2) backfill（=repo.backfillLocalPlatform SQL）
const changes = {}
for (const t of ENTITIES) {
  const info = db
    .prepare(`UPDATE ${t} SET platform_local_id=? WHERE origin='local' AND platform_local_id IS NULL`)
    .run(LOCAL_ID)
  changes[t] = info.changes
}
console.log('\nbackfill changes:', JSON.stringify(changes))

snapshot('AFTER')

// 3) 冪等再跑
const changes2 = {}
for (const t of ENTITIES) {
  changes2[t] = db
    .prepare(`UPDATE ${t} SET platform_local_id=? WHERE origin='local' AND platform_local_id IS NULL`)
    .run(LOCAL_ID).changes
}
console.log('\nidempotent re-run changes (expect all 0):', JSON.stringify(changes2))

// ── assertions ──
const fail = []
for (const t of ENTITIES) {
  if (changes[t] !== localNullBefore[t]) fail.push(`${t}: changed=${changes[t]} != localNullBefore=${localNullBefore[t]}`)
  if (changes2[t] !== 0) fail.push(`${t}: idempotent re-run changed ${changes2[t]} (expect 0)`)
  // backfill 後不應再有 local+null
  const stillNull = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE origin='local' AND platform_local_id IS NULL`).get().c
  if (stillNull !== 0) fail.push(`${t}: still has local+null rows=${stillNull}`)
}
// remote 列 platform 不應被改成 builtin:local
for (const t of ENTITIES) {
  const remoteToLocal = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE origin='remote' AND platform_local_id=?`).get(LOCAL_ID).c
  if (remoteToLocal !== 0) fail.push(`${t}: remote rows wrongly set to builtin:local=${remoteToLocal}`)
}
// 已指派連線的 local 列（platform_local_id 非 builtin:local 且非 null）不應被改
// punches 不碰
const punchesAfter = db.prepare('SELECT COUNT(*) c FROM punches').get().c
if (punchesAfter !== punchesBefore) fail.push(`punches count changed ${punchesBefore} -> ${punchesAfter}`)
if (localOps !== 0) fail.push(`builtin:local has operations=${localOps} (expect 0)`)
if (localRow.base_url !== null) fail.push(`builtin:local base_url not null`)

console.log('\n=== RESULT ===')
if (fail.length === 0) {
  console.log('PASS — migration boundary holds on real data copy')
} else {
  console.log('FAIL:')
  for (const f of fail) console.log('  -', f)
}
db.close()
fs.unlinkSync(tmp)
process.exit(fail.length === 0 ? 0 : 1)
