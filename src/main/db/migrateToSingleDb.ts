/**
 * migrateToSingleDb.ts — 一次性整併 orchestrator（Phase 4.0 / migrate 批次 1/3）。
 *
 * plan_v1 §2.13：app ready 後、建任何 store 之前，由 index.ts 單點呼叫，把舊的分散
 * 持久層整併進單一 `~/.teamuq/teamuq.db`：
 *
 *   0. 開 teamuq.db（WAL + busy_timeout）＋ ensureSchema（IF NOT EXISTS，可重入）
 *   1. 查 schema_meta.migrated_* 旗標 → 已完成的 store 跳過（冪等）
 *   2. migratePunches()：ATTACH 舊 punches.db → 同一 transaction 內
 *      INSERT OR IGNORE punches + notifications → 驗筆數 → DETACH（筆數不符不標 done）
 *   3. migrateBindings()：milestones.json key→milestone_local_id（先試 remote_id→local_id，
 *      解不到保留原值 + legacy_key + warning，不丟資料 D28）；task_sessions.json 走既有
 *      v1→v2 正規化後攤平為 session_bindings（active → is_active 旗標）
 *   4. migrateSettings()：qwen.json → app_settings(key='llm')（api_key 略過）
 *   5. 每 store 成功 → schema_meta 標 migrated_<store>
 *   6. 全部成功 → 舊檔改名 *.migrated.<日期>（保留 30 天後清掃，D26）
 *
 * 注意：舊登入機密不再遷移；純本地 app 不保存舊遠端登入資料。
 *
 * 原子性抉擇（§2.13）：**per-store 小 transaction + 旗標冪等重入**，不做整包巨型
 * transaction（punches ATTACH 與其他 OS 呼叫異質）。
 *
 * 風險對齊：R28（punches 遷移失敗：ATTACH+單 txn 無半套 + INSERT OR IGNORE 冪等 +
 * 筆數驗證 + 失敗不改名舊檔可重遷 + 旗標防重）、R31（旗標漂移：旗標在對應 txn 內寫；
 * 舊檔改名只在全部 done 後；重入冪等）、R32（app ready 時序：本 orchestrator 在
 * whenReady 回呼、建 store 之前單點呼叫）。
 *
 * 隔離 / 可測：DB 路徑吃 TEAMUQ_HOME（與 repo / 其他 store 一致），舊檔路徑可由
 * options 覆寫供測試。
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import {
  ensureSchema,
  openTeamuqDb,
  teamuqDbPath,
} from '../repo/sqliteTaskRepository'

// ---------------------------------------------------------------------------
// 注入介面 / 選項
// ---------------------------------------------------------------------------

export interface MigrateOptions {
  /** teamuq.db 路徑（預設 teamuqDbPath()，吃 TEAMUQ_HOME）。 */
  dbPath?: string
  /** ~/.teamuq 目錄（預設 TEAMUQ_HOME || os.homedir() 下的 .teamuq）。 */
  teamuqDir?: string
  /** 改名用日期字串（預設今天 YYYY-MM-DD）；測試可固定。 */
  migratedStamp?: string
}

/** 每個 store 的遷移結果。 */
export interface StoreResult {
  /** 'skipped'（旗標已 done）/ 'migrated'（本次完成）/ 'absent'（無舊檔，視同完成）/
   *  'failed'（筆數不符或例外，不標 done、不改名）。 */
  status: 'skipped' | 'migrated' | 'absent' | 'failed'
  /** 來源筆數（punches/notifications/bindings 用）。 */
  sourceCount?: number
  /** 寫入後目標筆數（驗證用）。 */
  targetCount?: number
  /** 警告（不致命，如 binding key 解不到）。 */
  warnings?: string[]
  /** 失敗原因。 */
  error?: string
}

export interface MigrateReport {
  /** 全部 store 皆非 failed（含 skipped/absent/migrated）→ true。 */
  ok: boolean
  punches: StoreResult
  bindings: StoreResult
  settings: StoreResult
  /** 全部成功後改名的舊檔清單。 */
  renamed: string[]
  /** orchestrator 層級致命錯誤（開 DB 失敗等）。 */
  fatalError?: string
}

