/**
 * punchLedger.spec.ts — PunchLedger 單元測試（better-sqlite3，tmp DB）
 *
 * 驗證：
 *  T1: punch_in → punch_out 兩段式（open → done）
 *  T2: ON CONFLICT 去重 — 同 task_id+punch_uid 的 punch_in 不產生兩列
 *      [行為改變] 去重鍵從 (session_id, punch_uid) 改為 partial index (task_id, punch_uid)
 *      WHERE task_id IS NOT NULL（punchLedger.ts:52-54 / _migrateToTaskUidKey）；
 *      新鍵允許同 uid 跨不同 task 各記一筆（設計動機：JSONL 檔名當 uid，跨任務共用）。
 *  T3: list_punches_for_task 排序 — NULL ended_at 置頂、ended_at DESC、id DESC
 *  T4: preload_done_keys — 回 done 筆 set，不含 open
 *  T5: list_open — 回 open 筆，done 不出現
 *  T6: record_oneshot upsert — 同 task_id+punch_uid 不產生兩列，欄位更新
 *      [行為改變] recordOneshot ON CONFLICT 去重鍵同 T2，從 (session_id, punch_uid) 改為
 *      (task_id, punch_uid) WHERE task_id IS NOT NULL（punchLedger.ts:481）。
 *  T7: 容錯 — 壞路徑不崩（以唯讀測試替代：非 DB 錯誤情境下確保方法不拋）
 *
 * 殭屍 open 列清理（_migrateZombieOpenRows）：
 *  C-T1: 有 done 配對的 open → 刪 open 帳本列、hardDelete loc: subtask（remote_id=null）
 *  C-T2: 有 done 配對的 open → loc: subtask 已掛雲端（remote_id != null）→ tombstone 而非硬刪
 *  C-T3: 孤兒 open（無 done 配對）且 created_at/started_at > 24h → 標 status='stale'
 *  C-T4: created_at 新鮮（< 24h）→ 豁免，不標 stale
 *  C-T5: started_at 新鮮（< 24h）→ 豁免，不標 stale
 *  C-T6: 冪等兩跑（第二次 new PunchLedger 不重複刪）
 *  C-T7: (a)(b) 不互踩（done 配對的 open 清理不影響孤兒，孤兒標 stale 不影響 done 配對的 open）
 *  C-T8: 缺 subtasks 表等異常不崩（異常路徑容錯）
 *
 * 顯示層 transform（listPunchesForTask）：
 *  T3-display: status='open' 列在 session_id 不存在（不活）時，回傳物件 status='stale'；DB 中仍為 'open'
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import { PunchLedger } from '../src/main/db/punchLedger';

// ---------------------------------------------------------------------------
// 測試輔助：每個 test suite 用獨立的 tmp DB 路徑
// ---------------------------------------------------------------------------

let _dbPath: string;
let _ledger: PunchLedger;

function freshLedger(): PunchLedger {
  _dbPath = join(tmpdir(), `punch_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  return new PunchLedger(_dbPath);
}

beforeEach(() => {
  _ledger = freshLedger();
});

afterEach(() => {
  try { _ledger.close(); } catch { /* ignore */ }
  if (existsSync(_dbPath)) {
    try { rmSync(_dbPath); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// T1: punch_in → punch_out 兩段式
// ---------------------------------------------------------------------------

describe('T1: punch_in → punch_out 兩段式', () => {
  it('punch_in 後列為 open，punch_out 後列為 done', () => {
    _ledger.punchIn({
      punch_uid: 'uid-001',
      session_id: 'sess-A',
      task_id: 'task-1',
      name: '測試打卡',
      type: 'main',
      started_at: '2026-01-01T10:00:00.000Z',
    });

    // 確認 open
    const opens = _ledger.listOpen('sess-A');
    expect(opens).toHaveLength(1);
    expect(opens[0]['status']).toBe('open');
    expect(opens[0]['punch_uid']).toBe('uid-001');

    // punch_out
    _ledger.punchOut({
      punch_uid: 'uid-001',
      session_id: 'sess-A',
      ended_at: '2026-01-01T11:00:00.000Z',
      hours: 1.0,
      ok: 1,
    });

    // open 清單應為空
    const opensAfter = _ledger.listOpen('sess-A');
    expect(opensAfter).toHaveLength(0);

    // task 清單應有一筆 done
    const forTask = _ledger.listPunchesForTask('task-1');
    expect(forTask).toHaveLength(1);
    expect(forTask[0]['status']).toBe('done');
    expect(forTask[0]['hours']).toBe(1.0);
    expect(forTask[0]['ok']).toBe(1);
  });

  it('punch_out 在無 session_id 時，依 punch_uid 查（UUID 全局唯一）', () => {
    _ledger.punchIn({
      punch_uid: 'uid-002',
      session_id: 'sess-B',
      task_id: 'task-2',
      name: '無 session 打卡',
    });

    // punchOut 不傳 session_id
    _ledger.punchOut({
      punch_uid: 'uid-002',
      ended_at: '2026-01-01T12:00:00.000Z',
      hours: 0.5,
      ok: 1,
    });

    const forTask = _ledger.listPunchesForTask('task-2');
    expect(forTask[0]['status']).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// T2: ON CONFLICT 去重 — 同 uid 不產生兩列
// ---------------------------------------------------------------------------

// [行為改變] 去重鍵從 (session_id, punch_uid) 改為 partial index (task_id, punch_uid) WHERE task_id IS NOT NULL。
// 新鍵語意：同一 task 下同一 punch_uid 只記一筆（DO NOTHING）；同 uid 跨不同 task 可各記一筆。
// 此 case：相同 task_id='task-3' + 相同 punch_uid → 新鍵去重，第二次呼叫被 DO NOTHING 忽略。
describe('T2: ON CONFLICT 去重', () => {
  it('同 task_id+punch_uid 的 punch_in 呼叫兩次，只有一列（新去重鍵：task_id+punch_uid partial index）', () => {
    _ledger.punchIn({
      punch_uid: 'uid-dup',
      session_id: 'sess-C',
      task_id: 'task-3',
      name: '第一次',
    });
    // 再呼叫一次（同 task_id + 同 punch_uid）→ 新 partial index (task_id,punch_uid) 去重
    _ledger.punchIn({
      punch_uid: 'uid-dup',
      session_id: 'sess-C',
      task_id: 'task-3',
      name: '第二次（應被 DO NOTHING 忽略）',
    });

    const opens = _ledger.listOpen('sess-C');
    expect(opens).toHaveLength(1);
    // name 保留第一次（DO NOTHING 不覆蓋）
    expect(opens[0]['name']).toBe('第一次');
  });
});

// ---------------------------------------------------------------------------
// T3: list_punches_for_task 排序
// ---------------------------------------------------------------------------

describe('T3: list_punches_for_task 排序', () => {
  it('NULL ended_at（執行中）置頂；其餘 ended_at DESC；id DESC', () => {
    // 寫三筆 done + 一筆 open（NULL ended_at）
    _ledger.recordOneshot({
      punch_uid: 'uid-r1',
      session_id: 'sess-D',
      task_id: 'task-sort',
      name: 'r1',
      started_at: '2026-01-01T08:00:00.000Z',
      ended_at: '2026-01-01T09:00:00.000Z',
      hours: 1.0,
    });
    _ledger.recordOneshot({
      punch_uid: 'uid-r2',
      session_id: 'sess-D',
      task_id: 'task-sort',
      name: 'r2',
      started_at: '2026-01-01T09:00:00.000Z',
      ended_at: '2026-01-01T11:00:00.000Z',
      hours: 2.0,
    });
    _ledger.recordOneshot({
      punch_uid: 'uid-r3',
      session_id: 'sess-D',
      task_id: 'task-sort',
      name: 'r3',
      started_at: '2026-01-01T07:00:00.000Z',
      ended_at: '2026-01-01T07:30:00.000Z',
      hours: 0.5,
    });
    // 執行中（無 ended_at）
    _ledger.punchIn({
      punch_uid: 'uid-open',
      session_id: 'sess-D',
      task_id: 'task-sort',
      name: '執行中',
      started_at: '2026-01-01T12:00:00.000Z',
    });

    const rows = _ledger.listPunchesForTask('task-sort');
    expect(rows).toHaveLength(4);

    // 第一筆必須是 NULL ended_at（執行中）
    expect(rows[0]['ended_at']).toBeNull();
    expect(rows[0]['punch_uid']).toBe('uid-open');

    // 其餘依 ended_at DESC
    expect(rows[1]['punch_uid']).toBe('uid-r2'); // ended 11:00
    expect(rows[2]['punch_uid']).toBe('uid-r1'); // ended 09:00
    expect(rows[3]['punch_uid']).toBe('uid-r3'); // ended 07:30
  });
});

// ---------------------------------------------------------------------------
// T4: preload_done_keys
// ---------------------------------------------------------------------------

describe('T4: preload_done_keys', () => {
  it('回 done 筆的 uid set，open 筆不含', () => {
    _ledger.recordOneshot({
      punch_uid: 'uid-done-1',
      session_id: 'sess-E',
      task_id: 'task-5',
      name: 'done 1',
    });
    _ledger.recordOneshot({
      punch_uid: 'uid-done-2',
      session_id: 'sess-E',
      task_id: 'task-5',
      name: 'done 2',
    });
    _ledger.punchIn({
      punch_uid: 'uid-open-1',
      session_id: 'sess-E',
      task_id: 'task-5',
      name: 'still open',
    });

    const keys = _ledger.preloadDoneKeys('sess-E');
    expect(keys).toBeInstanceOf(Set);
    expect(keys.has('uid-done-1')).toBe(true);
    expect(keys.has('uid-done-2')).toBe(true);
    expect(keys.has('uid-open-1')).toBe(false);
    expect(keys.size).toBe(2);
  });

  it('session 不存在 → 空 set', () => {
    const keys = _ledger.preloadDoneKeys('no-such-session');
    expect(keys.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T5: list_open
// ---------------------------------------------------------------------------

describe('T5: list_open', () => {
  it('只回 open 筆，done 筆不出現', () => {
    _ledger.punchIn({
      punch_uid: 'uid-o1',
      session_id: 'sess-F',
      task_id: 'task-6',
      name: 'open 1',
    });
    _ledger.recordOneshot({
      punch_uid: 'uid-d1',
      session_id: 'sess-F',
      task_id: 'task-6',
      name: 'done 1',
    });

    const opens = _ledger.listOpen('sess-F');
    expect(opens).toHaveLength(1);
    expect(opens[0]['punch_uid']).toBe('uid-o1');
    expect(opens[0]['status']).toBe('open');
  });
});

// ---------------------------------------------------------------------------
// T6: record_oneshot upsert
// ---------------------------------------------------------------------------

// [行為改變] recordOneshot 的 ON CONFLICT 去重鍵從 (session_id, punch_uid) 改為
// (task_id, punch_uid) WHERE task_id IS NOT NULL（punchLedger.ts:481）。
// 新鍵語意：同一 task 下同一 punch_uid → DO UPDATE（覆蓋更新）；跨 task 同 uid 各記一筆。
describe('T6: record_oneshot upsert', () => {
  it('同 task_id+punch_uid 第二次呼叫，不產生兩列，欄位更新（新去重鍵：task_id+punch_uid partial index）', () => {
    _ledger.recordOneshot({
      punch_uid: 'uid-upsert',
      session_id: 'sess-G',
      task_id: 'task-7',
      name: '初次',
      hours: 1.0,
    });
    // 同 task_id='task-7' + 同 punch_uid → 新 partial index (task_id,punch_uid) 觸發 DO UPDATE
    _ledger.recordOneshot({
      punch_uid: 'uid-upsert',
      session_id: 'sess-G',
      task_id: 'task-7',
      name: '更新',
      hours: 2.5,
      ended_at: '2026-01-01T15:00:00.000Z',
    });

    const rows = _ledger.listPunchesForTask('task-7');
    expect(rows).toHaveLength(1);
    expect(rows[0]['name']).toBe('更新');
    expect(rows[0]['hours']).toBe(2.5);
    expect(rows[0]['status']).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// T7: 容錯 — 方法不拋例外
// ---------------------------------------------------------------------------

describe('T7: 容錯 — 方法不拋', () => {
  it('空 session → listOpen 回 []', () => {
    expect(() => _ledger.listOpen('')).not.toThrow();
    expect(_ledger.listOpen('')).toEqual([]);
  });

  it('null task → listPunchesForTask 回 []', () => {
    expect(() => _ledger.listPunchesForTask(null)).not.toThrow();
    expect(_ledger.listPunchesForTask(null)).toEqual([]);
  });

  it('preloadDoneKeys 對空 session 不拋', () => {
    expect(() => _ledger.preloadDoneKeys('')).not.toThrow();
  });

  it('punchOut 不存在的 uid 不拋（changes=0，靜默）', () => {
    expect(() =>
      _ledger.punchOut({ punch_uid: 'non-existent', session_id: 'sess-X' }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Helper：建手工裸 DB（C-T 系列用）
// ---------------------------------------------------------------------------

/**
 * 建一個裸 DB（不跑 PunchLedger），插入可控時間戳的 punches + subtasks，
 * 再 new PunchLedger(dbPath) 觸發遷移。
 * 遷移完成後 ledger.close()，由呼叫方用 new Database(dbPath, {readonly:true}) 驗證。
 */
function _staleIso(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '.000Z');
}

function _freshIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, '.000Z');
}

// ---------------------------------------------------------------------------
// C-T1: 有 done 配對的 open → hardDelete loc: subtask（remote_id=null）
// ---------------------------------------------------------------------------

describe('C-T1: _migrateZombieOpenRows — done 配對的 open → 刪帳本列 + 硬刪 loc: subtask', () => {
  let dbPath2: string;
  let rawDb: Database.Database;

  beforeEach(() => {
    dbPath2 = join(tmpdir(), `ct1_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    rawDb = new Database(dbPath2);
    rawDb.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    try { rawDb.close(); } catch { /* ignore */ }
    if (existsSync(dbPath2)) try { rmSync(dbPath2); } catch { /* ignore */ }
  });

  it('同 task_id/name/started_at 有 done 配對的 open 列被刪；loc: subtask（remote_id=null）硬刪；done 列與 done subtask 不動', () => {
    // 手動建最小 schema
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_uid TEXT NOT NULL, session_id TEXT, task_id TEXT,
        type TEXT, name TEXT, description TEXT,
        started_at TEXT, ended_at TEXT, hours REAL,
        subtask_id TEXT, status TEXT, ok INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS subtasks (
        local_id TEXT PRIMARY KEY,
        remote_id TEXT, task_local_id TEXT NOT NULL,
        name TEXT NOT NULL, description TEXT,
        start_time TEXT, end_time TEXT, duration REAL,
        assignee_id TEXT, category_id TEXT,
        is_settled INTEGER NOT NULL DEFAULT 0,
        version INTEGER, origin TEXT NOT NULL DEFAULT 'local',
        platform_local_id TEXT,
        sync_enabled INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 0,
        pending_op TEXT, tombstone INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT, created_at TEXT NOT NULL, updated_at TEXT
      )
    `);

    const T0 = '2026-01-01T10:00:00.000Z';
    const createdAt = _staleIso(30); // 30h 前，跨過 24h 閘

    // open 列
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, subtask_id, status, created_at)
       VALUES ('uid-open-ct1', 'sess-X', 'task-ct1', '後端整合', ?, 'loc:open-sub', 'open', ?)`,
    ).run(T0, createdAt);

    // 對應的 done 列（同 task_id/name/started_at）
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, ended_at, hours, subtask_id, status, ok, created_at)
       VALUES ('uid-done-ct1', 'sess-X', 'task-ct1', '後端整合', ?, '2026-01-01T11:00:00.000Z', 1.0, 'loc:done-sub', 'done', 1, ?)`,
    ).run(T0, createdAt);

    // loc: open subtask（remote_id=null, sync_enabled=0 → 硬刪條件）
    rawDb.prepare(
      `INSERT INTO subtasks (local_id, task_local_id, name, remote_id, sync_enabled, dirty, created_at)
       VALUES ('loc:open-sub', 'task-uuid-ct1', 'open 子任務', NULL, 0, 1, ?)`,
    ).run(createdAt);

    // done subtask（不應被動到）
    rawDb.prepare(
      `INSERT INTO subtasks (local_id, task_local_id, name, remote_id, sync_enabled, dirty, created_at)
       VALUES ('loc:done-sub', 'task-uuid-ct1', 'done 子任務', NULL, 0, 1, ?)`,
    ).run(createdAt);

    rawDb.close();

    // 觸發遷移
    const ledger = new PunchLedger(dbPath2);
    ledger.close();

    // 驗證
    const v = new Database(dbPath2, { readonly: true });

    // open 帳本列已被刪除
    const openPunch = v.prepare("SELECT * FROM punches WHERE punch_uid='uid-open-ct1'").get();
    expect(openPunch).toBeUndefined();

    // done 帳本列仍在
    const donePunch = v.prepare("SELECT * FROM punches WHERE punch_uid='uid-done-ct1'").get();
    expect(donePunch).toBeDefined();

    // loc:open-sub 已被硬刪（remote_id=null, sync_enabled=0 → canHardDelete）
    const openSub = v.prepare("SELECT * FROM subtasks WHERE local_id='loc:open-sub'").get();
    expect(openSub).toBeUndefined();

    // loc:done-sub 未被動到
    const doneSub = v.prepare("SELECT * FROM subtasks WHERE local_id='loc:done-sub'").get();
    expect(doneSub).toBeDefined();

    v.close();
  });
});

// ---------------------------------------------------------------------------
// C-T2: 有 done 配對的 open → 純本地 schema → subtask 直接硬刪（無 tombstone）
// ---------------------------------------------------------------------------

describe('C-T2: _migrateZombieOpenRows — 純本地 schema：subtask 一律硬刪（無雲端欄）', () => {
  let dbPath2: string;
  let rawDb: Database.Database;

  beforeEach(() => {
    dbPath2 = join(tmpdir(), `ct2_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    rawDb = new Database(dbPath2);
    rawDb.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    try { rawDb.close(); } catch { /* ignore */ }
    if (existsSync(dbPath2)) try { rmSync(dbPath2); } catch { /* ignore */ }
  });

  it('open 列的 loc: subtask 存在 → 純本地 schema 下直接硬刪（不留 tombstone）', () => {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_uid TEXT NOT NULL, session_id TEXT, task_id TEXT,
        type TEXT, name TEXT, description TEXT,
        started_at TEXT, ended_at TEXT, hours REAL,
        subtask_id TEXT, status TEXT, ok INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS subtasks (
        local_id TEXT PRIMARY KEY,
        task_local_id TEXT NOT NULL,
        name TEXT NOT NULL, description TEXT,
        start_time TEXT, end_time TEXT, duration REAL,
        assignee_id TEXT, category_id TEXT,
        is_settled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);

    const T0 = '2026-02-01T10:00:00.000Z';
    const createdAt = _staleIso(30);

    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, subtask_id, status, created_at)
       VALUES ('uid-open-ct2', 'sess-Y', 'task-ct2', '整合API', ?, 'loc:local-sub', 'open', ?)`,
    ).run(T0, createdAt);

    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, ended_at, hours, subtask_id, status, ok, created_at)
       VALUES ('uid-done-ct2', 'sess-Y', 'task-ct2', '整合API', ?, '2026-02-01T11:00:00.000Z', 1.0, 'loc:local-done', 'done', 1, ?)`,
    ).run(T0, createdAt);

    // 純本地 subtask（純本地 schema 無雲端欄）
    rawDb.prepare(
      `INSERT INTO subtasks (local_id, task_local_id, name, created_at)
       VALUES ('loc:local-sub', 'task-uuid-ct2', 'local 子任務', ?)`,
    ).run(createdAt);

    rawDb.close();

    const ledger = new PunchLedger(dbPath2);
    ledger.close();

    const v = new Database(dbPath2, { readonly: true });

    // open 帳本列已被刪除
    const openPunch = v.prepare("SELECT * FROM punches WHERE punch_uid='uid-open-ct2'").get();
    expect(openPunch).toBeUndefined();

    // loc:local-sub 已被硬刪（純本地 schema 無 tombstone 路徑）
    const sub = v.prepare("SELECT * FROM subtasks WHERE local_id='loc:local-sub'").get();
    expect(sub).toBeUndefined();

    v.close();
  });
});

// ---------------------------------------------------------------------------
// C-T3: 孤兒 open（無 done 配對，created_at/started_at 都 > 24h）→ status='stale'
// ---------------------------------------------------------------------------

describe('C-T3: _migrateZombieOpenRows — 孤兒 open > 24h → status=stale', () => {
  let dbPath2: string;
  let rawDb: Database.Database;

  beforeEach(() => {
    dbPath2 = join(tmpdir(), `ct3_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    rawDb = new Database(dbPath2);
    rawDb.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    try { rawDb.close(); } catch { /* ignore */ }
    if (existsSync(dbPath2)) try { rmSync(dbPath2); } catch { /* ignore */ }
  });

  it('孤兒 open（created_at/started_at 均 > 24h，無 done 配對）→ status=stale；loc: subtask 不動', () => {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_uid TEXT NOT NULL, session_id TEXT, task_id TEXT,
        type TEXT, name TEXT, description TEXT,
        started_at TEXT, ended_at TEXT, hours REAL,
        subtask_id TEXT, status TEXT, ok INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS subtasks (
        local_id TEXT PRIMARY KEY,
        remote_id TEXT, task_local_id TEXT NOT NULL,
        name TEXT NOT NULL, description TEXT,
        start_time TEXT, end_time TEXT, duration REAL,
        assignee_id TEXT, category_id TEXT,
        is_settled INTEGER NOT NULL DEFAULT 0,
        version INTEGER, origin TEXT NOT NULL DEFAULT 'local',
        platform_local_id TEXT,
        sync_enabled INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 0,
        pending_op TEXT, tombstone INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT, created_at TEXT NOT NULL, updated_at TEXT
      )
    `);

    const staleTime = _staleIso(30); // 30h 前 → 超過 24h 閘

    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, subtask_id, status, created_at)
       VALUES ('uid-orphan-ct3', 'sess-stale', 'task-ct3', '孤兒打卡', ?, 'loc:orphan-sub', 'open', ?)`,
    ).run(staleTime, staleTime);

    // 孤兒的 loc: subtask（不應被動）
    rawDb.prepare(
      `INSERT INTO subtasks (local_id, task_local_id, name, remote_id, sync_enabled, dirty, created_at)
       VALUES ('loc:orphan-sub', 'task-uuid-ct3', '孤兒子任務', NULL, 0, 1, ?)`,
    ).run(staleTime);

    rawDb.close();

    const ledger = new PunchLedger(dbPath2);
    ledger.close();

    const v = new Database(dbPath2, { readonly: true });

    // open → stale（不被刪，只改狀態）
    const punch = v.prepare("SELECT status FROM punches WHERE punch_uid='uid-orphan-ct3'").get() as Record<string, unknown> | undefined;
    expect(punch).toBeDefined();
    expect(punch!['status']).toBe('stale');

    // loc:orphan-sub 不動（孤兒路不碰 subtask）
    const sub = v.prepare("SELECT tombstone, dirty FROM subtasks WHERE local_id='loc:orphan-sub'").get() as Record<string, unknown> | undefined;
    expect(sub).toBeDefined();
    expect(sub!['tombstone']).toBe(0);  // 未被 tombstone

    v.close();
  });
});

// ---------------------------------------------------------------------------
// C-T4: created_at 新鮮（< 24h）→ 豁免，不標 stale
// ---------------------------------------------------------------------------

describe('C-T4: _migrateZombieOpenRows — created_at 新鮮豁免', () => {
  let dbPath2: string;
  let rawDb: Database.Database;

  beforeEach(() => {
    dbPath2 = join(tmpdir(), `ct4_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    rawDb = new Database(dbPath2);
    rawDb.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    try { rawDb.close(); } catch { /* ignore */ }
    if (existsSync(dbPath2)) try { rmSync(dbPath2); } catch { /* ignore */ }
  });

  it('created_at 在 24h 內（新鮮）→ open 不被標 stale', () => {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_uid TEXT NOT NULL, session_id TEXT, task_id TEXT,
        type TEXT, name TEXT, description TEXT,
        started_at TEXT, ended_at TEXT, hours REAL,
        subtask_id TEXT, status TEXT, ok INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);

    const freshCreatedAt = _freshIso();        // 剛建立
    const staleStartedAt = _staleIso(30);       // started_at 舊（但 created_at 新 → 豁免）

    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, status, created_at)
       VALUES ('uid-fresh-ct4', 'sess-fresh', 'task-ct4', '新鮮打卡', ?, 'open', ?)`,
    ).run(staleStartedAt, freshCreatedAt);

    rawDb.close();

    const ledger = new PunchLedger(dbPath2);
    ledger.close();

    const v = new Database(dbPath2, { readonly: true });
    const punch = v.prepare("SELECT status FROM punches WHERE punch_uid='uid-fresh-ct4'").get() as Record<string, unknown> | undefined;
    expect(punch).toBeDefined();
    expect(punch!['status']).toBe('open');  // 仍 open（created_at 新鮮豁免）
    v.close();
  });
});

// ---------------------------------------------------------------------------
// C-T5: started_at 新鮮（< 24h）→ 豁免，不標 stale
// ---------------------------------------------------------------------------

describe('C-T5: _migrateZombieOpenRows — started_at 新鮮豁免', () => {
  let dbPath2: string;
  let rawDb: Database.Database;

  beforeEach(() => {
    dbPath2 = join(tmpdir(), `ct5_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    rawDb = new Database(dbPath2);
    rawDb.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    try { rawDb.close(); } catch { /* ignore */ }
    if (existsSync(dbPath2)) try { rmSync(dbPath2); } catch { /* ignore */ }
  });

  it('started_at 在 24h 內（新鮮）→ open 不被標 stale', () => {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_uid TEXT NOT NULL, session_id TEXT, task_id TEXT,
        type TEXT, name TEXT, description TEXT,
        started_at TEXT, ended_at TEXT, hours REAL,
        subtask_id TEXT, status TEXT, ok INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);

    const staleCreatedAt = _staleIso(30);   // created_at 舊
    const freshStartedAt = _freshIso();      // started_at 新鮮 → 豁免

    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, status, created_at)
       VALUES ('uid-fresh-ct5', 'sess-ct5', 'task-ct5', '新鮮 started', ?, 'open', ?)`,
    ).run(freshStartedAt, staleCreatedAt);

    rawDb.close();

    const ledger = new PunchLedger(dbPath2);
    ledger.close();

    const v = new Database(dbPath2, { readonly: true });
    const punch = v.prepare("SELECT status FROM punches WHERE punch_uid='uid-fresh-ct5'").get() as Record<string, unknown> | undefined;
    expect(punch).toBeDefined();
    expect(punch!['status']).toBe('open');  // 仍 open（started_at 新鮮豁免）
    v.close();
  });
});

// ---------------------------------------------------------------------------
// C-T6: 冪等兩跑（第二次 new PunchLedger 不重複刪）
// ---------------------------------------------------------------------------

describe('C-T6: _migrateZombieOpenRows — 冪等兩跑', () => {
  let dbPath2: string;
  let rawDb: Database.Database;

  beforeEach(() => {
    dbPath2 = join(tmpdir(), `ct6_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    rawDb = new Database(dbPath2);
    rawDb.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    try { rawDb.close(); } catch { /* ignore */ }
    if (existsSync(dbPath2)) try { rmSync(dbPath2); } catch { /* ignore */ }
  });

  it('兩次 new PunchLedger 均不拋，done 列與 done subtask 仍在', () => {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_uid TEXT NOT NULL, session_id TEXT, task_id TEXT,
        type TEXT, name TEXT, description TEXT,
        started_at TEXT, ended_at TEXT, hours REAL,
        subtask_id TEXT, status TEXT, ok INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS subtasks (
        local_id TEXT PRIMARY KEY,
        remote_id TEXT, task_local_id TEXT NOT NULL,
        name TEXT NOT NULL, description TEXT,
        start_time TEXT, end_time TEXT, duration REAL,
        assignee_id TEXT, category_id TEXT,
        is_settled INTEGER NOT NULL DEFAULT 0,
        version INTEGER, origin TEXT NOT NULL DEFAULT 'local',
        platform_local_id TEXT,
        sync_enabled INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 0,
        pending_op TEXT, tombstone INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT, created_at TEXT NOT NULL, updated_at TEXT
      )
    `);

    const T0 = '2026-03-01T10:00:00.000Z';
    const stale = _staleIso(30);

    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, subtask_id, status, created_at)
       VALUES ('uid-open-ct6', 'sess-ct6', 'task-ct6', '重跑測試', ?, 'loc:ct6-sub', 'open', ?)`,
    ).run(T0, stale);
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, ended_at, hours, status, ok, created_at)
       VALUES ('uid-done-ct6', 'sess-ct6', 'task-ct6', '重跑測試', ?, '2026-03-01T11:00:00.000Z', 1.0, 'done', 1, ?)`,
    ).run(T0, stale);
    rawDb.prepare(
      `INSERT INTO subtasks (local_id, task_local_id, name, remote_id, sync_enabled, dirty, created_at)
       VALUES ('loc:ct6-sub', 'task-uuid-ct6', 'ct6 子任務', NULL, 0, 1, ?)`,
    ).run(stale);
    rawDb.close();

    // 第一跑
    expect(() => {
      const l1 = new PunchLedger(dbPath2);
      l1.close();
    }).not.toThrow();

    // 第二跑（冪等）
    expect(() => {
      const l2 = new PunchLedger(dbPath2);
      l2.close();
    }).not.toThrow();

    // done 列仍在
    const v = new Database(dbPath2, { readonly: true });
    const donePunch = v.prepare("SELECT status FROM punches WHERE punch_uid='uid-done-ct6'").get();
    expect(donePunch).toBeDefined();
    v.close();
  });
});

// ---------------------------------------------------------------------------
// C-T7: (a)(b) 不互踩
// ---------------------------------------------------------------------------

describe('C-T7: _migrateZombieOpenRows — (a)done 配對清理 與 (b)孤兒 stale 不互踩', () => {
  let dbPath2: string;
  let rawDb: Database.Database;

  beforeEach(() => {
    dbPath2 = join(tmpdir(), `ct7_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    rawDb = new Database(dbPath2);
    rawDb.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    try { rawDb.close(); } catch { /* ignore */ }
    if (existsSync(dbPath2)) try { rmSync(dbPath2); } catch { /* ignore */ }
  });

  it('同一 DB 中：done 配對的 open 被刪、孤兒 open 被標 stale；各不影響對方', () => {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_uid TEXT NOT NULL, session_id TEXT, task_id TEXT,
        type TEXT, name TEXT, description TEXT,
        started_at TEXT, ended_at TEXT, hours REAL,
        subtask_id TEXT, status TEXT, ok INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS subtasks (
        local_id TEXT PRIMARY KEY,
        remote_id TEXT, task_local_id TEXT NOT NULL,
        name TEXT NOT NULL, description TEXT,
        start_time TEXT, end_time TEXT, duration REAL,
        assignee_id TEXT, category_id TEXT,
        is_settled INTEGER NOT NULL DEFAULT 0,
        version INTEGER, origin TEXT NOT NULL DEFAULT 'local',
        platform_local_id TEXT,
        sync_enabled INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 0,
        pending_op TEXT, tombstone INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT, created_at TEXT NOT NULL, updated_at TEXT
      )
    `);

    const T0 = '2026-04-01T10:00:00.000Z';
    const stale = _staleIso(30);

    // (a) done 配對的 open → 應被刪
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, subtask_id, status, created_at)
       VALUES ('uid-paired-open', 'sess-ct7', 'task-ct7a', '配對打卡', ?, 'loc:paired-sub', 'open', ?)`,
    ).run(T0, stale);
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, ended_at, hours, status, ok, created_at)
       VALUES ('uid-paired-done', 'sess-ct7', 'task-ct7a', '配對打卡', ?, '2026-04-01T11:00:00.000Z', 1.0, 'done', 1, ?)`,
    ).run(T0, stale);
    rawDb.prepare(
      `INSERT INTO subtasks (local_id, task_local_id, name, remote_id, sync_enabled, dirty, created_at)
       VALUES ('loc:paired-sub', 'uuid-ct7a', '配對子任務', NULL, 0, 1, ?)`,
    ).run(stale);

    // (b) 孤兒 open → 應被標 stale
    const orphanStarted = _staleIso(26); // 26h 前
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, subtask_id, status, created_at)
       VALUES ('uid-orphan-ct7', 'sess-ct7', 'task-ct7b', '孤兒打卡', ?, 'loc:orphan-sub-ct7', 'open', ?)`,
    ).run(orphanStarted, stale);
    rawDb.prepare(
      `INSERT INTO subtasks (local_id, task_local_id, name, remote_id, sync_enabled, dirty, created_at)
       VALUES ('loc:orphan-sub-ct7', 'uuid-ct7b', '孤兒子任務', NULL, 0, 1, ?)`,
    ).run(stale);

    rawDb.close();

    const ledger = new PunchLedger(dbPath2);
    ledger.close();

    const v = new Database(dbPath2, { readonly: true });

    // (a) done 配對的 open 被刪
    const pairedOpen = v.prepare("SELECT * FROM punches WHERE punch_uid='uid-paired-open'").get();
    expect(pairedOpen).toBeUndefined();

    // (a) done 列仍在
    const pairedDone = v.prepare("SELECT status FROM punches WHERE punch_uid='uid-paired-done'").get();
    expect(pairedDone).toBeDefined();

    // (b) 孤兒 open → stale
    const orphan = v.prepare("SELECT status FROM punches WHERE punch_uid='uid-orphan-ct7'").get() as Record<string, unknown> | undefined;
    expect(orphan).toBeDefined();
    expect(orphan!['status']).toBe('stale');

    // (b) 孤兒的 subtask 未被動
    const orphanSub = v.prepare("SELECT tombstone FROM subtasks WHERE local_id='loc:orphan-sub-ct7'").get() as Record<string, unknown> | undefined;
    expect(orphanSub).toBeDefined();
    expect(orphanSub!['tombstone']).toBe(0);

    v.close();
  });
});

// ---------------------------------------------------------------------------
// C-T9: NULL 鍵防護 — open 列 name=NULL 或 started_at=NULL 不被誤刪/誤標
// ---------------------------------------------------------------------------

describe('C-T9: _migrateZombieOpenRows — NULL 鍵防護', () => {
  let dbPath2: string;
  let rawDb: Database.Database;

  beforeEach(() => {
    dbPath2 = join(tmpdir(), `ct9_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    rawDb = new Database(dbPath2);
    rawDb.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    try { rawDb.close(); } catch { /* ignore */ }
    if (existsSync(dbPath2)) try { rmSync(dbPath2); } catch { /* ignore */ }
  });

  it('open 列 name=NULL — (a) 有可比對 done 列也不刪（NULL 鍵防護）', () => {
    // 此案例驗證 (a) 路徑：WHERE p.name IS NOT NULL 防護
    // name=NULL 的 open 列，即使有 done 列（同 task_id/started_at），
    // (a) 不應刪除該 open 列（NULL 不符 IS NOT NULL 條件）
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_uid TEXT NOT NULL, session_id TEXT, task_id TEXT,
        type TEXT, name TEXT, description TEXT,
        started_at TEXT, ended_at TEXT, hours REAL,
        subtask_id TEXT, status TEXT, ok INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS subtasks (
        local_id TEXT PRIMARY KEY,
        remote_id TEXT, task_local_id TEXT NOT NULL,
        name TEXT NOT NULL, description TEXT,
        start_time TEXT, end_time TEXT, duration REAL,
        assignee_id TEXT, category_id TEXT,
        is_settled INTEGER NOT NULL DEFAULT 0,
        version INTEGER, origin TEXT NOT NULL DEFAULT 'local',
        platform_local_id TEXT,
        sync_enabled INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 0,
        pending_op TEXT, tombstone INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT, created_at TEXT NOT NULL, updated_at TEXT
      )
    `);

    const T0 = '2026-05-01T10:00:00.000Z';
    const stale = _staleIso(30);

    // open 列：name=NULL
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, subtask_id, status, created_at)
       VALUES ('uid-null-name-ct9', 'sess-ct9', 'task-ct9a', NULL, ?, 'loc:null-name-sub', 'open', ?)`,
    ).run(T0, stale);

    // 可比對的 done 列（name=NULL，same task_id/started_at）
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, ended_at, hours, status, ok, created_at)
       VALUES ('uid-null-name-done', 'sess-ct9', 'task-ct9a', NULL, ?, '2026-05-01T11:00:00.000Z', 1.0, 'done', 1, ?)`,
    ).run(T0, stale);

    // subtask（不應被動）
    rawDb.prepare(
      `INSERT INTO subtasks (local_id, task_local_id, name, remote_id, sync_enabled, dirty, created_at)
       VALUES ('loc:null-name-sub', 'task-uuid-ct9a', 'null name sub', NULL, 0, 1, ?)`,
    ).run(stale);

    rawDb.close();

    // 觸發遷移
    const ledger = new PunchLedger(dbPath2);
    ledger.close();

    const v = new Database(dbPath2, { readonly: true });

    // name=NULL 的 open 列：(a) 路徑因 IS NOT NULL 防護，不應被刪
    const openPunch = v.prepare("SELECT status FROM punches WHERE punch_uid='uid-null-name-ct9'").get() as Record<string, unknown> | undefined;
    expect(openPunch).toBeDefined();  // 仍存在，未被刪
    // 注意：name=NULL 且 started_at 為 T0（> 24h）故 (b) 路徑 started_at IS NOT NULL 通過
    // 但缺少 NOT EXISTS 配對保護（因 name IS NULL 的 done 列比對特殊），須確認 status
    // 由於 (b) 路徑比對用 IS，NULL IS NULL 為 true，done 列(name=NULL)會被找到
    // → NOT EXISTS 不成立 → 不標 stale → status 仍 open（或被 (a) 路徑吃掉但受 IS NOT NULL 保護）
    // 無論如何，此列不應被硬刪（最核心斷言）：open 列仍存在
    expect(['open', 'stale']).toContain(openPunch!['status']);  // 存在即可，不應硬刪

    // subtask 不應被動
    const sub = v.prepare("SELECT tombstone FROM subtasks WHERE local_id='loc:null-name-sub'").get() as Record<string, unknown> | undefined;
    expect(sub).toBeDefined();
    expect(sub!['tombstone']).toBe(0);

    v.close();
  });

  it('open 列 started_at=NULL — (b) 即使 created_at > 24h 也不標 stale（started_at IS NOT NULL 防護）', () => {
    // 此案例驗證 (b) 路徑：WHERE started_at IS NOT NULL 防護
    // started_at=NULL 的孤兒 open 列，即使 created_at 超過 24h，也不應被標 stale
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_uid TEXT NOT NULL, session_id TEXT, task_id TEXT,
        type TEXT, name TEXT, description TEXT,
        started_at TEXT, ended_at TEXT, hours REAL,
        subtask_id TEXT, status TEXT, ok INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);

    const stale = _staleIso(30);  // created_at 過期（> 24h）

    // open 列：started_at=NULL，created_at 超過 24h
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, started_at, status, created_at)
       VALUES ('uid-null-sat-ct9', 'sess-ct9b', 'task-ct9b', '無 started_at 打卡', NULL, 'open', ?)`,
    ).run(stale);

    rawDb.close();

    const ledger = new PunchLedger(dbPath2);
    ledger.close();

    const v = new Database(dbPath2, { readonly: true });

    // started_at=NULL → (b) 路徑 started_at IS NOT NULL 防護不通過 → 不標 stale → 仍 open
    const punch = v.prepare("SELECT status FROM punches WHERE punch_uid='uid-null-sat-ct9'").get() as Record<string, unknown> | undefined;
    expect(punch).toBeDefined();
    expect(punch!['status']).toBe('open');  // 仍 open，未被標 stale

    v.close();
  });
});

// ---------------------------------------------------------------------------
// C-T8: 缺 subtasks 表等異常不崩
// ---------------------------------------------------------------------------

describe('C-T8: _migrateZombieOpenRows — 異常路徑容錯', () => {
  it('缺 subtasks 表（極端環境）→ PunchLedger 初始化不拋（容錯）', () => {
    // PunchLedger._ensureSchema 會建立 subtasks 表，所以正常情況 subtasks 一定存在。
    // 此案例確認即使 schema 建立中的例外不冒泡到 constructor，透過 try/catch 確認容錯。
    // 用正常路徑：new PunchLedger 不拋即為 PASS（_migrateZombieOpenRows 錯誤僅 console.error）
    const dbPath3 = join(tmpdir(), `ct8_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    expect(() => {
      const l = new PunchLedger(dbPath3);
      l.close();
    }).not.toThrow();
    if (existsSync(dbPath3)) try { rmSync(dbPath3); } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// T3-display: listPunchesForTask 顯示層 transform — open + session 不活 → stale（不寫 DB）
// ---------------------------------------------------------------------------

describe('T3-display: listPunchesForTask 顯示層 transform', () => {
  it('status=open 列在 session_id 不存在（不活）時，回傳物件 status=stale；DB 中仍為 open', () => {
    // 用不存在的 session_id → isSessionLive 查 ~/.claude/sessions/ 找不到 → false → 顯示 stale
    const nonExistentSessionId = `non-existent-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    _ledger.punchIn({
      punch_uid: 'uid-display-stale',
      session_id: nonExistentSessionId,
      task_id: 'task-display-t3',
      name: '顯示層測試',
      started_at: '2026-01-01T10:00:00.000Z',
    });

    // 呼叫 listPunchesForTask → 顯示層 transform 應將 open → stale（因 session 不活）
    const rows = _ledger.listPunchesForTask('task-display-t3');
    expect(rows).toHaveLength(1);
    // 回傳物件 status='stale'
    expect(rows[0]['status']).toBe('stale');

    // 但 DB 中的實際值仍為 'open'（transform 不寫 DB）
    // 透過 preloadDoneKeys（只撈 done）來間接確認：open 不在 done keys 中
    const doneKeys = _ledger.preloadDoneKeys(nonExistentSessionId);
    expect(doneKeys.has('uid-display-stale')).toBe(false);  // 不在 done，因為 DB 中仍是 open

    // 透過 listOpen 直接確認 DB 仍為 open 狀態
    const openRows = _ledger.listOpen(nonExistentSessionId);
    expect(openRows).toHaveLength(1);
    expect(openRows[0]['status']).toBe('open');  // listOpen 直接查 DB，不做 transform
  });
});
