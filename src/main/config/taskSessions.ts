/**
 * taskSessions.ts — 任務 ↔ claude session 綁定的讀寫模組（DB-backed）。
 *
 * Phase 4.0 / G6 讀取端換源：原本讀寫 `~/.teamuq/task_sessions.json`，4.0 遷移已把資料
 * 攤平搬進 `~/.teamuq/teamuq.db` 的 `session_bindings` 表（active → is_active 旗標）並把舊
 * JSON 改名 `*.migrated.<日期>`。本模組改直查 DB 表（與 milestones.ts / appSettingsStore 同
 * 範式），否則讀已改名的 JSON → 永遠讀到空 → 監測頁綁定 session 帶不出來（用戶實測 bug）。
 *
 * **模型：一個任務同時只監測「一個」當前 session。**
 * - `active`：此任務「目前」綁定 / 監測的 session_id（= session_bindings.is_active=1 那列）。
 * - `history`：此任務「用過」的 session 清單（= 該 task 的所有 session_bindings 列）。
 * - `monitoring`：active session 是否在被監測（§2.14c D30；啟動自動重建）。
 *
 * `session_bindings` schema（sqliteTaskRepository.ts SCHEMA_SESSION_BINDINGS）：
 *   task_local_id, session_id, source, project_path, label, is_active, monitoring,
 *   first_bound_at, last_bound_at; PRIMARY KEY (task_local_id, session_id)
 *
 * 連線：openTeamuqDb()（吃 TEAMUQ_HOME，WAL + busy_timeout + ensureSchema 可重入建表）。
 * 每次呼叫開短連線即關（非熱迴圈，僅 session 開啟 / 換綁 / 監測切換時呼叫）。
 *
 * 容錯：DB 開失敗 / query 失敗 → 讀取面回合理預設（不丟例外）。
 */

import Database from 'better-sqlite3'

import { openTeamuqDb } from '../repo/sqliteTaskRepository'

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export interface SessionHistoryEntry {
  session_id: string
  source: string
  project_path: string | null
  label: string | null
  first_bound_at: string
  last_bound_at: string
}

export interface TaskSessionEntry {
  active: string | null
  /**
   * §2.14c D30 監測持久化旗標：1=該任務的 active session 在被監測 → app 啟動時自動重建
   * MonitorController（不需開 Tab）。對映 `session_bindings.monitoring` 欄（active 列）。
   */
  monitoring: boolean
  history: SessionHistoryEntry[]
}

export type TaskSessionsData = Record<string, TaskSessionEntry>

interface BindingRow {
  task_local_id: string
  session_id: string
  source: string | null
  project_path: string | null
  label: string | null
  is_active: number
  monitoring: number
  first_bound_at: string | null
  last_bound_at: string | null
}

// ---------------------------------------------------------------------------
// 內部工具
// ---------------------------------------------------------------------------

