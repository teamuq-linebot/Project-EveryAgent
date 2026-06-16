/**
 * punchLedgerSubtaskJoin.spec.ts — PunchLedger.listPunchesForTask LEFT JOIN subtasks 行為測試
 *
 * 純本地版：punchCrud.ts 的 SQL 使用：
 *   LEFT JOIN subtasks s ON s.local_id = p.subtask_id
 *   （只有 臂 A，純本地無 LocBackfill 概念，punches.subtask_id 恆為 local_id）
 *
 * 已移除（雲端同步概念）：
 *   TJ6: LocBackfill flush 後臂 B（remote_id）命中 — 純本地無此路徑
 *   TJ7: OR 兩臂並存 — 純本地只有臂 A
 *   TJ9: sync 欄位（subtask_remote_id/dirty/pending_op/sync_enabled）— 純本地不 SELECT 這四欄
 *   TJ10: 四個 sync 欄位皆 null — 同上，欄位不存在
 *
 * 保留案例：
 *  TJ1: punch 有對應 subtask → 回傳列含正確 subtask_name（臂 A 命中）
 *  TJ2: punch.subtask_id = null → subtask_name 為 null（LEFT JOIN 不丟列）
 *  TJ3: punch.subtask_id 指向不存在的 subtask → 列仍在、subtask_name 為 null
 *  TJ4: 排序：未結束（ended_at NULL）在前，其餘 ended_at DESC
 *  TJ5: task_id 過濾正確（別的 task 的 punch 不混入）
 *  TJ8: _ensureSchema 自建路徑 → 不靠 helper CREATE TABLE，純靠 new PunchLedger() 建表後 INSERT + JOIN 成功
 *  TJ11: 詳情欄位擴充——
 *        subtask_description / subtask_start_time / subtask_end_time / subtask_duration / subtask_is_settled
 *    TJ11a: punch 對應的 subtask 有五欄值 → 五欄皆正確帶出
 *    TJ11b: punch 對應的 subtask 五欄皆 NULL → 五欄皆 null（LEFT JOIN 仍命中）
 *    TJ11c: punch 無對應 subtask（subtask_id=null）→ 五欄皆 null（LEFT JOIN 無命中）
 *
 * ⚠️  PunchLedger._ensureSchema() 已自建 subtasks 表（punchLedger.ts 的 SCHEMA_SUBTASKS* 常數）。
 *     多數 fixture 以 helper 連線補插資料（INSERT only，不需 CREATE TABLE）。
 *     TJ8 完全不靠 helper 建表，直接驗證 _ensureSchema 自建路徑。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import { PunchLedger } from '../src/main/db/punchLedger';

// ---------------------------------------------------------------------------
// 測試輔助
// ---------------------------------------------------------------------------

let _dbPath: string;
let _ledger: PunchLedger;
let _helper: Database.Database; // 輔助連線：僅插 fixture rows（subtasks 表由 _ensureSchema 自建）

/**
 * 建立獨立 tmp DB。
 * PunchLedger._ensureSchema() 已自建 subtasks 表，helper 連線僅用於 INSERT fixture rows。
 * 返回三者，呼叫端負責 afterEach 清理。
 */
