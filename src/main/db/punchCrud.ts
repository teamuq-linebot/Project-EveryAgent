/**
 * punchCrud.ts — 打卡帳本 punches 表 CRUD module 函式
 *
 * 從 punchLedger.ts 原樣抽出，方法本體一字不改。
 * 接收 db handle 與必要參數；PunchLedger 方法改為 thin delegation。
 *
 * 方法對應：
 *   getPunch             → getPunch(db, taskId, punchUid)
 *   wasPunched           → wasPunched(db, taskId, punchUid)
 *   preloadDoneKeys      → preloadDoneKeys(db, sessionId)
 *   listOpen             → listOpen(db, sessionId)
 *   listPunchesForTask   → listPunchesForTask(db, taskId)
 *   punchIn              → punchIn(db, opts)
 *   setSubtaskId         → setSubtaskId(db, taskId, punchUid, subtaskId)
 *   punchOut             → punchOut(db, opts)
 *   recordOneshot        → recordOneshot(db, opts)
 */

import type Database from 'better-sqlite3';
import type { LedgerRow } from '../monitor/types';
import { isSessionLive } from '../monitor/sessionLiveness';
import { nowIso, _s } from './punchSqlHelpers';

// ---------------------------------------------------------------------------
// getPunch
// ---------------------------------------------------------------------------

/**
 * 取單筆打卡（依 task_id + punch_uid）；不存在 / 失敗 → null。
 * 對應 Python get_punch()。
 */
