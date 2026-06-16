/**
 * punchSchema.ts — 打卡帳本 schema / DDL 字串常數（自 punchLedger.ts 原樣抽出）
 *
 * 來源：原 punchLedger.ts L34、L40-118。所有 SQL 字串、partial index DDL、數值常數
 *   一字不改、一值不動，僅由 `const` 改為 `export const`。原檔以 import 取回使用，
 *   並 `export *` re-export 以維持原 import path 可達（barrel 鐵則）。
 *
 * ⚠️ byte-identical 約束（最高優先）：SCHEMA_PUNCH_TASK_UID_IDX 與
 *   src/main/repo/sqliteTaskRepository.ts:331 的 partial unique index 組出的 runtime 字串
 *   必須完全相同。此處保留原檔的兩段字串串接寫法，不重排空白、不合併單行、不改大小寫。
 *   日後改 repo 版請同步本處（兩處 DDL 必須維持相等）。
 */

// ---------------------------------------------------------------------------
// 殭屍 open 列清理閾值（24h，單位 ms）
// ---------------------------------------------------------------------------

export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// schema（照搬 Python）
// ---------------------------------------------------------------------------

export const SCHEMA_PUNCHES = `
CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  punch_uid   TEXT NOT NULL,
  session_id  TEXT, task_id TEXT,
  type        TEXT,
  name        TEXT, description TEXT,
  started_at  TEXT, ended_at TEXT, hours REAL,
  subtask_id  TEXT,
  status      TEXT,
  ok          INTEGER, error TEXT,
  created_at  TEXT NOT NULL, updated_at TEXT
)`;

/** 舊索引（依 session_id+punch_uid）— 遷移後 DROP，保留字串供 _ensureSchema 使用。 */
export const DROP_OLD_SESSION_UID_IDX = 'DROP INDEX IF EXISTS idx_punch_uid';

/**
 * 新去重鍵（依 task_id+punch_uid）— 同一任務下同一工作只記一筆。
 * task_id IS NOT NULL 部分索引：NULL task_id（測試 / 邊緣情境）不在去重範圍，
 * 避免 SQLite UNIQUE 對 NULL 不去重導致哨兵索引失效。
 */
export const SCHEMA_PUNCH_TASK_UID_IDX =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_punch_task_uid ON punches(task_id, punch_uid) ' +
  'WHERE task_id IS NOT NULL';

// §2.14b 打卡溯源欄（D29）：punches 末尾 nullable ADD COLUMN（與 repo.ensurePunchExtraColumns
//   逐字一致；PunchLedger 既有 SQL 零影響）。source_file=觸發該 punch 的 JSONL 檔；
//   source_pos=讀到打卡資訊的行/位移。ALTER 無 IF NOT EXISTS，故先探欄（PRAGMA table_info）。
//   與 repo 共用 teamuq.db 時欄位已由 repo 建好；此處只為**獨立 tmp DB**（測試 / 舊路徑）補欄。
export const PUNCH_EXTRA_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'source_file', ddl: 'ALTER TABLE punches ADD COLUMN source_file TEXT' },
  { name: 'source_pos', ddl: 'ALTER TABLE punches ADD COLUMN source_pos INTEGER' },
  // 來源 CLI（'claude' | 'codex'）：標記該 punch 由哪個 CLI 監測產生。null=舊列 / 未知。
  { name: 'cli', ddl: 'ALTER TABLE punches ADD COLUMN cli TEXT' },
];

export const SCHEMA_NOTIFICATIONS = `
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  category TEXT, severity TEXT,
  title TEXT, body TEXT,
  ref_punch_uid TEXT, session_id TEXT,
  created_at TEXT NOT NULL, read_at TEXT,
  active INTEGER, resolved_at TEXT
)`;

// subtasks DDL（對齊 src/main/repo/sqlite/schema.ts SCHEMA_SUBTASKS 純本地版；
// 已移除雲端欄：remote_id / origin / platform_local_id / sync_enabled / dirty /
//   pending_op / tombstone / raw_json / version。
// 來源行號：schema.ts:72-86；日後 repo 版加欄請同步本處。
// 確保在沒有 sqliteTaskRepository 建表的獨立 tmp DB（測試 / 早期初始化）上 LEFT JOIN 也能正常運作）
export const SCHEMA_SUBTASKS = `
CREATE TABLE IF NOT EXISTS subtasks (
  local_id          TEXT PRIMARY KEY,
  task_local_id     TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  start_time        TEXT,
  end_time          TEXT,
  duration          REAL,
  assignee_id       TEXT,
  category_id       TEXT,
  is_settled        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT
)`;

export const SCHEMA_SUBTASKS_IDX =
  'CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_local_id)';