// ---------------------------------------------------------------------------
// 路徑 helper
// ---------------------------------------------------------------------------

function teamuqHome(): string {
  return process.env['TEAMUQ_HOME'] || os.homedir()
}

function defaultTeamuqDir(): string {
  return path.join(teamuqHome(), '.teamuq')
}

function nowIso(): string {
  return new Date().toISOString()
}

function todayStamp(): string {
  // YYYY-MM-DD（本機時區；改名追溯用，非精確需求）
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

// ---------------------------------------------------------------------------
// schema_meta 旗標（與 user_version 正交：旗標 = 舊檔資料是否匯入，§2.2）
// ---------------------------------------------------------------------------

function readFlag(db: Database.Database, key: string): boolean {
  try {
    const row = db
      .prepare('SELECT value FROM schema_meta WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row?.value === 'done'
  } catch {
    return false
  }
}

function writeFlag(db: Database.Database, key: string): void {
  db.prepare(
    'INSERT INTO schema_meta(key, value, updated_at) VALUES(?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(key, 'done', nowIso())
}

const FLAG_PUNCHES = 'migrated_punches'
const FLAG_BINDINGS = 'migrated_bindings'
const FLAG_SETTINGS = 'migrated_settings'

// ---------------------------------------------------------------------------
// (3) migratePunches — ATTACH 舊 punches.db、INSERT OR IGNORE、驗筆數、DETACH
// ---------------------------------------------------------------------------

/** 安全地把路徑嵌入 ATTACH 字串（better-sqlite3 的 ATTACH 不吃 ? 綁定）。 */
function quoteSqlLiteral(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'"
}

function migratePunches(
  db: Database.Database,
  oldPunchesPath: string,
): StoreResult {
  if (!fs.existsSync(oldPunchesPath)) {
    return { status: 'absent' }
  }
  try {
    // ATTACH 舊檔（唯讀語意；INSERT OR IGNORE 確保冪等，不覆蓋已遷入列）。
    db.exec(`ATTACH DATABASE ${quoteSqlLiteral(oldPunchesPath)} AS old_punch`)
    try {
      // 來源筆數（舊檔可能無這些表 → 視為 0）。
      const srcPunches = countOrZero(db, 'SELECT COUNT(*) AS c FROM old_punch.punches')
      const srcNotifs = countOrZero(
        db,
        'SELECT COUNT(*) AS c FROM old_punch.notifications',
      )
      const sourceCount = srcPunches + srcNotifs

      // 同一 transaction：punches + notifications 一起匯入（半套不可能，R28）。
      const tx = db.transaction(() => {
        if (tableExists(db, 'old_punch', 'punches')) {
          // 逐欄列出（不用 SELECT *，避免欄序/欄集差異）；id 一併帶過保留原 PK。
          db.exec(
            'INSERT OR IGNORE INTO main.punches ' +
              '(id, punch_uid, session_id, task_id, type, name, description, ' +
              ' started_at, ended_at, hours, subtask_id, status, ok, error, ' +
              ' created_at, updated_at) ' +
              'SELECT id, punch_uid, session_id, task_id, type, name, description, ' +
              ' started_at, ended_at, hours, subtask_id, status, ok, error, ' +
              ' created_at, updated_at FROM old_punch.punches',
          )
        }
        if (tableExists(db, 'old_punch', 'notifications')) {
          db.exec(
            'INSERT OR IGNORE INTO main.notifications ' +
              '(id, type, category, severity, title, body, ref_punch_uid, ' +
              ' session_id, created_at, read_at, active, resolved_at) ' +
              'SELECT id, type, category, severity, title, body, ref_punch_uid, ' +
              ' session_id, created_at, read_at, active, resolved_at ' +
              'FROM old_punch.notifications',
          )
        }
      })
      tx()

      // 驗筆數：目標應 >= 來源（INSERT OR IGNORE 冪等重遷不會少；多出來是先前已遷入的）。
      const tgtPunches = countOrZero(db, 'SELECT COUNT(*) AS c FROM main.punches')
      const tgtNotifs = countOrZero(db, 'SELECT COUNT(*) AS c FROM main.notifications')
      const targetCount = tgtPunches + tgtNotifs

      if (tgtPunches < srcPunches || tgtNotifs < srcNotifs) {
        // 筆數不符：不標 done、不改名舊檔，下次重試（R28）。
        return {
          status: 'failed',
          sourceCount,
          targetCount,
          error:
            `punch count mismatch: punches src=${srcPunches} tgt=${tgtPunches}, ` +
            `notifications src=${srcNotifs} tgt=${tgtNotifs}`,
        }
      }
      return { status: 'migrated', sourceCount, targetCount }
    } finally {
      try {
        db.exec('DETACH DATABASE old_punch')
      } catch {
        // DETACH 失敗不致命（連線即將由呼叫端管理）。
      }
    }
  } catch (err) {
    try {
      db.exec('DETACH DATABASE old_punch')
    } catch {
      /* ignore */
    }
    return { status: 'failed', error: errMsg(err) }
  }
}

function tableExists(db: Database.Database, schema: string, table: string): boolean {
  try {
    const row = db
      .prepare(
        `SELECT name FROM ${schema}.sqlite_master WHERE type='table' AND name = ?`,
      )
      .get(table) as { name: string } | undefined
    return !!row
  } catch {
    return false
  }
}

function countOrZero(db: Database.Database, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { c: number } | undefined
    return row?.c ?? 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// (4) migrateBindings — milestones.json + task_sessions.json
// ---------------------------------------------------------------------------

function migrateBindings(
  db: Database.Database,
  milestonesJsonPath: string,
  taskSessionsJsonPath: string,
): StoreResult {
  const warnings: string[] = []
  const hasMilestones = fs.existsSync(milestonesJsonPath)
  const hasTaskSessions = fs.existsSync(taskSessionsJsonPath)
  if (!hasMilestones && !hasTaskSessions) {
    return { status: 'absent' }
  }

  try {
    let sourceCount = 0
    let targetCount = 0

    // ── milestones.json → milestone_bindings ──────────────────────────────
    if (hasMilestones) {
      const data = readJsonObject(milestonesJsonPath)
      const milestones = asObject(data?.['milestones'])
      const entries = Object.entries(milestones)
      sourceCount += entries.length

      const tx = db.transaction(() => {
        const now = nowIso()
        for (const [rawKey, rawEntry] of entries) {
          const entry = asObject(rawEntry)
          // key→milestone_local_id：先試把 key 當 remote_id 解 → milestones.local_id；
          // 解不到保留原 key 當 local_id + legacy_key + warning（不丟資料，D28）。
          const resolved = resolveMilestoneLocalId(db, rawKey)
          const localId = resolved ?? rawKey
          if (resolved == null) {
            warnings.push(
              `milestone binding key '${rawKey}' 未解到 milestones.local_id，保留原值 + legacy_key`,
            )
          }
          db.prepare(
            'INSERT INTO milestone_bindings ' +
              '(milestone_local_id, project_path, tool, custom_command, legacy_key, created_at, updated_at) ' +
              'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
              'ON CONFLICT(milestone_local_id) DO UPDATE SET ' +
              '  project_path = excluded.project_path, tool = excluded.tool, ' +
              '  custom_command = excluded.custom_command, legacy_key = excluded.legacy_key, ' +
              '  updated_at = excluded.updated_at',
          ).run(
            localId,
            strOrNull(entry?.['project_path']),
            strOr(entry?.['tool'], 'claude'),
            strOrNull(entry?.['custom_command']),
            rawKey,
            now,
            now,
          )
        }
      })
      tx()
      targetCount += countOrZero(db, 'SELECT COUNT(*) AS c FROM milestone_bindings')
    }

    // ── task_sessions.json → session_bindings（active → is_active 攤平）──────
    if (hasTaskSessions) {
      const data = readJsonObject(taskSessionsJsonPath)
      const tasks = data ?? {}
      const tx = db.transaction(() => {
        for (const [rawTaskId, rawEntry] of Object.entries(tasks)) {
          const norm = normalizeTaskSessionEntry(rawEntry)
          const taskLocalId = String(rawTaskId)
          for (const h of norm.history) {
            const sid = strOrNull(h['session_id'])
            if (!sid) continue
            sourceCount += 1
            const isActive = norm.active != null && String(norm.active) === sid ? 1 : 0
            const first = strOr(h['first_bound_at'], nowIso())
            const last = strOr(h['last_bound_at'], first)
            db.prepare(
              'INSERT INTO session_bindings ' +
                '(task_local_id, session_id, source, project_path, label, ' +
                ' is_active, monitoring, first_bound_at, last_bound_at) ' +
                'VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?) ' +
                'ON CONFLICT(task_local_id, session_id) DO UPDATE SET ' +
                '  source = excluded.source, project_path = excluded.project_path, ' +
                '  label = excluded.label, is_active = excluded.is_active, ' +
                '  last_bound_at = excluded.last_bound_at',
            ).run(
              taskLocalId,
              sid,
              strOr(h['source'], 'claude'),
              strOrNull(h['project_path']),
              strOrNull(h['label']),
              isActive,
              first,
              last,
            )
          }
        }
      })
      tx()
      targetCount += countOrZero(db, 'SELECT COUNT(*) AS c FROM session_bindings')
    }

    return { status: 'migrated', sourceCount, targetCount, warnings }
  } catch (err) {
    return { status: 'failed', error: errMsg(err), warnings }
  }
}

/** key 當 remote_id → milestones.local_id（platform 無關，取任一相符列）；解不到 → null。 */
function resolveMilestoneLocalId(db: Database.Database, key: string): string | null {
  try {
    // 1) key 本身就是現存 local_id（本地建立的 milestone 直接命中）。
    const byLocal = db
      .prepare('SELECT local_id FROM milestones WHERE local_id = ? LIMIT 1')
      .get(key) as { local_id: string } | undefined
    if (byLocal?.local_id) return byLocal.local_id
    // 2) key 當 remote_id 解（pull 鏡像）。
    const byRemote = db
      .prepare('SELECT local_id FROM milestones WHERE remote_id = ? LIMIT 1')
      .get(key) as { local_id: string } | undefined
    return byRemote?.local_id ?? null
  } catch {
    return null
  }
}

/** task_sessions.json entry 正規化（含舊格式 sessions→history、active 推算），與 taskSessions.ts 等價。 */
function normalizeTaskSessionEntry(entry: unknown): {
  active: string | null
  history: Array<Record<string, unknown>>
} {
  const obj = asObject(entry)
  if (!obj) return { active: null, history: [] }

  const cleanHistory = (raw: unknown): Array<Record<string, unknown>> => {
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (s): s is Record<string, unknown> =>
        typeof s === 'object' && s !== null && !Array.isArray(s),
    )
  }

  if ('active' in obj || 'history' in obj) {
    const history = cleanHistory(obj['history'])
    const rawActive = obj['active']
    return { active: rawActive ? String(rawActive) : null, history }
  }

  // 舊格式：sessions → history，active = last_bound_at 最大者（fallback 任一）。
  const history = cleanHistory(obj['sessions'])
  let bestSid: string | null = null
  let bestKey = ''
  let fallback: string | null = null
  for (const s of history) {
    const sid = s['session_id']
    if (!sid) continue
    fallback = String(sid)
    const lb = String(s['last_bound_at'] ?? '')
    if (lb >= bestKey) {
      bestKey = lb
      bestSid = String(sid)
    }
  }
  return { active: bestSid ?? fallback, history }
}

// ---------------------------------------------------------------------------
// (4) migrateSettings — qwen.json → app_settings(key='llm')
// ---------------------------------------------------------------------------

function migrateSettings(
  db: Database.Database,
  qwenJsonPath: string,
): StoreResult {
  if (!fs.existsSync(qwenJsonPath)) {
    return { status: 'absent' }
  }
  try {
    const cfg = readJsonObject(qwenJsonPath) ?? {}
    // api_key 不寫入本地 app_settings，略過不遷移。
    const nonSecret: Record<string, unknown> = { ...cfg }
    delete nonSecret['api_key']

    const tx = db.transaction(() => {
      const now = nowIso()
      db.prepare(
        'INSERT INTO app_settings(key, value_json, updated_at) VALUES(?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
      ).run('llm', JSON.stringify(nonSecret), now)
    })
    tx()

    return { status: 'migrated', sourceCount: 1, targetCount: 1 }
  } catch (err) {
    return { status: 'failed', error: errMsg(err) }
  }
}

// ---------------------------------------------------------------------------
// (7) 舊檔改名 *.migrated.<日期>（只在全部成功後；保留 30 天，D26）
// ---------------------------------------------------------------------------

function renameOldFile(filePath: string, stamp: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const target = `${filePath}.migrated.${stamp}`
    fs.renameSync(filePath, target)
    return target
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function asObject(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s === '' ? null : s
}

function strOr(v: unknown, fallback: string): string {
  const s = strOrNull(v)
  return s ?? fallback
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// orchestrator 主入口
// ---------------------------------------------------------------------------

/**
 * 一次性整併遷移。冪等可重入：已標 migrated_* 的 store 跳過；失敗的 store 下次重試。
 * 舊檔改名只在「全部 store 皆非 failed」時執行。
 *
 * @param options dbPath / teamuqDir / migratedStamp 可注入（測試隔離）。
 */
export function migrateToSingleDb(options: MigrateOptions = {}): MigrateReport {
  const dir = options.teamuqDir ?? defaultTeamuqDir()
  const dbPath = options.dbPath ?? teamuqDbPath()
  const stamp = options.migratedStamp ?? todayStamp()

  // 舊檔路徑（plan §2.1 全在 ~/.teamuq）。
  const oldPunchesPath = path.join(dir, 'punches.db')
  const milestonesJsonPath = path.join(dir, 'milestones.json')
  const taskSessionsJsonPath = path.join(dir, 'task_sessions.json')
  const qwenJsonPath = path.join(dir, 'qwen.json')

  // (0) 開 DB + ensureSchema（可重入）。dbPath 與預設不同時自開（測試隔離）；
  //     否則用 openTeamuqDb（吃 TEAMUQ_HOME）。
  let db: Database.Database
  try {
    if (options.dbPath && options.dbPath !== teamuqDbPath()) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
      db = new Database(dbPath)
      db.pragma('journal_mode = WAL')
      db.pragma('busy_timeout = 5000')
      ensureSchema(db)
    } else {
      db = openTeamuqDb()
    }
  } catch (err) {
    return {
      ok: false,
      punches: { status: 'failed', error: 'db open failed' },
      bindings: { status: 'failed', error: 'db open failed' },
      settings: { status: 'failed', error: 'db open failed' },
      renamed: [],
      fatalError: errMsg(err),
    }
  }

  try {
    // (2) punches
    let punches: StoreResult
    if (readFlag(db, FLAG_PUNCHES)) {
      punches = { status: 'skipped' }
    } else {
      punches = migratePunches(db, oldPunchesPath)
      if (punches.status === 'migrated' || punches.status === 'absent') {
        writeFlag(db, FLAG_PUNCHES)
      }
    }

    // (3) bindings
    let bindings: StoreResult
    if (readFlag(db, FLAG_BINDINGS)) {
      bindings = { status: 'skipped' }
    } else {
      bindings = migrateBindings(db, milestonesJsonPath, taskSessionsJsonPath)
      if (bindings.status === 'migrated' || bindings.status === 'absent') {
        writeFlag(db, FLAG_BINDINGS)
      }
    }

    // (4) settings
    let settings: StoreResult
    if (readFlag(db, FLAG_SETTINGS)) {
      settings = { status: 'skipped' }
    } else {
      settings = migrateSettings(db, qwenJsonPath)
      if (settings.status === 'migrated' || settings.status === 'absent') {
        writeFlag(db, FLAG_SETTINGS)
      }
    }

    const allOk = [punches, bindings, settings].every(
      (r) => r.status !== 'failed',
    )

    // (6) 舊檔改名：只在全部成功後（R31）。
    const renamed: string[] = []
    if (allOk) {
      const candidates = [
        oldPunchesPath,
        milestonesJsonPath,
        taskSessionsJsonPath,
        qwenJsonPath,
      ]
      for (const c of candidates) {
        const r = renameOldFile(c, stamp)
        if (r) renamed.push(r)
      }
    }

    return {
      ok: allOk,
      punches,
      bindings,
      settings,
      renamed,
    }
  } finally {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}
