// query_local_tasks.mjs — 證據：看板來源（本地 tasks）在 ~/.teamuq/teamuq.db 仍有資料，
//   findAllTasks 純讀本地即可回看板資料（不需網路）。
// 用 .abi-node-bsq3 的 Node-ABI better-sqlite3（同 vitest 別名手法），不碰 node_modules（Electron-ABI）。
import { createRequire } from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

const ROOT = 'C:/teamuq/teamuq-electron'
const reqAbi = createRequire(path.join(ROOT, '.abi-node-bsq3', 'better-sqlite3', 'package.json'))
const Database = reqAbi('./lib/index.js')

const home = process.env['TEAMUQ_HOME'] || os.homedir()
const dbPath = path.join(home, '.teamuq', 'teamuq.db')
if (!fs.existsSync(dbPath)) {
  console.log(JSON.stringify({ dbPath, exists: false }))
  process.exit(0)
}
const db = new Database(dbPath, { readonly: true })
const total = db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c
const byOrigin = db.prepare('SELECT origin, COUNT(*) AS c FROM tasks GROUP BY origin').all()
const sample = db
  .prepare('SELECT local_id, remote_id, name, status, origin, platform_local_id FROM tasks LIMIT 5')
  .all()
db.close()
console.log(JSON.stringify({ dbPath, exists: true, total, byOrigin, sample }, null, 2))
