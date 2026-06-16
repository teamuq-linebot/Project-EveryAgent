/**
 * punchNotifications.ts — 打卡帳本 notifications 表 CRUD module 函式
 *
 * 從 punchLedger.ts 原樣抽出，方法本體一字不改。
 * 接收 db handle 與必要參數；PunchLedger 方法改為 thin delegation。
 *
 * 方法對應：
 *   addEvent             → addEvent(db, category, severity, title, body, opts?)
 *   openCondition        → openCondition(db, category, opts?)
 *   resolveCondition     → resolveCondition(db, category, opts?)
 *   listActiveConditions → listActiveConditions(db, sessionId?)
 *   listUnread           → listUnread(db, sessionId?, limit?)
 *   markRead             → markRead(db, notifId)
 */

import type Database from 'better-sqlite3';
import { nowIso, _s } from './punchSqlHelpers';

// ---------------------------------------------------------------------------
// addEvent
// ---------------------------------------------------------------------------

/**
 * 寫一筆 event 通知（type='event'，active=NULL）。回新 id；失敗 → null。
 * 對應 Python add_event()。
 */
export function addEvent(
  db: Database.Database,
  category: string | null,
  severity: string | null,
  title: string | null,
  body: string | null,
  opts?: { ref_punch_uid?: string | null; session_id?: unknown },
): number | null {
  try {
    const info = db
      .prepare(
        'INSERT INTO notifications ' +
        '(type, category, severity, title, body, ref_punch_uid, ' +
        ' session_id, created_at, active) ' +
        "VALUES ('event', ?, ?, ?, ?, ?, ?, ?, NULL)",
      )
      .run(
        category,
        severity,
        title,
        body,
        opts?.ref_punch_uid ?? null,
        _s(opts?.session_id),
        nowIso(),
      );
    return info.lastInsertRowid as number;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// openCondition
// ---------------------------------------------------------------------------

/**
 * 開啟一個 condition（type='condition'，active=1）。
 * 去重：同 (category, session_id) 已有 active 條件則不重開，回現有 id。
 * 對應 Python open_condition()。
 */
export function openCondition(
  db: Database.Database,
  category: string,
  opts?: {
    severity?: string | null;
    title?: string | null;
    body?: string | null;
    session_id?: unknown;
    ref_punch_uid?: string | null;
  },
): number | null {
  const sid = _s(opts?.session_id);
  try {
    const existing = db
      .prepare(
        "SELECT id FROM notifications WHERE type='condition' AND active=1 " +
        'AND category = ? AND session_id IS ?',
      )
      .get(category, sid) as { id: number } | undefined;
    if (existing != null) return existing.id;

    const info = db
      .prepare(
        'INSERT INTO notifications ' +
        '(type, category, severity, title, body, ref_punch_uid, ' +
        ' session_id, created_at, active) ' +
        "VALUES ('condition', ?, ?, ?, ?, ?, ?, ?, 1)",
      )
      .run(
        category,
        opts?.severity ?? null,
        opts?.title ?? null,
        opts?.body ?? null,
        opts?.ref_punch_uid ?? null,
        sid,
        nowIso(),
      );
    return info.lastInsertRowid as number;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// resolveCondition
// ---------------------------------------------------------------------------

/**
 * 把符合 (category, session_id) 的 active 條件設 active=0、resolved_at=now。
 * 對應 Python resolve_condition()。
 */
export function resolveCondition(
  db: Database.Database,
  category: string,
  opts?: { session_id?: unknown },
): boolean {
  try {
    const info = db
      .prepare(
        'UPDATE notifications SET active=0, resolved_at=? ' +
        "WHERE type='condition' AND active=1 " +
        'AND category = ? AND session_id IS ?',
      )
      .run(nowIso(), category, _s(opts?.session_id));
    return info.changes > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// listActiveConditions
// ---------------------------------------------------------------------------

/**
 * 回 active 的 condition 通知清單；session_id=null → 全部。
 * 對應 Python list_active_conditions()。
 */
export function listActiveConditions(
  db: Database.Database,
  sessionId?: unknown,
): Record<string, unknown>[] {
  try {
    if (sessionId == null) {
      return db
        .prepare(
          "SELECT * FROM notifications WHERE type='condition' AND active=1 ORDER BY id",
        )
        .all() as Record<string, unknown>[];
    }
    return db
      .prepare(
        "SELECT * FROM notifications WHERE type='condition' AND active=1 " +
        'AND session_id IS ? ORDER BY id',
      )
      .all(_s(sessionId)) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// listUnread
// ---------------------------------------------------------------------------

/**
 * 回未讀（read_at IS NULL）通知，最新在前；session_id=null → 全部。
 * 對應 Python list_unread()。
 */
export function listUnread(
  db: Database.Database,
  sessionId?: unknown,
  limit = 50,
): Record<string, unknown>[] {
  const lim = typeof limit === 'number' && isFinite(limit) ? limit : 50;
  try {
    if (sessionId == null) {
      return db
        .prepare(
          'SELECT * FROM notifications WHERE read_at IS NULL ' +
          'ORDER BY id DESC LIMIT ?',
        )
        .all(lim) as Record<string, unknown>[];
    }
    return db
      .prepare(
        'SELECT * FROM notifications WHERE read_at IS NULL AND session_id IS ? ' +
        'ORDER BY id DESC LIMIT ?',
      )
      .all(_s(sessionId), lim) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// markRead
// ---------------------------------------------------------------------------

/**
 * 把一筆通知標記已讀（read_at=now）。
 * 對應 Python mark_read()。
 */
export function markRead(db: Database.Database, notifId: unknown): boolean {
  try {
    const id = Number(notifId);
    if (!isFinite(id)) return false;
    const info = db
      .prepare(
        'UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL',
      )
      .run(nowIso(), id);
    return info.changes > 0;
  } catch {
    return false;
  }
}
