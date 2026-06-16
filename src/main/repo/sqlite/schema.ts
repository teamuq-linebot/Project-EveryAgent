import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SCHEMA_VERSION, CONV_PARSER_VERSION } from './version'

// ---------------------------------------------------------------------------
// DB 路徑（TEAMUQ_HOME 隔離；§2.1 ~/.teamuq/teamuq.db）
// ---------------------------------------------------------------------------

export function teamuqDbPath(): string {
  const home = process.env['TEAMUQ_HOME'] || os.homedir()
  return path.join(home, '.teamuq', 'teamuq.db')
}

// ---------------------------------------------------------------------------
// DDL — 實體表（純本地；local_id PK；跨表 FK 走 *_local_id）
// ---------------------------------------------------------------------------

const SCHEMA_PROJECTS = `
CREATE TABLE IF NOT EXISTS projects (
  local_id          TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT
)`

const SCHEMA_MILESTONES = `
CREATE TABLE IF NOT EXISTS milestones (
  local_id          TEXT PRIMARY KEY,
  project_local_id  TEXT,                                  -- FK→projects.local_id
  name              TEXT NOT NULL,
  description       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT
)`

const SCHEMA_TASKS = `
CREATE TABLE IF NOT EXISTS tasks (
  local_id           TEXT PRIMARY KEY,
  milestone_local_id TEXT,                                 -- FK→milestones.local_id（session:open binding 直查鍵，§2.7）
  project_local_id   TEXT,                                 -- FK→projects.local_id（團隊對話 session：task↔project）
  name               TEXT NOT NULL,
  status             TEXT,
  description        TEXT,
  priority           TEXT,
  start_date         TEXT,
  end_date           TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT
)`

const SCHEMA_TASKS_MILESTONE_IDX =
  'CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_local_id)'

// 專案 ↔ 資料夾多對多關聯表（團隊對話 session：一專案可多資料夾、一資料夾可多專案）。
//   路徑逐字相等比對（不 normalize，不引 path.resolve）。
const SCHEMA_PROJECT_FOLDERS = `
CREATE TABLE IF NOT EXISTS project_folders (
  project_local_id TEXT NOT NULL,   -- FK→projects.local_id
  folder_path      TEXT NOT NULL,   -- 絕對路徑（PTY cwd；dialog/常用清單原樣路徑）
  created_at       TEXT NOT NULL,
  PRIMARY KEY (project_local_id, folder_path)
)`
// 雙向反查都要走索引：PK 已覆蓋 by-project，folder 反查需獨立索引。
const SCHEMA_PROJECT_FOLDERS_FOLDER_IDX =
  'CREATE INDEX IF NOT EXISTS idx_pf_folder ON project_folders(folder_path)'
const SCHEMA_PROJECT_FOLDERS_PROJECT_IDX =
  'CREATE INDEX IF NOT EXISTS idx_pf_project ON project_folders(project_local_id)'

const SCHEMA_SUBTASKS = `
CREATE TABLE IF NOT EXISTS subtasks (
  local_id          TEXT PRIMARY KEY,                      -- UUID local_id
  task_local_id     TEXT NOT NULL,                         -- FK→tasks.local_id
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
)`

const SCHEMA_SUBTASKS_IDX =
  'CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_local_id)'

// ---------------------------------------------------------------------------
// DDL — 帳本 2 表（§2.2 punches/notifications：schema 逐字沿用 punchLedger.ts:24-50，
//   只換連線；§2.14b 末尾 nullable ADD COLUMN source_file/source_pos）。
//   ⚠ PunchLedger 既有 SQL（punchIn/punchOut/recordOneshot 的 ON CONFLICT 冪等）一行不改。
// ---------------------------------------------------------------------------

const SCHEMA_PUNCHES = `
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
)`

// 與 punchLedger.ts 的 SCHEMA_PUNCH_TASK_UID_IDX 逐字對齊：
//   去重鍵改為 (task_id, punch_uid) partial index（WHERE task_id IS NOT NULL）。
//   同步 DROP 舊 idx_punch_uid(session_id, punch_uid)，防止 _migrateToTaskUidKey
//   已 DROP 後 ensureSchema 每次重建造成的「索引死灰復燃」地雷（RV4）。
const SCHEMA_PUNCH_UID_IDX =
  'DROP INDEX IF EXISTS idx_punch_uid'