function _nowIso(): string {
  const now = new Date()
  const ms = String(now.getUTCMilliseconds()).padStart(3, '0')
  return now.toISOString().replace(/\.\d{3}Z$/, `.${ms}Z`)
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function rowToHistory(row: BindingRow): SessionHistoryEntry {
  return {
    session_id: String(row.session_id),
    source: row.source ?? 'claude',
    project_path: row.project_path ?? null,
    label: row.label ?? null,
    first_bound_at: row.first_bound_at ?? '',
    last_bound_at: row.last_bound_at ?? '',
  }
}

/** 把某 task 的所有綁定列組成 TaskSessionEntry（active = is_active=1 列；monitoring 取該列）。 */
function rowsToEntry(rows: BindingRow[]): TaskSessionEntry {
  const history = rows.map(rowToHistory)
  const activeRow = rows.find((r) => r.is_active === 1)
  return {
    active: activeRow ? String(activeRow.session_id) : null,
    monitoring: !!activeRow && activeRow.monitoring === 1,
    history,
  }
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

/**
 * 讀取整個 config（session_bindings → TaskSessionsData 形狀，向後相容）。
 * DB 開失敗 / query 失敗 → 回 {}（不丟例外）。
 */
export function load(): TaskSessionsData {
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    const rows = db
      .prepare(
        'SELECT task_local_id, session_id, source, project_path, label, ' +
          'is_active, monitoring, first_bound_at, last_bound_at FROM session_bindings',
      )
      .all() as BindingRow[]
    const byTask: Record<string, BindingRow[]> = {}
    for (const row of rows) {
      const t = String(row.task_local_id)
      ;(byTask[t] ??= []).push(row)
    }
    const out: TaskSessionsData = {}
    for (const [taskId, taskRows] of Object.entries(byTask)) {
      out[taskId] = rowsToEntry(taskRows)
    }
    return out
  } catch (err) {
    console.error('[taskSessions] load failed:', errMsg(err))
    return {}
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// 讀取 helper（單 task 的綁定列）
// ---------------------------------------------------------------------------

function _rowsForTask(db: Database.Database, taskId: string): BindingRow[] {
  return db
    .prepare(
      'SELECT task_local_id, session_id, source, project_path, label, ' +
        'is_active, monitoring, first_bound_at, last_bound_at ' +
        'FROM session_bindings WHERE task_local_id = ?',
    )
    .all(taskId) as BindingRow[]
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 取單一任務的 entry（{active, monitoring, history}）；無任何綁定 → null。
 */
export function getEntry(taskId: unknown): TaskSessionEntry | null {
  const key = String(taskId)
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    const rows = _rowsForTask(db, key)
    if (rows.length === 0) return null
    return rowsToEntry(rows)
  } catch (err) {
    console.error('[taskSessions] getEntry failed:', errMsg(err))
    return null
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 回該任務目前綁定（監測）的單一 session_id；無則 null。
 */
export function getActive(taskId: unknown): string | null {
  const key = String(taskId)
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    const row = db
      .prepare(
        'SELECT session_id FROM session_bindings WHERE task_local_id = ? AND is_active = 1 LIMIT 1',
      )
      .get(key) as { session_id: string } | undefined
    return row ? String(row.session_id) : null
  } catch (err) {
    console.error('[taskSessions] getActive failed:', errMsg(err))
    return null
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 回該任務 active session 的 project_path（綁定時存的）；無則 null。
 * 供「milestone 沒設路徑」時的 per-task fallback（不依賴 milestone id）。
 */
export function getActiveProjectPath(taskId: unknown): string | null {
  const key = String(taskId)
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    const row = db
      .prepare(
        'SELECT project_path FROM session_bindings WHERE task_local_id = ? AND is_active = 1 LIMIT 1',
      )
      .get(key) as { project_path: string | null } | undefined
    const p = row?.project_path
    return typeof p === 'string' && p ? p : null
  } catch (err) {
    console.error('[taskSessions] getActiveProjectPath failed:', errMsg(err))
    return null
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 更新該任務 active session 的 project_path（**無條件覆寫**，與 setActive 的
 * 「只在空時填」不同，供使用者改路徑時用）。無 active 列則略過。
 */
export function setActiveProjectPath(taskId: unknown, projectPath: string | null): void {
  const key = String(taskId)
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    db.prepare(
      'UPDATE session_bindings SET project_path = ? WHERE task_local_id = ? AND is_active = 1',
    ).run(projectPath, key)
  } catch (err) {
    console.error('[taskSessions] setActiveProjectPath failed:', errMsg(err))
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 設此任務的 active = session_id，並把它 upsert 進綁定列。
 *
 * - 列已存在（同 task+session）→ 更新 last_bound_at，補空欄（label / project_path
 *   僅在原本為空時補，不覆蓋既有值），設 is_active=1。
 * - 不存在 → INSERT 一筆，first_bound_at = last_bound_at = now，is_active=1。
 * - 其餘列 is_active 清 0（每 task 至多一筆 active）。
 * - monitoring 旗標跨換綁保留：搬到新 active 列（換綁不關監測）。
 * 回傳更新後的該任務 entry。
 */
export function setActive(
  taskId: unknown,
  sessionId: unknown,
  params?: {
    source?: string
    project_path?: string | null
    label?: string | null
    now_iso?: string
  },
): TaskSessionEntry {
  const key = String(taskId)
  const sid = String(sessionId)
  const now = params?.now_iso ?? _nowIso()
  const source = params?.source ?? 'claude'
  const projectPath = params?.project_path ?? null
  const label = params?.label ?? null

  let db: Database.Database | null = null
  try {
    const conn = openTeamuqDb()
    db = conn
    const tx = conn.transaction(() => {
      // monitoring 旗標跨換綁保留（取目前 active 列的值搬到新 active）。
      const prevActive = conn
        .prepare(
          'SELECT monitoring FROM session_bindings WHERE task_local_id = ? AND is_active = 1 LIMIT 1',
        )
        .get(key) as { monitoring: number } | undefined
      const keepMonitoring = prevActive?.monitoring === 1 ? 1 : 0

      // 先把所有列 is_active 清 0（待設目標列為 1）。
      conn.prepare('UPDATE session_bindings SET is_active = 0 WHERE task_local_id = ?').run(key)

      const existing = conn
        .prepare(
          'SELECT session_id, label, project_path FROM session_bindings ' +
            'WHERE task_local_id = ? AND session_id = ?',
        )
        .get(key, sid) as
        | { session_id: string; label: string | null; project_path: string | null }
        | undefined

      if (existing) {
        // 補空欄（不覆蓋既有），更新 last_bound_at，設 active + 搬監測旗標。
        const nextLabel = !existing.label && label ? label : existing.label
        const nextPath =
          !existing.project_path && projectPath ? projectPath : existing.project_path
        conn.prepare(
          'UPDATE session_bindings SET is_active = 1, monitoring = ?, last_bound_at = ?, ' +
            'label = ?, project_path = ? WHERE task_local_id = ? AND session_id = ?',
        ).run(keepMonitoring, now, nextLabel, nextPath, key, sid)
      } else {
        conn.prepare(
          'INSERT INTO session_bindings ' +
            '(task_local_id, session_id, source, project_path, label, ' +
            ' is_active, monitoring, first_bound_at, last_bound_at) ' +
            'VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
        ).run(key, sid, source, projectPath, label, keepMonitoring, now, now)
      }
    })
    tx()
    return rowsToEntry(_rowsForTask(conn, key))
  } catch (err) {
    console.error('[taskSessions] setActive failed:', errMsg(err))
    return { active: sid, monitoring: false, history: [] }
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 把此任務 active 設 null（綁定列保留；監測一併歸 0）。回傳更新後 entry。
 */
export function clearActive(taskId: unknown): TaskSessionEntry {
  const key = String(taskId)
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    // 清 active 即停監測（無 active session 可監測 → monitoring 一併歸 0）。
    db.prepare(
      'UPDATE session_bindings SET is_active = 0, monitoring = 0 WHERE task_local_id = ?',
    ).run(key)
    return rowsToEntry(_rowsForTask(db, key))
  } catch (err) {
    console.error('[taskSessions] clearActive failed:', errMsg(err))
    return { active: null, monitoring: false, history: [] }
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// 監測持久化（§2.14c D30：session_bindings.monitoring → app 啟動自動恢復監測）
// ---------------------------------------------------------------------------

/**
 * 設此任務 active session 的監測旗標。
 * - on=true 但無 active session → 不寫（沒有可監測對象）。
 * - 回傳實際生效的 monitoring 值。
 */
export function setMonitoring(taskId: unknown, on: boolean): boolean {
  const key = String(taskId)
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    const active = db
      .prepare(
        'SELECT session_id FROM session_bindings WHERE task_local_id = ? AND is_active = 1 LIMIT 1',
      )
      .get(key) as { session_id: string } | undefined
    if (!active) return false
    const next = on === true ? 1 : 0
    db.prepare(
      'UPDATE session_bindings SET monitoring = ? WHERE task_local_id = ? AND is_active = 1',
    ).run(next, key)
    return next === 1
  } catch (err) {
    console.error('[taskSessions] setMonitoring failed:', errMsg(err))
    return false
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

/** 某任務的 active session 是否標記為監測中（無 active / 例外 → false）。 */
export function isMonitoring(taskId: unknown): boolean {
  const key = String(taskId)
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    const row = db
      .prepare(
        'SELECT monitoring FROM session_bindings WHERE task_local_id = ? AND is_active = 1 LIMIT 1',
      )
      .get(key) as { monitoring: number } | undefined
    return !!row && row.monitoring === 1
  } catch (err) {
    console.error('[taskSessions] isMonitoring failed:', errMsg(err))
    return false
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

/** 啟動自動恢復用：monitoring=1 的綁定快照（task_id + active session + project_path）。 */
export interface MonitoringBinding {
  task_id: string
  session_id: string
  project_path: string | null
}

/**
 * 列出所有 monitoring=1 且 is_active=1 的綁定（app 啟動自動重建監測用，§2.14c D30）。
 */
export function listMonitoringTasks(): MonitoringBinding[] {
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    const rows = db
      .prepare(
        'SELECT task_local_id, session_id, project_path FROM session_bindings ' +
          'WHERE monitoring = 1 AND is_active = 1',
      )
      .all() as Array<{ task_local_id: string; session_id: string; project_path: string | null }>
    return rows.map((r) => ({
      task_id: String(r.task_local_id),
      session_id: String(r.session_id),
      project_path: typeof r.project_path === 'string' && r.project_path ? r.project_path : null,
    }))
  } catch (err) {
    console.error('[taskSessions] listMonitoringTasks failed:', errMsg(err))
    return []
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}