function freshFixture(): { ledger: PunchLedger; helper: Database.Database; dbPath: string } {
  const dbPath = join(
    tmpdir(),
    `punch_join_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
  );
  const ledger = new PunchLedger(dbPath);
  // _ensureSchema 已建 subtasks 表；helper 只做 INSERT，不需再 CREATE TABLE
  const helper = new Database(dbPath);
  return { ledger, helper, dbPath };
}

beforeEach(() => {
  const f = freshFixture();
  _dbPath = f.dbPath;
  _ledger = f.ledger;
  _helper = f.helper;
});

afterEach(() => {
  try { _helper.close(); } catch { /* ignore */ }
  try { _ledger.close(); } catch { /* ignore */ }
  if (existsSync(_dbPath)) {
    try { rmSync(_dbPath); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// TJ1: punch 有對應 subtask → 回傳列含正確 subtask_name
// ---------------------------------------------------------------------------

describe('TJ1: punch 有對應 subtask → subtask_name 正確填入', () => {
  it('subtask_id 對應到 subtasks.local_id，回傳列的 subtask_name = subtask 的 name', () => {
    // 建立 subtask fixture
    _helper
      .prepare(
        `INSERT INTO subtasks
          (local_id, task_local_id, name, is_settled, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      )
      .run('loc:sub-001', 'task-A', '後端整合', '2026-01-01T00:00:00.000Z');

    // 建立對應 punch（subtask_id = subtask.local_id）
    _ledger.punchIn({
      punch_uid: 'uid-j1',
      session_id: 'sess-J',
      task_id: 'task-A',
      name: '打卡 J1',
      started_at: '2026-01-01T10:00:00.000Z',
      subtask_id: 'loc:sub-001',
    });

    const rows = _ledger.listPunchesForTask('task-A');
    expect(rows).toHaveLength(1);
    expect(rows[0]['subtask_id']).toBe('loc:sub-001');
    expect(rows[0]['subtask_name']).toBe('後端整合');
  });

  it('同一 task 有兩筆 punch，分別關聯不同 subtask，各自回傳正確 subtask_name', () => {
    _helper
      .prepare(
        `INSERT INTO subtasks
          (local_id, task_local_id, name, is_settled, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      )
      .run('loc:sub-A1', 'task-B', '前端元件', '2026-01-01T00:00:00.000Z');
    _helper
      .prepare(
        `INSERT INTO subtasks
          (local_id, task_local_id, name, is_settled, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      )
      .run('loc:sub-A2', 'task-B', 'API 串接', '2026-01-01T00:00:00.000Z');

    _ledger.recordOneshot({
      punch_uid: 'uid-b1',
      session_id: 'sess-B',
      task_id: 'task-B',
      name: '打卡 B1',
      started_at: '2026-01-01T09:00:00.000Z',
      ended_at: '2026-01-01T10:00:00.000Z',
      hours: 1.0,
      subtask_id: 'loc:sub-A1',
    });

    _ledger.recordOneshot({
      punch_uid: 'uid-b2',
      session_id: 'sess-B',
      task_id: 'task-B',
      name: '打卡 B2',
      started_at: '2026-01-01T10:00:00.000Z',
      ended_at: '2026-01-01T11:00:00.000Z',
      hours: 1.0,
      subtask_id: 'loc:sub-A2',
    });

    const rows = _ledger.listPunchesForTask('task-B');
    expect(rows).toHaveLength(2);

    // ended_at DESC：B2 (11:00) > B1 (10:00)
    const nameMap = Object.fromEntries(rows.map((r) => [r['punch_uid'] as string, r['subtask_name']]));
    expect(nameMap['uid-b1']).toBe('前端元件');
    expect(nameMap['uid-b2']).toBe('API 串接');
  });
});

// ---------------------------------------------------------------------------
// TJ2: punch.subtask_id = null → subtask_name 為 null（LEFT JOIN 不丟列）
// ---------------------------------------------------------------------------