export function getPunch(
  db: Database.Database,
  taskId: unknown,
  punchUid: unknown,
): Record<string, unknown> | null {
  try {
    const row = db
      .prepare('SELECT * FROM punches WHERE task_id IS ? AND punch_uid = ?')
      .get(_s(taskId), String(punchUid)) as Record<string, unknown> | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// wasPunched
// ---------------------------------------------------------------------------

/**
 * 是否「已打卡」：該筆存在且 status=='done' 或 ok==1。失敗 → false。
 * 對應 Python was_punched()。
 */
export function wasPunched(
  db: Database.Database,
  taskId: unknown,
  punchUid: unknown,
): boolean {
  const rec = getPunch(db, taskId, punchUid);
  if (!rec) return false;
  return rec['status'] === 'done' || rec['ok'] === 1;
}

// ---------------------------------------------------------------------------
// preloadDoneKeys
// ---------------------------------------------------------------------------

/**
 * 回該 session 已 done 的 punch_uid 集合（監測啟動時預載去重）。失敗 → 空 set。
 * 對應 Python preload_done_keys()。
 * IPunchLedger 介面方法。
 */
export function preloadDoneKeys(
  db: Database.Database,
  sessionId: string,
): Set<string> {
  try {
    const rows = db
      .prepare(
        "SELECT punch_uid FROM punches WHERE session_id IS ? AND status = 'done'",
      )
      .all(_s(sessionId)) as Array<{ punch_uid: string | null }>;
    const result = new Set<string>();
    for (const r of rows) {
      if (r.punch_uid != null) result.add(r.punch_uid);
    }
    return result;
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// listOpen
// ---------------------------------------------------------------------------

/**
 * 回該 session 未結算（status='open'）的打卡清單。失敗 → []。
 * 對應 Python list_open()。
 * IPunchLedger 介面方法。
 */
export function listOpen(
  db: Database.Database,
  sessionId: string,
): LedgerRow[] {
  try {
    const rows = db
      .prepare(
        "SELECT * FROM punches WHERE session_id IS ? AND status = 'open' ORDER BY id",
      )
      .all(_s(sessionId)) as LedgerRow[];
    return rows;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// listPunchesForTask
// ---------------------------------------------------------------------------

/**
 * 回該 task_id 的所有打卡紀錄。
 * 排序：NULL（執行中）置頂，ended_at DESC，id DESC。
 * 對應 Python list_punches_for_task()——ORDER BY 一字不差。
 */
export function listPunchesForTask(
  db: Database.Database,
  taskId: unknown,
): Record<string, unknown>[] {
  try {
    const rows = db
      .prepare(
        'SELECT p.*, s.name AS subtask_name, ' +
        's.description AS subtask_description, ' +
        's.start_time AS subtask_start_time, ' +
        's.end_time AS subtask_end_time, ' +
        's.duration AS subtask_duration, ' +
        's.is_settled AS subtask_is_settled ' +
        'FROM punches p ' +
        'LEFT JOIN subtasks s ON s.local_id = p.subtask_id ' +
        'WHERE p.task_id IS ? ' +
        'ORDER BY (p.ended_at IS NULL) DESC, p.ended_at DESC, p.id DESC',
      )
      .all(_s(taskId)) as Record<string, unknown>[];
    // 顯示層 transform（不寫 DB）：status='open' 且 session 不在線 → 回傳物件 status 改 'stale'
    return rows.map((row) => {
      if (row['status'] === 'open') {
        const sid = typeof row['session_id'] === 'string' ? row['session_id'] : null;
        if (sid !== null && !isSessionLive(sid)) {
          return { ...row, status: 'stale' };
        }
      }
      return row;
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// punchIn
// ---------------------------------------------------------------------------

/**
 * 寫一筆 status='open'（去重：同 task_id+punch_uid 已存在則不覆蓋）。
 * INSERT ... ON CONFLICT(task_id,punch_uid) DO NOTHING 保證冪等。
 * 對應 Python punch_in()。
 * IPunchLedger 介面方法。
 */
export function punchIn(
  db: Database.Database,
  opts: {
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
    /** 來源 CLI（'claude' | 'codex'）：標記該 punch 由哪個 CLI 監測產生（可選）。 */
    cli?: string | null;
  },
): void {
  const now = nowIso();
  try {
    db
      .prepare(
        'INSERT INTO punches ' +
        '(punch_uid, session_id, task_id, type, name, started_at, ' +
        ' subtask_id, source_file, source_pos, cli, status, created_at, updated_at) ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?) " +
        'ON CONFLICT(task_id, punch_uid) WHERE task_id IS NOT NULL DO NOTHING',
      )
      .run(
        String(opts.punch_uid),
        _s(opts.session_id),
        _s(opts.task_id),
        opts.type ?? null,
        opts.name,
        _s(opts.started_at),
        opts.subtask_id ?? null,
        opts.source_file ?? null,
        opts.source_pos ?? null,
        opts.cli ?? null,
        now,
        now,
      );
  } catch (err) {
    console.error('[PunchLedger] punch_in failed:', err);
  }
}

// ---------------------------------------------------------------------------
// setSubtaskId
// ---------------------------------------------------------------------------

/**
 * 補後端回的 subtask_id（punch-in 後）。
 * 對應 Python set_subtask_id()。
 */
export function setSubtaskId(
  db: Database.Database,
  taskId: unknown,
  punchUid: unknown,
  subtaskId: unknown,
): boolean {
  try {
    const info = db
      .prepare(
        'UPDATE punches SET subtask_id = ?, updated_at = ? ' +
        'WHERE task_id IS ? AND punch_uid = ?',
      )
      .run(_s(subtaskId), nowIso(), _s(taskId), String(punchUid));
    return info.changes > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// punchOut
// ---------------------------------------------------------------------------

/**
 * 結算同筆 → status='done'、填 ended_at/hours/description/ok/error/updated_at。
 * 若無 session_id，僅依 punch_uid 查（punch_uid 為 UUID，全局唯一）。
 * 對應 Python punch_out()。
 * IPunchLedger 介面方法。
 */
export function punchOut(
  db: Database.Database,
  opts: {
    punch_uid: string;
    session_id?: string | null;
    subtask_id?: string | null;
    ended_at?: unknown;
    hours?: number;
    description?: string | null;
    ok?: number;
    error?: string | null;
  },
): void {
  try {
    const okVal = opts.ok !== undefined ? opts.ok : 1;
    if (opts.session_id != null) {
      db
        .prepare(
          'UPDATE punches SET ended_at = ?, hours = ?, description = ?, ' +
          "ok = ?, error = ?, status = 'done', updated_at = ? " +
          'WHERE session_id IS ? AND punch_uid = ?',
        )
        .run(
          _s(opts.ended_at),
          opts.hours ?? null,
          opts.description ?? null,
          okVal,
          opts.error ?? null,
          nowIso(),
          _s(opts.session_id),
          String(opts.punch_uid),
        );
    } else {
      // session_id 未提供：依 punch_uid 單獨查（punch_uid = UUID，全局唯一）
      db
        .prepare(
          'UPDATE punches SET ended_at = ?, hours = ?, description = ?, ' +
          "ok = ?, error = ?, status = 'done', updated_at = ? " +
          'WHERE punch_uid = ?',
        )
        .run(
          _s(opts.ended_at),
          opts.hours ?? null,
          opts.description ?? null,
          okVal,
          opts.error ?? null,
          nowIso(),
          String(opts.punch_uid),
        );
    }
  } catch (err) {
    console.error('[PunchLedger] punch_out failed:', err);
  }
}

// ---------------------------------------------------------------------------
// recordOneshot
// ---------------------------------------------------------------------------

/**
 * 一次寫齊 status='done'（fallback：拿不到後端 id 時用）。
 * ON CONFLICT(task_id, punch_uid) WHERE task_id IS NOT NULL DO UPDATE upsert：
 *   同 task_id+punch_uid 已存在則更新，created_at 保留首次值。
 * 對應 Python record_oneshot()。
 * IPunchLedger 介面方法。
 */
export function recordOneshot(
  db: Database.Database,
  opts: {
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
    /** 來源 CLI（'claude' | 'codex'）：標記該 punch 由哪個 CLI 監測產生（可選）。 */
    cli?: string | null;
  },
): void {
  const now = nowIso();
  try {
    db
      .prepare(
        'INSERT INTO punches ' +
        '(punch_uid, session_id, task_id, type, name, description, ' +
        ' started_at, ended_at, hours, subtask_id, source_file, source_pos, cli, ' +
        ' status, ok, error, created_at, updated_at) ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, ?, ?) " +
        'ON CONFLICT(task_id, punch_uid) WHERE task_id IS NOT NULL DO UPDATE SET ' +
        '  task_id=excluded.task_id, type=excluded.type, ' +
        '  name=excluded.name, description=excluded.description, ' +
        '  started_at=excluded.started_at, ended_at=excluded.ended_at, ' +
        '  hours=excluded.hours, subtask_id=excluded.subtask_id, ' +
        '  source_file=COALESCE(excluded.source_file, source_file), ' +
        '  source_pos=COALESCE(excluded.source_pos, source_pos), ' +
        '  cli=COALESCE(excluded.cli, cli), ' +
        "  status='done', ok=excluded.ok, error=excluded.error, " +
        '  updated_at=excluded.updated_at',
      )
      .run(
        String(opts.punch_uid),
        _s(opts.session_id),
        _s(opts.task_id),
        opts.type ?? null,
        opts.name,
        opts.description ?? null,
        _s(opts.started_at),
        _s(opts.ended_at),
        opts.hours ?? null,
        opts.subtask_id ?? null,
        opts.source_file ?? null,
        opts.source_pos ?? null,
        opts.cli ?? null,
        opts.ok !== undefined ? opts.ok : 1,
        opts.error ?? null,
        now,
        now,
      );
  } catch (err) {
    console.error('[PunchLedger] record_oneshot failed:', err);
  }
}