const SCHEMA_PUNCH_TASK_UID_IDX =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_punch_task_uid ON punches(task_id, punch_uid) WHERE task_id IS NOT NULL'

const SCHEMA_NOTIFICATIONS = `
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  category TEXT, severity TEXT,
  title TEXT, body TEXT,
  ref_punch_uid TEXT, session_id TEXT,
  created_at TEXT NOT NULL, read_at TEXT,
  active INTEGER, resolved_at TEXT
)`

// §2.14b 打卡溯源欄：punches 末尾 nullable ADD COLUMN（PunchLedger 既有 SQL 零影響）。
//   source_file = 觸發該 punch 的 JSONL 檔；source_pos = 讀到打卡資訊的行/位移。
//   以「先 CREATE 基礎表（逐字沿用）→ 條件式 ADD COLUMN」實現，避免改動帳本基礎 schema。
const PUNCH_EXTRA_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'source_file', ddl: 'ALTER TABLE punches ADD COLUMN source_file TEXT' },
  { name: 'source_pos', ddl: 'ALTER TABLE punches ADD COLUMN source_pos INTEGER' },
  // 來源 CLI（'claude' | 'codex'）：標記該 punch 由哪個 CLI 監測產生。null=舊列 / 未知。
  { name: 'cli', ddl: 'ALTER TABLE punches ADD COLUMN cli TEXT' },
]


// ---------------------------------------------------------------------------
// DDL — 綁定 2 表（§2.2 / §2.7 milestone_bindings 取代 milestones.json 雙鍵；
//   session_bindings 取代 task_sessions.json；§2.14c session_bindings.monitoring D30）。
// ---------------------------------------------------------------------------

const SCHEMA_MILESTONE_BINDINGS = `
CREATE TABLE IF NOT EXISTS milestone_bindings (
  milestone_local_id TEXT PRIMARY KEY,                     -- FK→milestones.local_id（表化後單鍵，§2.7）
  project_path       TEXT,
  tool               TEXT NOT NULL DEFAULT 'claude',
  custom_command     TEXT,
  legacy_key         TEXT,                                 -- 匯入時原 JSON key（追溯用，D28）
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`

const SCHEMA_SESSION_BINDINGS = `
CREATE TABLE IF NOT EXISTS session_bindings (
  task_local_id  TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'claude',
  project_path   TEXT, label TEXT,
  is_active      INTEGER NOT NULL DEFAULT 0,               -- 每 task 至多一筆 active
  monitoring     INTEGER NOT NULL DEFAULT 0,               -- §2.14c D30：監測持久化 → 啟動自動重建
  first_bound_at TEXT NOT NULL, last_bound_at TEXT NOT NULL,
  PRIMARY KEY (task_local_id, session_id)
)`

const SCHEMA_SESSION_BINDINGS_ACTIVE_IDX =
  'CREATE INDEX IF NOT EXISTS idx_session_bindings_active ON session_bindings(task_local_id) WHERE is_active = 1'
const SCHEMA_SESSION_BINDINGS_MONITORING_IDX =
  'CREATE INDEX IF NOT EXISTS idx_session_bindings_monitoring ON session_bindings(task_local_id) WHERE monitoring = 1'

// ---------------------------------------------------------------------------
// DDL — 設定 1 表 + meta 1 表
// ---------------------------------------------------------------------------

const SCHEMA_APP_SETTINGS = `
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,                             -- AgentOrg/groups 等仍用
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`