describe('TJ2: punch.subtask_id = null → 列仍存在，subtask_name = null', () => {
  it('subtask_id 為 null 的 punch，LEFT JOIN 不應移除該列', () => {
    _ledger.punchIn({
      punch_uid: 'uid-null-sub',
      session_id: 'sess-NULL',
      task_id: 'task-C',
      name: '無 subtask 打卡',
      started_at: '2026-01-01T10:00:00.000Z',
      subtask_id: null,
    });

    const rows = _ledger.listPunchesForTask('task-C');
    expect(rows).toHaveLength(1);
    expect(rows[0]['punch_uid']).toBe('uid-null-sub');
    // LEFT JOIN：subtask 不存在 → subtask_name 應為 null（不是 undefined、不是字串）
    expect(rows[0]['subtask_name']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TJ3: punch.subtask_id 指向不存在的 subtask → 列仍在、subtask_name = null
// ---------------------------------------------------------------------------

describe('TJ3: punch.subtask_id 指向不存在的 subtask → 列仍在、subtask_name = null', () => {
  it('dangling subtask_id（subtasks 表中無此 local_id），LEFT JOIN 不丟列', () => {
    // 不在 subtasks 表中插任何資料
    _ledger.punchIn({
      punch_uid: 'uid-dangling',
      session_id: 'sess-DANGLE',
      task_id: 'task-D',
      name: '懸空 subtask_id 打卡',
      started_at: '2026-01-01T10:00:00.000Z',
      subtask_id: 'loc:no-such-subtask',
    });

    const rows = _ledger.listPunchesForTask('task-D');
    expect(rows).toHaveLength(1);
    expect(rows[0]['subtask_id']).toBe('loc:no-such-subtask');
    // LEFT JOIN 找不到匹配列 → subtask_name 應為 null
    expect(rows[0]['subtask_name']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TJ4: 排序：未結束（ended_at NULL）在前，其餘 ended_at DESC
// ---------------------------------------------------------------------------

describe('TJ4: 排序 — NULL ended_at 置頂，其餘 ended_at DESC', () => {
  it('混合 open/done punch → open 置頂，done 按 ended_at DESC', () => {
    // 三筆 done punch，ended_at 不同
    _ledger.recordOneshot({
      punch_uid: 'uid-s1',
      session_id: 'sess-SORT',
      task_id: 'task-SORT',
      name: 'done 07:30',
      started_at: '2026-01-01T07:00:00.000Z',
      ended_at: '2026-01-01T07:30:00.000Z',
      hours: 0.5,
    });

    _ledger.recordOneshot({
      punch_uid: 'uid-s2',
      session_id: 'sess-SORT',
      task_id: 'task-SORT',
      name: 'done 11:00',
      started_at: '2026-01-01T09:00:00.000Z',
      ended_at: '2026-01-01T11:00:00.000Z',
      hours: 2.0,
    });

    _ledger.recordOneshot({
      punch_uid: 'uid-s3',
      session_id: 'sess-SORT',
      task_id: 'task-SORT',
      name: 'done 09:00',
      started_at: '2026-01-01T08:00:00.000Z',
      ended_at: '2026-01-01T09:00:00.000Z',
      hours: 1.0,
    });

    // 一筆執行中（ended_at NULL）
    _ledger.punchIn({
      punch_uid: 'uid-open',
      session_id: 'sess-SORT',
      task_id: 'task-SORT',
      name: '執行中',
      started_at: '2026-01-01T12:00:00.000Z',
    });

    const rows = _ledger.listPunchesForTask('task-SORT');
    expect(rows).toHaveLength(4);

    // 第一筆 = 執行中（ended_at IS NULL）
    expect(rows[0]['ended_at']).toBeNull();
    expect(rows[0]['punch_uid']).toBe('uid-open');

    // 其餘按 ended_at DESC：11:00 → 09:00 → 07:30
    expect(rows[1]['punch_uid']).toBe('uid-s2'); // ended 11:00
    expect(rows[2]['punch_uid']).toBe('uid-s3'); // ended 09:00
    expect(rows[3]['punch_uid']).toBe('uid-s1'); // ended 07:30
  });

  it('全部為 open punch 時，依 id DESC（後插入的先出現）', () => {
    _ledger.punchIn({
      punch_uid: 'uid-open-1',
      session_id: 'sess-ALL-OPEN',
      task_id: 'task-ALL-OPEN',
      name: '第一筆 open',
      started_at: '2026-01-01T08:00:00.000Z',
    });
    _ledger.punchIn({
      punch_uid: 'uid-open-2',
      session_id: 'sess-ALL-OPEN',
      task_id: 'task-ALL-OPEN',
      name: '第二筆 open',
      started_at: '2026-01-01T09:00:00.000Z',
    });

    const rows = _ledger.listPunchesForTask('task-ALL-OPEN');
    expect(rows).toHaveLength(2);
    // 兩者 ended_at 皆 NULL，依 id DESC：uid-open-2 在前
    expect(rows[0]['punch_uid']).toBe('uid-open-2');
    expect(rows[1]['punch_uid']).toBe('uid-open-1');
  });
});

// ---------------------------------------------------------------------------
// TJ5: task_id 過濾正確（別的 task 的 punch 不混入）
// ---------------------------------------------------------------------------

describe('TJ5: task_id 過濾 — 別 task 的 punch 不混入', () => {
  it('task-X 和 task-Y 各有 punch，listPunchesForTask("task-X") 只回 task-X 的 punch', () => {
    _ledger.punchIn({
      punch_uid: 'uid-x1',
      session_id: 'sess-X',
      task_id: 'task-X',
      name: 'task-X 打卡 1',
      started_at: '2026-01-01T10:00:00.000Z',
    });
    _ledger.punchIn({
      punch_uid: 'uid-x2',
      session_id: 'sess-X',
      task_id: 'task-X',
      name: 'task-X 打卡 2',
      started_at: '2026-01-01T11:00:00.000Z',
    });
    // 插入不同 task 的 punch
    _ledger.punchIn({
      punch_uid: 'uid-y1',
      session_id: 'sess-Y',
      task_id: 'task-Y',
      name: 'task-Y 打卡',
      started_at: '2026-01-01T10:30:00.000Z',
    });

    const rowsX = _ledger.listPunchesForTask('task-X');
    expect(rowsX).toHaveLength(2);
    rowsX.forEach((r) => expect(r['task_id']).toBe('task-X'));

    const rowsY = _ledger.listPunchesForTask('task-Y');
    expect(rowsY).toHaveLength(1);
    expect(rowsY[0]['punch_uid']).toBe('uid-y1');
  });

  it('查不存在的 task_id → 回傳空陣列', () => {
    _ledger.punchIn({
      punch_uid: 'uid-z1',
      session_id: 'sess-Z',
      task_id: 'task-Z',
      name: '隨便一筆',
      started_at: '2026-01-01T10:00:00.000Z',
    });

    const rows = _ledger.listPunchesForTask('no-such-task');
    expect(rows).toHaveLength(0);
    expect(rows).toEqual([]);
  });
});

// TJ6 / TJ7 已移除：純本地版無 LocBackfill，punchCrud 只用 s.local_id = p.subtask_id（臂 A），
// 不存在 OR s.remote_id = p.subtask_id（臂 B）。

// ---------------------------------------------------------------------------
// TJ8: _ensureSchema 自建路徑 — 不靠 helper CREATE TABLE，純靠 PunchLedger 建表
// ---------------------------------------------------------------------------

describe('TJ8: _ensureSchema 自建 subtasks 路徑 — 不靠 helper CREATE TABLE', () => {
  it('fresh DB 上純靠 new PunchLedger() 建表，helper 只做 INSERT，LEFT JOIN 能命中 subtask_name', () => {
    // 使用完全獨立的 tmp DB，不重用 _ledger（_ledger 的 helper 只做 INSERT 但不驗此路徑）
    const dbPath2 = join(
      tmpdir(),
      `punch_ensureschema_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
    );
    // new PunchLedger() → _ensureSchema() → 自建 subtasks 表（不需要外部 CREATE TABLE）
    const ledger2 = new PunchLedger(dbPath2);

    // 用輔助連線只做 INSERT（確認 subtasks 表真的由 _ensureSchema 建出）
    const helper2 = new Database(dbPath2);
    try {
      helper2
        .prepare(
          `INSERT INTO subtasks
            (local_id, task_local_id, name, is_settled, created_at)
           VALUES (?, ?, ?, 0, ?)`,
        )
        .run('loc:sub-es1', 'task-ES', '_ensureSchema 自建確認', '2026-01-01T00:00:00.000Z');

      ledger2.recordOneshot({
        punch_uid: 'uid-es1',
        session_id: 'sess-ES',
        task_id: 'task-ES',
        name: '打卡 ES1',
        started_at: '2026-01-01T09:00:00.000Z',
        ended_at: '2026-01-01T10:00:00.000Z',
        hours: 1.0,
        subtask_id: 'loc:sub-es1',
      });

      const rows = ledger2.listPunchesForTask('task-ES');
      expect(rows).toHaveLength(1);
      // subtasks 表由 _ensureSchema 建立，JOIN 能正常命中
      expect(rows[0]['subtask_name']).toBe('_ensureSchema 自建確認');
    } finally {
      try { helper2.close(); } catch { /* ignore */ }
      try { ledger2.close(); } catch { /* ignore */ }
      if (existsSync(dbPath2)) {
        try { rmSync(dbPath2); } catch { /* ignore */ }
      }
    }
  });
});

// TJ9 已移除：純本地版 punchCrud.ts 不 SELECT subtask_remote_id/subtask_dirty/
//   subtask_pending_op/subtask_sync_enabled（雲端同步欄已從 punchCrud SQL 移除）。
// TJ10 已移除：同上，四個 sync 欄位不存在於 SELECT 輸出，無法斷言其為 null。

// TJ9/TJ10 已移除。純本地版 punchCrud.ts 不 SELECT 雲端 sync 欄位，無需測試。

// ---------------------------------------------------------------------------
// TJ11: 詳情欄位擴充 — subtask_description / subtask_start_time / subtask_end_time /
//       subtask_duration / subtask_is_settled
//
// 本組案例依賴 punchLedger.ts:268-272 新增的：
//   s.description AS subtask_description, s.start_time AS subtask_start_time,
//   s.end_time AS subtask_end_time, s.duration AS subtask_duration,
//   s.is_settled AS subtask_is_settled
// 判斷依據：移除上列 SELECT alias 後，TJ11a/TJ11b 的欄位斷言將全部失敗 → 「本改動引入」。
// TJ11c 依賴 LEFT JOIN 不命中時五欄皆 null，同樣由本次新增的 alias 決定。
// ---------------------------------------------------------------------------

describe('TJ11: 詳情欄位擴充 — 五個新欄位正確帶出 / null 覆蓋', () => {
  it('TJ11a: subtask 有 description/start_time/end_time/duration/is_settled 值 → 五欄正確帶出', () => {
    // 插入帶有完整詳情欄位的 subtask
    _helper
      .prepare(
        `INSERT INTO subtasks
          (local_id, task_local_id, name, description, start_time, end_time, duration,
           is_settled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'loc:sub-tj11a',
        'task-TJ11A',
        '詳情子任務',
        '這是 subtask 的描述文字',
        '2026-03-01T09:00:00.000Z',
        '2026-03-01T11:00:00.000Z',
        2.0,
        1, // is_settled = 1（已結算）
        '2026-01-01T00:00:00.000Z',
      );

    _ledger.recordOneshot({
      punch_uid: 'uid-tj11a',
      session_id: 'sess-TJ11A',
      task_id: 'task-TJ11A',
      name: '打卡 TJ11A',
      started_at: '2026-03-01T09:00:00.000Z',
      ended_at: '2026-03-01T10:00:00.000Z',
      hours: 1.0,
      subtask_id: 'loc:sub-tj11a',
    });

    const rows = _ledger.listPunchesForTask('task-TJ11A');
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // JOIN 命中確認
    expect(row['subtask_name']).toBe('詳情子任務');
    // 五個新詳情欄位
    expect(row['subtask_description']).toBe('這是 subtask 的描述文字');
    expect(row['subtask_start_time']).toBe('2026-03-01T09:00:00.000Z');
    expect(row['subtask_end_time']).toBe('2026-03-01T11:00:00.000Z');
    expect(row['subtask_duration']).toBe(2.0);
    expect(row['subtask_is_settled']).toBe(1);
  });

  it('TJ11b: subtask 有對應但詳情欄全 NULL → 五欄皆 null（LEFT JOIN 仍命中，非無命中）', () => {
    // 插入 subtask，description/start_time/end_time/duration 全部不填（NULL），is_settled=0
    _helper
      .prepare(
        `INSERT INTO subtasks
          (local_id, task_local_id, name, is_settled, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      )
      .run('loc:sub-tj11b', 'task-TJ11B', '無詳情子任務', '2026-01-01T00:00:00.000Z');

    _ledger.recordOneshot({
      punch_uid: 'uid-tj11b',
      session_id: 'sess-TJ11B',
      task_id: 'task-TJ11B',
      name: '打卡 TJ11B',
      started_at: '2026-03-01T09:00:00.000Z',
      ended_at: '2026-03-01T10:00:00.000Z',
      hours: 1.0,
      subtask_id: 'loc:sub-tj11b',
    });

    const rows = _ledger.listPunchesForTask('task-TJ11B');
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // JOIN 命中（subtask_name 有值），但詳情欄位本身為 NULL
    expect(row['subtask_name']).toBe('無詳情子任務');
    expect(row['subtask_description']).toBeNull();
    expect(row['subtask_start_time']).toBeNull();
    expect(row['subtask_end_time']).toBeNull();
    expect(row['subtask_duration']).toBeNull();
    // is_settled 預設 0（不是 null）
    expect(row['subtask_is_settled']).toBe(0);
  });

  it('TJ11c: punch.subtask_id = null → 五個新欄位皆 null（LEFT JOIN 無命中）', () => {
    // 不插任何 subtask，punch.subtask_id = null
    _ledger.punchIn({
      punch_uid: 'uid-tj11c',
      session_id: 'sess-TJ11C',
      task_id: 'task-TJ11C',
      name: '無 subtask 打卡',
      started_at: '2026-03-01T10:00:00.000Z',
      subtask_id: null,
    });

    const rows = _ledger.listPunchesForTask('task-TJ11C');
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // LEFT JOIN 無命中 → 五個新欄位皆 null
    expect(row['subtask_description']).toBeNull();
    expect(row['subtask_start_time']).toBeNull();
    expect(row['subtask_end_time']).toBeNull();
    expect(row['subtask_duration']).toBeNull();
    expect(row['subtask_is_settled']).toBeNull();
  });
});
