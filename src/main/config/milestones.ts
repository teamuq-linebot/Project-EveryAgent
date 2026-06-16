/**
 * milestones.ts — milestone → 本地 project 設定的讀寫模組（DB-backed）。
 *
 * Phase 4.0 / G6 讀取端換源：原本讀寫 `~/.teamuq/milestones.json`，4.0 遷移已把資料
 * 搬進 `~/.teamuq/teamuq.db` 的 `milestone_bindings` 表並把舊 JSON 改名為 `*.migrated.<日期>`。
 * 本模組改直查 DB 表（與 appSettingsStore / SecretStore 同範式），否則讀已改名的 JSON →
 * 永遠讀到空 → 監測頁專案路徑帶不出來（用戶實測 bug：每次都要自己重設路徑）。
 *
 * `milestone_bindings` schema（sqliteTaskRepository.ts SCHEMA_MILESTONE_BINDINGS）：
 *   milestone_local_id TEXT PRIMARY KEY, project_path TEXT, tool TEXT DEFAULT 'claude',
 *   custom_command TEXT, legacy_key TEXT, created_at TEXT, updated_at TEXT
 *
 * 連線：openTeamuqDb()（吃 TEAMUQ_HOME，WAL + busy_timeout + ensureSchema 可重入建表）。
 * 每次呼叫開短連線即關（非熱迴圈，僅 session 開啟 / 換綁 / 套用路徑時呼叫）。
 *
 * 容錯：DB 開失敗 / query 失敗 → 讀取面回預設（不丟例外，讀取面絕不崩）。
 * set_entry 整筆覆寫語意：傳入欄位直接覆蓋、沒帶的欄位變預設（null）。
 */

import Database from 'better-sqlite3'

import { openTeamuqDb } from '../repo/sqliteTaskRepository'

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export interface MilestoneEntry {
  project_path: string | null
  tool: string
  custom_command: string | null
}

export interface MilestonesData {
  version: number
  milestones: Record<string, MilestoneEntry>
}

interface MilestoneBindingRow {
  milestone_local_id: string
  project_path: string | null
  tool: string | null
  custom_command: string | null
}

// ---------------------------------------------------------------------------
// 內部工具
// ---------------------------------------------------------------------------

function _default(): MilestonesData {
  return { version: 1, milestones: {} }
}

function nowIso(): string {
  return new Date().toISOString()
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function rowToEntry(row: MilestoneBindingRow): MilestoneEntry {
  return {
    project_path: row.project_path ?? null,
    tool: row.tool ?? 'claude',
    custom_command: row.custom_command ?? null,
  }
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

/**
 * 讀取全部 milestone 綁定（milestone_bindings 表 → MilestonesData 形狀，向後相容）。
 * DB 開失敗 / query 失敗 → 回預設（不丟例外）。
 */
export function load(): MilestonesData {
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    const rows = db
      .prepare(
        'SELECT milestone_local_id, project_path, tool, custom_command FROM milestone_bindings',
      )
      .all() as MilestoneBindingRow[]
    const milestones: Record<string, MilestoneEntry> = {}
    for (const row of rows) {
      milestones[String(row.milestone_local_id)] = rowToEntry(row)
    }
    return { version: 1, milestones }
  } catch (err) {
    console.error('[milestones] load failed:', errMsg(err))
    return _default()
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 取單一 milestone 的 entry（不存在 / 例外 → null）。milestone_id 一律字串化比對。
 */
export function get(milestoneId: unknown): MilestoneEntry | null {
  const key = String(milestoneId)
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    const row = db
      .prepare(
        'SELECT milestone_local_id, project_path, tool, custom_command ' +
          'FROM milestone_bindings WHERE milestone_local_id = ?',
      )
      .get(key) as MilestoneBindingRow | undefined
    return row ? rowToEntry(row) : null
  } catch (err) {
    console.error('[milestones] get failed:', errMsg(err))
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
 * 設定（新增 / 覆寫）某 milestone 的 entry（upsert milestone_bindings）。
 *
 * **整筆覆寫語意**：傳入三欄直接覆蓋，沒帶的欄位使用預設（null）。
 * 呼叫端若要保留既有值，須先 get() 取出再傳入。
 *
 * milestone_id 一律字串化當 key。回傳寫入後的 entry（寫失敗只記錄不拋，回傳期望值）。
 */
export function setEntry(
  milestoneId: unknown,
  params: {
    project_path: string | null
    tool: string
    custom_command?: string | null
  },
): MilestoneEntry {
  const key = String(milestoneId)
  const entry: MilestoneEntry = {
    project_path: params.project_path,
    tool: params.tool,
    custom_command: params.custom_command ?? null,
  }
  let db: Database.Database | null = null
  try {
    db = openTeamuqDb()
    const now = nowIso()
    db.prepare(
      'INSERT INTO milestone_bindings ' +
        '(milestone_local_id, project_path, tool, custom_command, legacy_key, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(milestone_local_id) DO UPDATE SET ' +
        '  project_path = excluded.project_path, tool = excluded.tool, ' +
        '  custom_command = excluded.custom_command, updated_at = excluded.updated_at',
    ).run(key, entry.project_path, entry.tool, entry.custom_command, key, now, now)
  } catch (err) {
    console.error('[milestones] setEntry failed:', errMsg(err))
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
  return entry
}