const SCHEMA_SCHEMA_META = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
)`

// ---------------------------------------------------------------------------
// DDL — agent_registry（B5：agent 登錄表；加法表，不動 user_version）
//   enabled / remark 為使用者手動設定欄——upsert **不覆寫**（掃描不能洗掉手動值）。
// ---------------------------------------------------------------------------

const SCHEMA_AGENT_REGISTRY = `
CREATE TABLE IF NOT EXISTS agent_registry (
  agent_id     TEXT PRIMARY KEY,
  display_name TEXT,
  title        TEXT,
  team_id      TEXT,
  skill_name   TEXT,
  remark       TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  standardized INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
)`

// agent_registry 末尾加欄（#7 規格化狀態）。新建 DB 由上方 CREATE 直接帶 standardized；
//   存量 DB 不會重跑 CREATE，故以探欄 ADD COLUMN 補建（NOT NULL 必帶 DEFAULT；快速建立 = 0 未規格化）。
const AGENT_REGISTRY_EXTRA_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  {
    name: 'standardized',
    ddl: 'ALTER TABLE agent_registry ADD COLUMN standardized INTEGER NOT NULL DEFAULT 0',
  },
]

// ---------------------------------------------------------------------------
// DDL — AgentTeams embedded conversation metadata
//   訊息內容仍以 Claude/Codex JSONL 為事實來源；此表只存可還原 UI/session 的 metadata。
// ---------------------------------------------------------------------------

const SCHEMA_AGENT_CONV_SESSIONS = `
CREATE TABLE IF NOT EXISTS agent_conv_sessions (
  conversation_id     TEXT PRIMARY KEY,
  label               TEXT NOT NULL,
  kind                TEXT,
  team_id             TEXT,
  agent_name          TEXT,
  cli_id              TEXT NOT NULL,
  cwd                 TEXT NOT NULL,
  initial_prompt      TEXT,
  skill_name          TEXT,
  external_session_id TEXT,
  jsonl_file          TEXT,
  status              TEXT NOT NULL DEFAULT 'running',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
)`

const SCHEMA_AGENT_CONV_SESSIONS_UPDATED_IDX =
  'CREATE INDEX IF NOT EXISTS idx_agent_conv_sessions_updated ON agent_conv_sessions(updated_at DESC)'
const SCHEMA_AGENT_CONV_SESSIONS_TEAM_IDX =
  'CREATE INDEX IF NOT EXISTS idx_agent_conv_sessions_team ON agent_conv_sessions(team_id, kind, updated_at DESC)'

// ---------------------------------------------------------------------------
// DDL — crash-recovery（§2.14a scan_watermarks D29；§2.14d punch_artifacts D31）
// ---------------------------------------------------------------------------

const SCHEMA_SCAN_WATERMARKS = `
CREATE TABLE IF NOT EXISTS scan_watermarks (
  session_id   TEXT PRIMARY KEY,
  jsonl_file   TEXT,
  consumed_pos INTEGER NOT NULL DEFAULT 0,                 -- 已讀位移（仿 conv_state.consumedPos 範式）
  updated_at   TEXT NOT NULL
)`

const SCHEMA_PUNCH_ARTIFACTS = `
CREATE TABLE IF NOT EXISTS punch_artifacts (
  punch_session_id TEXT NOT NULL,
  punch_uid        TEXT NOT NULL,                          -- 關聯 punches/subtasks（既有冪等鍵）
  tool_use_id      TEXT NOT NULL,                          -- toolu_…，回指 JSONL 證據（證據鏈）
  hunk_index       INTEGER NOT NULL DEFAULT 0,             -- 一次 Edit 可有多個 hunk
  file_path        TEXT NOT NULL,
  tool             TEXT NOT NULL,                          -- 'Edit' | 'Write'
  op_type          TEXT,                                   -- Write 才有：'create' | 'update'
  old_start        INTEGER,                                -- Edit hunk 精確起始行號（1-indexed）
  lines_added      INTEGER NOT NULL DEFAULT 0,             -- 精確：hunk lines 中 '+' 行數
  lines_removed    INTEGER NOT NULL DEFAULT 0,             -- 精確：hunk lines 中 '-' 行數
  content_lines    INTEGER,                                -- Write 用：content 總行數（create=精確新增）
  ts               TEXT NOT NULL,                          -- toolUseResult record 時間戳
  PRIMARY KEY (punch_session_id, punch_uid, tool_use_id, hunk_index)
)`

const SCHEMA_PUNCH_ARTIFACTS_IDX =
  'CREATE INDEX IF NOT EXISTS idx_artifacts_file ON punch_artifacts(file_path)'

// ---------------------------------------------------------------------------
// DDL — 對話 cache 3 表（§2.1 D25：併入 teamuq.db；schema 逐字沿用 conversationStore.ts）。
//   ⚠ 版本守門走 schema_meta.parser_version（非 user_version）；不符時**只 DROP 這 3 表**。
//   conv_messages：v6 後整張刪除，僅保留 DROP 守門範圍（不再建，但 DROP 含它防舊版殘留）。
// ---------------------------------------------------------------------------

const SCHEMA_CONV_STATE = `
CREATE TABLE IF NOT EXISTS conv_state (
  file TEXT PRIMARY KEY,
  consumed_pos INTEGER NOT NULL,
  next_seq INTEGER NOT NULL,
  ui_read_seq INTEGER NOT NULL DEFAULT 0,
  end_seen INTEGER NOT NULL DEFAULT 1
)`

const SCHEMA_CONV_SEGMENTS = `
CREATE TABLE IF NOT EXISTS conv_segments (
  file TEXT NOT NULL,
  seg_no INTEGER NOT NULL,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  start_ts TEXT NOT NULL DEFAULT "",
  end_ts TEXT NOT NULL DEFAULT "",
  label TEXT NOT NULL DEFAULT "",
  is_command INTEGER NOT NULL DEFAULT 0,
  msg_count INTEGER NOT NULL DEFAULT 0,
  start_pos INTEGER NOT NULL DEFAULT 0,
  end_pos INTEGER NOT NULL DEFAULT 0,
  head_kind TEXT NOT NULL DEFAULT "other",
  PRIMARY KEY (file, seg_no)
)`

// cache 守門 DROP 範圍（硬限 conv_* 三表；conv_messages 含入防 v5 舊版殘留）。
// export：ConversationStore（自開連線）與 spec 防誤傷測試共用同一白名單常數，
//   確保「parser 版本不符只 DROP 這 3 張表、teamuq.db 其他表完好」由單一來源界定。
export const CONV_CACHE_DROP =
  'DROP TABLE IF EXISTS conv_messages;' +
  'DROP TABLE IF EXISTS conv_state;' +
  'DROP TABLE IF EXISTS conv_segments;'

// ---------------------------------------------------------------------------
// schema 建立 + 版本守門
// ---------------------------------------------------------------------------

/**
 * 確保 punches 末尾溯源欄存在（§2.14b）。逐欄查 table_info，缺則 ADD COLUMN（nullable，
 * PunchLedger 既有 SQL 零影響）。ALTER 無 IF NOT EXISTS，故先探欄。
 */
function ensurePunchExtraColumns(db: Database.Database): void {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(punches)').all() as Array<{ name: string }>).map((c) => c.name),
  )
  for (const { name, ddl } of PUNCH_EXTRA_COLUMNS) {
    if (!cols.has(name)) db.exec(ddl)
  }
}

/**
 * 確保 agent_registry 末尾規格化欄存在（#7 standardized）。逐欄查 table_info，缺則 ADD COLUMN
 * （NOT NULL DEFAULT 0，存量列自動補 0，向後相容）。ALTER 無 IF NOT EXISTS，故先探欄（同上模式）。
 */
function ensureAgentRegistryColumns(db: Database.Database): void {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(agent_registry)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  )
  for (const { name, ddl } of AGENT_REGISTRY_EXTRA_COLUMNS) {
    if (!cols.has(name)) db.exec(ddl)
  }
}

/**
 * 對話 cache 3 表的版本守門（§2.1 / §2.2 / D25）：parser 版本不符時**只 DROP conv_* 三表**重建，
 * 絕不波及其他 16 表。版本鍵存 schema_meta（user_version 留給主 schema，**絕不碰**）。
 *
 * export：D25 起 ConversationStore 自開 teamuq.db 連線時呼叫此函式建表 + 守門
 *   （DDL + 守門 + scoped-drop 單一來源於本檔，repo 與 conv store 共用，不分叉）。
 *   ConversationStore 連線上主 schema 可能尚未建（先於 repo 開檔），故此處先確保
 *   schema_meta 存在（版本鍵的載體），再做守門 —— 不建任何其他主表。
 */
export function ensureConvCacheTables(db: Database.Database): void {
  // schema_meta 是 parser_version 版本鍵的載體；ConversationStore 連線可能先於 repo，
  // 主 schema 尚未建 → 在此 IF NOT EXISTS 確保它存在（與 ensureSchema 同 DDL，重入安全）。
  db.exec(SCHEMA_SCHEMA_META)
  const row = db
    .prepare('SELECT value FROM schema_meta WHERE key = ?')
    .get('parser_version') as { value: string } | undefined
  const stored = row ? Number(row.value) : NaN
  if (stored !== CONV_PARSER_VERSION) {
    // 硬約束：DROP 範圍嚴格限定 conv_* 三表（DROP 字串為常數，不含任何其他表名）。
    db.exec(CONV_CACHE_DROP)
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO schema_meta(key, value, updated_at) VALUES(?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run('parser_version', String(CONV_PARSER_VERSION), now)
  }
  db.exec(SCHEMA_CONV_STATE)
  db.exec(SCHEMA_CONV_SEGMENTS)
}

/**
 * 建全部表 + 索引 + 守門。可重入（全 IF NOT EXISTS / 條件 ADD COLUMN / 版本旗標）。
 * 主 DB 絕不 DROP 重建：user_version 不符時只設版號（破壞性 migration 待後續批次按需補）。
 */
export function ensureSchema(db: Database.Database): void {
  // schema_meta 先建（cache 守門依賴它）。
  db.exec(SCHEMA_SCHEMA_META)

  // 實體表 + 索引（純本地，無遠端欄）
  db.exec(SCHEMA_PROJECTS)
  db.exec(SCHEMA_MILESTONES)
  db.exec(SCHEMA_TASKS)
  db.exec(SCHEMA_TASKS_MILESTONE_IDX)
  // 專案↔資料夾多對多關聯表 + 雙向反查索引（全 IF NOT EXISTS，可重入；存量 DB 自動補建空表）。
  db.exec(SCHEMA_PROJECT_FOLDERS)
  db.exec(SCHEMA_PROJECT_FOLDERS_FOLDER_IDX)
  db.exec(SCHEMA_PROJECT_FOLDERS_PROJECT_IDX)
  db.exec(SCHEMA_SUBTASKS)
  db.exec(SCHEMA_SUBTASKS_IDX)

  // 帳本 2 表（逐字沿用）+ 溯源欄
  db.exec(SCHEMA_PUNCHES)
  db.exec(SCHEMA_PUNCH_UID_IDX)       // DROP INDEX IF EXISTS idx_punch_uid（冪等，防復燃）
  db.exec(SCHEMA_PUNCH_TASK_UID_IDX)  // CREATE UNIQUE INDEX idx_punch_task_uid(task_id,punch_uid) WHERE task_id IS NOT NULL
  db.exec(SCHEMA_NOTIFICATIONS)
  ensurePunchExtraColumns(db)

  // 綁定 2 表
  db.exec(SCHEMA_MILESTONE_BINDINGS)
  db.exec(SCHEMA_SESSION_BINDINGS)
  db.exec(SCHEMA_SESSION_BINDINGS_ACTIVE_IDX)
  db.exec(SCHEMA_SESSION_BINDINGS_MONITORING_IDX)

  // 設定
  db.exec(SCHEMA_APP_SETTINGS)

  // agent_registry（B5 加法表；不動 user_version）
  db.exec(SCHEMA_AGENT_REGISTRY)
  ensureAgentRegistryColumns(db) // standardized 探欄補建（#7；既有表加欄）

  // AgentTeams embedded conversation metadata（可重啟還原側欄與 JSONL 查詢）。
  db.exec(SCHEMA_AGENT_CONV_SESSIONS)
  db.exec(SCHEMA_AGENT_CONV_SESSIONS_UPDATED_IDX)
  db.exec(SCHEMA_AGENT_CONV_SESSIONS_TEAM_IDX)

  // crash-recovery
  db.exec(SCHEMA_SCAN_WATERMARKS)
  db.exec(SCHEMA_PUNCH_ARTIFACTS)
  db.exec(SCHEMA_PUNCH_ARTIFACTS_IDX)

  // 對話 cache 3 表（schema_meta.parser_version 守門，DROP 範圍硬限 conv_*）
  ensureConvCacheTables(db)

  // 主 schema 版本守門：絕不 DROP 重建，僅推進版號（§2.2）。
  const userVersion = (db.pragma('user_version', { simple: true }) as number) ?? 0
  if (userVersion !== SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
}

/**
 * 開 teamuq.db（WAL + busy_timeout）並建 schema。供 repo / 遷移 orchestrator 共用。
 */
export function openTeamuqDb(): Database.Database {
  const p = teamuqDbPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const db = new Database(p)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  ensureSchema(db)
  return db
}
