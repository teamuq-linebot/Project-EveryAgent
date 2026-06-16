/**
 * punchMigrations.ts — 打卡帳本 schema 補欄 / 遷移 module 函式
 *
 * 從 punchLedger.ts 原樣抽出，方法本體一字不改。
 * 接收 db handle 與必要參數；PunchLedger 方法改為 thin delegation。
 *
 * 方法對應：
 *   _ensurePunchSourceColumns → ensurePunchSourceColumns(db)
 *   _migrateToTaskUidKey      → migrateToTaskUidKey(db)
 *   _migrateZombieOpenRows    → migrateZombieOpenRows(db)
 */

import type Database from 'better-sqlite3';
import {
  STALE_THRESHOLD_MS,
  SCHEMA_PUNCH_TASK_UID_IDX,
  DROP_OLD_SESSION_UID_IDX,
  PUNCH_EXTRA_COLUMNS,
} from './punchSchema';
import { nowIso } from './punchSqlHelpers';

// ---------------------------------------------------------------------------
// ensurePunchSourceColumns
// ---------------------------------------------------------------------------

/**
 * 確保 punches 末尾溯源欄（source_file/source_pos）存在（§2.14b）。
 * 逐欄查 table_info，缺則 ADD COLUMN（nullable，既有 SQL 零影響）。
 * 與 repo.ensureSchema → ensurePunchExtraColumns 冪等無衝突（同欄名 / 同型別）。
 */
export function ensurePunchSourceColumns(db: Database.Database): void {
  try {
    const cols = new Set(
      (db.prepare('PRAGMA table_info(punches)').all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    for (const { name, ddl } of PUNCH_EXTRA_COLUMNS) {
      if (!cols.has(name)) db.exec(ddl);
    }
  } catch {
    // 探欄 / ALTER 失敗只記性容錯，不崩（溯源欄為附加，缺則 punchIn 略寫）。
  }
}

// ---------------------------------------------------------------------------
// migrateToTaskUidKey
// ---------------------------------------------------------------------------

/**
 * 啟動時遷移（冪等）：
 *   a. 清重複：同 (task_id, punch_uid) 多列 → 保留 id 最小（最早）那筆，其餘 DELETE。
 *   b. 建新 UNIQUE INDEX (task_id, punch_uid) WHERE task_id IS NOT NULL（partial index）。
 *   c. DROP 舊 idx_punch_uid(session_id, punch_uid)，避免跨 session 同 uid 的合法
 *      upsert 因舊索引衝突失敗。
 * 全部包在同一 transaction，保持原子性。
 */
export function migrateToTaskUidKey(db: Database.Database): void {
  try {
    db.transaction(() => {
      // a. 刪除重複列（保留每組 (task_id, punch_uid) 中 id 最小的那筆）
      db.exec(
        'DELETE FROM punches WHERE id NOT IN (' +
        '  SELECT MIN(id) FROM punches GROUP BY task_id, punch_uid' +
        ')',
      );
      // b. 建新 UNIQUE INDEX（冪等，IF NOT EXISTS）
      db.exec(SCHEMA_PUNCH_TASK_UID_IDX);
      // c. DROP 舊索引（IF EXISTS，冪等）
      db.exec(DROP_OLD_SESSION_UID_IDX);
    })();
  } catch (err) {
    console.error('[PunchLedger] _migrateToTaskUidKey failed:', err);
  }
}

// ---------------------------------------------------------------------------
// migrateZombieOpenRows
// ---------------------------------------------------------------------------

/**
 * 啟動時遷移（冪等）：清理殭屍 open 列。
 *
 * (a) 有 done 配對的 open 列（同 task_id/name/started_at 已有 status='done' 列）：
 *   - 用 open 列的 subtask_id（精準定位，不碰 done 列的 subtask）：
 *     純本地 schema（無雲端欄）→ 直接硬刪
 *   - 刪除該 open 帳本列
 *
 * (b) 孤兒 open（無 done 配對）：三道誤殺閘全過才標 status='stale'：
 *   - created_at < now - STALE_THRESHOLD_MS（24h）
 *   - started_at < now - STALE_THRESHOLD_MS（24h）
 *   - NOT EXISTS 同 task_id/name/started_at 的 done 列
 *   - 孤兒的 loc: subtask 不動
 *
 * 前提：此方法在 _ensureSchema 中被呼叫，_ensureSchema 在 constructor 執行，
 * 早於任何 monitor start，因此遷移時無其他 punch 寫入並行。
 *
 * 時間欄格式：ISO 8601 字串（nowIso() 輸出），SQLite 可直接字串大小比較。
 */
export function migrateZombieOpenRows(db: Database.Database): void {
  try {
    const nowMs = Date.now();
    const thresholdIso = new Date(nowMs - STALE_THRESHOLD_MS).toISOString().replace(/\.\d+Z$/, '.000Z');

    db.transaction(() => {
      // ── (a) 有 done 配對的 open 列 ─────────────────────────────────
      // 撈出所有 open 列（subtask_id 為 loc:... 前綴），且同 task_id/name/started_at 有 done 配對
      const pairedOpenRows = db.prepare(
        "SELECT p.id AS punch_id, p.subtask_id " +
        "FROM punches p " +
        "WHERE p.status = 'open' " +
        "  AND p.name IS NOT NULL AND p.started_at IS NOT NULL " +
        "  AND EXISTS (" +
        "    SELECT 1 FROM punches d " +
        "    WHERE d.status = 'done' " +
        "      AND d.task_id IS p.task_id " +
        "      AND d.name IS p.name " +
        "      AND d.started_at IS p.started_at " +
        "  )"
      ).all() as Array<{ punch_id: number; subtask_id: string | null }>;

      for (const row of pairedOpenRows) {
        const sid = row.subtask_id;
        if (sid != null) {
          // 純本地 schema：subtasks 無雲端欄，直接硬刪（不再需判 remote_id / sync_enabled）
          const subExists = db.prepare(
            "SELECT 1 FROM subtasks WHERE local_id = ?"
          ).get(sid);

          if (subExists != null) {
            db.prepare("DELETE FROM subtasks WHERE local_id = ?").run(sid);
          }
        }
        // 刪除該 open 帳本列
        db.prepare("DELETE FROM punches WHERE id = ?").run(row.punch_id);
      }

      // ── (b) 孤兒 open（無 done 配對）→ 三閘全過才標 stale ──────────
      // 三道誤殺閘：
      //   1. created_at < thresholdIso
      //   2. started_at < thresholdIso（started_at 為字串，IS 用於 NULL-safe；
      //      NULL started_at 不通過閘，不會誤標）
      //   3. NOT EXISTS 同 task_id/name/started_at 的 done 列
      db.prepare(
        "UPDATE punches SET status='stale', updated_at=? " +
        "WHERE status = 'open' " +
        "  AND created_at < ? " +
        "  AND started_at IS NOT NULL AND started_at < ? " +
        "  AND NOT EXISTS (" +
        "    SELECT 1 FROM punches d " +
        "    WHERE d.status = 'done' " +
        "      AND d.task_id IS punches.task_id " +
        "      AND d.name IS punches.name " +
        "      AND d.started_at IS punches.started_at " +
        "  )"
      ).run(nowIso(), thresholdIso, thresholdIso);
    })();
  } catch (err) {
    console.error('[PunchLedger] _migrateZombieOpenRows failed:', err);
  }
}
