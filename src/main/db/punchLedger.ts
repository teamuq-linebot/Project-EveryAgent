/**
 * punchLedger.ts — 打卡 SQLite 帳本（better-sqlite3）
 *
 * 忠實移植自 Python:
 *   teamuq/persistence/punch_ledger.py (530 行 PunchLedger)
 *
 * DB 路徑（rev10 / Phase 4.0d）：`~/.teamuq/teamuq.db`（單一 DB 整併）。
 *   原 `punches.db` 退役 — punches/notifications 表整併進 teamuq.db（schema 逐字沿用、
 *   只換連線；§2.2）。預設路徑改用 repo 的 `teamuqDbPath()`（同一來源、吃 TEAMUQ_HOME
 *   測試隔離）。本檔的全部 SQL（punchIn/punchOut/recordOneshot 的 ON CONFLICT 冪等）一行不改。
 *   punches/notifications 表已由 repo.ensureSchema 逐字建立；此處 `_ensureSchema` 的
 *   `CREATE TABLE IF NOT EXISTS` 與之 byte 相同、冪等無衝突。constructor 仍接受
 *   `dbPath` 覆寫（測試用 tmp DB），介面不變。
 * Schema / CREATE TABLE / INDEX 照搬 Python 原版。
 * better-sqlite3 是同步 API；單一連線共用（Node.js 單線程，無跨線程問題）。
 * WAL pragma 照設；busy_timeout=5000。
 * 容錯：所有公開方法全程 try/catch，讀類失敗回 [] / null / false / Set()。
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { IPunchLedger, LedgerRow } from '../monitor/types';
// schema / DDL 字串常數與殭屍閾值（拆出至 punchSchema.ts；本檔以 import 取回、值不變）。
import {
  SCHEMA_PUNCHES,
  SCHEMA_NOTIFICATIONS,
  SCHEMA_SUBTASKS,
  SCHEMA_SUBTASKS_IDX,
} from './punchSchema';
// module-level 純函式 helper（拆出至 punchSqlHelpers.ts；引用方式不變）。
import { defaultDbPath } from './punchSqlHelpers';
// punches 表 CRUD module 函式（自本檔拆出；thin delegation）。
import {
  getPunch as _getPunch,
  wasPunched as _wasPunched,
  preloadDoneKeys as _preloadDoneKeys,
  listOpen as _listOpen,
  listPunchesForTask as _listPunchesForTask,
  punchIn as _punchIn,
  setSubtaskId as _setSubtaskId,
  punchOut as _punchOut,
  recordOneshot as _recordOneshot,
} from './punchCrud';
// notifications 表 CRUD module 函式（自本檔拆出；thin delegation）。
import {
  addEvent as _addEvent,
  openCondition as _openCondition,
  resolveCondition as _resolveCondition,
  listActiveConditions as _listActiveConditions,
  listUnread as _listUnread,
  markRead as _markRead,
} from './punchNotifications';
// schema 補欄 / 遷移 module 函式（自本檔拆出；thin delegation）。
import {
  ensurePunchSourceColumns as _ensurePunchSourceColumns,
  migrateToTaskUidKey as _migrateToTaskUidKey,
  migrateZombieOpenRows as _migrateZombieOpenRows,
} from './punchMigrations';

// ---------------------------------------------------------------------------
// PunchLedger
// ---------------------------------------------------------------------------

export class PunchLedger implements IPunchLedger {
  private readonly _db: Database.Database;

  /**
   * 建立帳本。
   * @param dbPath 自訂 DB 路徑；預設 ~/.teamuq/punches.db。
   */
  constructor(dbPath?: string) {
    const path = dbPath ?? defaultDbPath();
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      // mkdir 失敗不致命
    }
    this._db = new Database(path);
    this._ensureSchema();
  }

  // ── 連線 / schema ──────────────────────────────────────────────────────

  private _ensureSchema(): void {
    try {
      this._db.pragma('journal_mode=WAL');
      this._db.pragma('busy_timeout=5000');
      this._db.exec(SCHEMA_PUNCHES);
      this._db.exec(SCHEMA_NOTIFICATIONS);
      this._db.exec(SCHEMA_SUBTASKS);
      this._db.exec(SCHEMA_SUBTASKS_IDX);
      this._ensurePunchSourceColumns();
      // 遷移：清除重複列 → 建新去重索引 → DROP 舊索引（冪等）
      this._migrateToTaskUidKey();
      // 遷移：殭屍 open 列清理（冪等；前提：_ensureSchema 在 constructor 中執行，早於任何 monitor start）
      this._migrateZombieOpenRows();
    } catch (err) {
      // schema 建立失敗只記，不崩
      console.error('[PunchLedger] ensure_schema failed:', err);
    }
  }

  private _migrateToTaskUidKey(): void {
    _migrateToTaskUidKey(this._db);
  }

  private _migrateZombieOpenRows(): void {
    _migrateZombieOpenRows(this._db);
  }

  private _ensurePunchSourceColumns(): void {
    _ensurePunchSourceColumns(this._db);
  }

  // ── 打卡：讀 / 去重 ──────────────────────────────────────────────────

  /**
   * 取單筆打卡（依 task_id + punch_uid）；不存在 / 失敗 → null。
   * 對應 Python get_punch()。
   */
  getPunch(taskId: unknown, punchUid: unknown): Record<string, unknown> | null {
    return _getPunch(this._db, taskId, punchUid);
  }

  /**
   * 是否「已打卡」：該筆存在且 status=='done' 或 ok==1。失敗 → false。
   * 對應 Python was_punched()。
   */
  wasPunched(taskId: unknown, punchUid: unknown): boolean {
    return _wasPunched(this._db, taskId, punchUid);
  }

  /**
   * 回該 session 已 done 的 punch_uid 集合（監測啟動時預載去重）。失敗 → 空 set。
   * 對應 Python preload_done_keys()。
   * IPunchLedger 介面方法。
   */
  preloadDoneKeys(sessionId: string): Set<string> {
    return _preloadDoneKeys(this._db, sessionId);
  }

  /**
   * 回該 session 未結算（status='open'）的打卡清單。失敗 → []。
   * 對應 Python list_open()。
   * IPunchLedger 介面方法。
   */
  listOpen(sessionId: string): LedgerRow[] {
    return _listOpen(this._db, sessionId);
  }

  /**
   * 回該 task_id 的所有打卡紀錄。
   * 排序：NULL（執行中）置頂，ended_at DESC，id DESC。
   * 對應 Python list_punches_for_task()——ORDER BY 一字不差。
   */
  listPunchesForTask(taskId: unknown): Record<string, unknown>[] {
    return _listPunchesForTask(this._db, taskId);
  }

  // ── 打卡：兩段式寫 ──────────────────────────────────────────────────

  /**
   * 寫一筆 status='open'（去重：同 task_id+punch_uid 已存在則不覆蓋）。
   * INSERT ... ON CONFLICT(task_id,punch_uid) DO NOTHING 保證冪等。
   * 對應 Python punch_in()。
   * IPunchLedger 介面方法。
   */
  punchIn(opts: {
    punch_uid: string;
    session_id: string;
    task_id: unknown;
    name: string;
    type?: string;
    started_at?: unknown;
    subtask_id?: string | null;
    /** §2.14b 溯源欄（D29）：觸發該 punch 的 JSONL 檔（可選）。 */
    source_file?: string | null;
    /** §2.14b 溯源欄（D29）：讀到打卡資訊的行/位移（可選）。 */
    source_pos?: number | null;
  }): void {
    _punchIn(this._db, opts);
  }

  /**
   * 補後端回的 subtask_id（punch-in 後）。
   * 對應 Python set_subtask_id()。
   */
  setSubtaskId(taskId: unknown, punchUid: unknown, subtaskId: unknown): boolean {
    return _setSubtaskId(this._db, taskId, punchUid, subtaskId);
  }

  /**
   * 結算同筆 → status='done'、填 ended_at/hours/description/ok/error/updated_at。
   * 若無 session_id，僅依 punch_uid 查（punch_uid 為 UUID，全局唯一）。
   * 對應 Python punch_out()。
   * IPunchLedger 介面方法。
   */
  punchOut(opts: {
    punch_uid: string;
    session_id?: string | null;
    subtask_id?: string | null;
    ended_at?: unknown;
    hours?: number;
    description?: string | null;
    ok?: number;
    error?: string | null;
  }): void {
    _punchOut(this._db, opts);
  }

  /**
   * 一次寫齊 status='done'（fallback：拿不到後端 id 時用）。
   * ON CONFLICT(task_id, punch_uid) WHERE task_id IS NOT NULL DO UPDATE upsert：
   *   同 task_id+punch_uid 已存在則更新，created_at 保留首次值。
   * 對應 Python record_oneshot()。
   * IPunchLedger 介面方法。
   */
  recordOneshot(opts: {
    punch_uid: string;
    session_id: string;
    task_id: unknown;
    name: string;
    type?: string;
    started_at?: unknown;
    ended_at?: unknown;
    hours?: number;
    subtask_id?: string | null;
    description?: string | null;
    ok?: number;
    error?: string | null;
    /** §2.14b 溯源欄（D29）：觸發該 punch 的 JSONL 檔（可選）。 */
    source_file?: string | null;
    /** §2.14b 溯源欄（D29）：讀到打卡資訊的行/位移（可選）。 */
    source_pos?: number | null;
  }): void {
    _recordOneshot(this._db, opts);
  }

  // ── 通知：event ──────────────────────────────────────────────────────

  /**
   * 寫一筆 event 通知（type='event'，active=NULL）。回新 id；失敗 → null。
   * 對應 Python add_event()。
   */
  addEvent(
    category: string | null,
    severity: string | null,
    title: string | null,
    body: string | null,
    opts?: { ref_punch_uid?: string | null; session_id?: unknown },
  ): number | null {
    return _addEvent(this._db, category, severity, title, body, opts);
  }

  // ── 通知：condition（持續狀態，去重 + 解除）────────────────────────

  /**
   * 開啟一個 condition（type='condition'，active=1）。
   * 去重：同 (category, session_id) 已有 active 條件則不重開，回現有 id。
   * 對應 Python open_condition()。
   */
  openCondition(
    category: string,
    opts?: {
      severity?: string | null;
      title?: string | null;
      body?: string | null;
      session_id?: unknown;
      ref_punch_uid?: string | null;
    },
  ): number | null {
    return _openCondition(this._db, category, opts);
  }

  /**
   * 把符合 (category, session_id) 的 active 條件設 active=0、resolved_at=now。
   * 對應 Python resolve_condition()。
   */
  resolveCondition(category: string, opts?: { session_id?: unknown }): boolean {
    return _resolveCondition(this._db, category, opts);
  }

  /**
   * 回 active 的 condition 通知清單；session_id=null → 全部。
   * 對應 Python list_active_conditions()。
   */
  listActiveConditions(sessionId?: unknown): Record<string, unknown>[] {
    return _listActiveConditions(this._db, sessionId);
  }

  // ── 通知：未讀 / 標記已讀 ──────────────────────────────────────────

  /**
   * 回未讀（read_at IS NULL）通知，最新在前；session_id=null → 全部。
   * 對應 Python list_unread()。
   */
  listUnread(sessionId?: unknown, limit = 50): Record<string, unknown>[] {
    return _listUnread(this._db, sessionId, limit);
  }

  /**
   * 把一筆通知標記已讀（read_at=now）。
   * 對應 Python mark_read()。
   */
  markRead(notifId: unknown): boolean {
    return _markRead(this._db, notifId);
  }

  /**
   * 關閉 DB 連線（測試 / 清理用）。
   */
  close(): void {
    try {
      this._db.close();
    } catch {
      // 靜默
    }
  }
}

// ---------------------------------------------------------------------------
// 向後相容 re-export（barrel 鐵則）：被搬至 punchSchema.ts / punchSqlHelpers.ts 的符號
//   從原 import path `./db/punchLedger` 仍可達。目前唯一 consumer（backend.ts）只取
//   PunchLedger，但保留此再匯出以防未來有人從原 path 取這些符號。各符號名互不重疊，
//   與 `export class PunchLedger` 無命名衝突。
// ---------------------------------------------------------------------------

export * from './punchSchema';
export { defaultDbPath, nowIso, _s } from './punchSqlHelpers';
