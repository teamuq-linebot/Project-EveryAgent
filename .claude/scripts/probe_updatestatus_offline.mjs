// probe_updatestatus_offline.mjs — 真機證據（local-first 寫入解耦）：
//   模擬「未登入」改某 task status → 本地 tasks 該列 status 變更 + outbox gate 正確。
//   非破壞：複製真實 ~/.teamuq/teamuq.db 到 temp，僅對副本操作，絕不動使用者真 DB / backup。
//   用 .abi-node-bsq3 的 Node-ABI better-sqlite3（同 vitest 別名手法），不碰 node_modules（Electron-ABI）。
import { createRequire } from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

const ROOT = 'C:/teamuq/teamuq-electron'
const reqAbi = createRequire(path.join(ROOT, '.abi-node-bsq3', 'better-sqlite3', 'package.json'))
const Database = reqAbi('./lib/index.js')

const home = process.env['TEAMUQ_HOME'] || os.homedir()
const realDb = path.join(home, '.teamuq', 'teamuq.db')
if (!fs.existsSync(realDb)) {
  console.log(JSON.stringify({ realDb, exists: false }))
  process.exit(0)
}

// 複製到 temp（非破壞；只讀真 DB，操作副本）。
const tmp = path.join(os.tmpdir(), `teamuq-probe-${Date.now()}.db`)
fs.copyFileSync(realDb, tmp)

const db = new Database(tmp)
const nowIso = () => new Date().toISOString()

// updateTaskStatus 的等效實作（與 sqliteTaskRepository.updateTaskStatus 同邏輯；此為純 mjs 探針，
//   驗 SQL 行為——outbox gate = sync_enabled=1 且 remote_id 非空才標 dirty）。
function updateTaskStatus(idOrRemote, status) {
  let row = db.prepare('SELECT * FROM tasks WHERE local_id = ?').get(idOrRemote)
  if (!row) row = db.prepare('SELECT * FROM tasks WHERE remote_id = ?').get(idOrRemote)
  if (!row) return null
  const needsPush = row.sync_enabled === 1 && !!row.remote_id
  if (needsPush) {
    db.prepare(
      "UPDATE tasks SET status = ?, dirty = 1, " +
        "pending_op = CASE WHEN pending_op = 'create' THEN 'create' ELSE 'update' END, " +
        'updated_at = ? WHERE local_id = ?',
    ).run(status, nowIso(), row.local_id)
  } else {
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE local_id = ?').run(
      status,
      nowIso(),
      row.local_id,
    )
  }
  return db.prepare('SELECT * FROM tasks WHERE local_id = ?').get(row.local_id)
}

// 取一筆真實鏡像列（origin=remote，sync_enabled=0 — pull 鏡像預設）。
const sample = db
  .prepare("SELECT local_id, remote_id, name, status, sync_enabled, dirty FROM tasks LIMIT 1")
  .get()

const result = { realDb, tmp, cases: [] }

// Case A：sync_enabled=0 鏡像列（純本地改法）→ status 變、dirty 不動（無遠端可推 → 不進 outbox）。
{
  const before = { ...sample }
  const newStatus = before.status === 'COMPLETED' ? 'IN_PROGRESS' : 'COMPLETED'
  const after = updateTaskStatus(before.remote_id, newStatus)
  result.cases.push({
    case: 'A sync_enabled=0（未上雲鏡像）',
    before: { status: before.status, dirty: before.dirty, sync_enabled: before.sync_enabled },
    after: { status: after.status, dirty: after.dirty, pending_op: after.pending_op },
    status_changed: before.status !== after.status,
    dirty_unchanged: after.dirty === before.dirty,
  })
}

// Case B：把同列標 sync_enabled=1（模擬已上雲）→ 再改 status → dirty=1 + pending_op=update。
{
  db.prepare('UPDATE tasks SET sync_enabled = 1, dirty = 0, pending_op = NULL WHERE remote_id = ?').run(
    sample.remote_id,
  )
  const before = db.prepare('SELECT status, dirty, sync_enabled FROM tasks WHERE remote_id = ?').get(sample.remote_id)
  const newStatus = before.status === 'WAITING' ? 'PENDING' : 'WAITING'
  const after = updateTaskStatus(sample.remote_id, newStatus)
  result.cases.push({
    case: 'B sync_enabled=1（已上雲）',
    before,
    after: { status: after.status, dirty: after.dirty, pending_op: after.pending_op },
    status_changed: before.status !== after.status,
    dirty_set_to_1: after.dirty === 1,
    pending_op_update: after.pending_op === 'update',
  })
}

db.close()
fs.unlinkSync(tmp) // 清掉 temp 副本。
console.log(JSON.stringify(result, null, 2))
