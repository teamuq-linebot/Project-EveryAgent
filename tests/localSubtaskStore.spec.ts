/**
 * localSubtaskStore.spec.ts — SqliteTaskRepository 打卡 local-first 整合測試（純本地版）
 *
 * 純本地版：已移除雲端同步欄位（remote_id / origin / sync_enabled / dirty / pending_op /
 *   tombstone）。tasks 一律用 local_id（UUID）為主鍵；createLocalSubtask 接收並儲存
 *   task_local_id（即 tasks.local_id）作為 FK。
 *
 * 覆蓋場景：
 *  TS1: createLocalSubtask — tasks 先插一筆（local_id=UUID）→ 以 task_local_id=UUID 打卡：
 *         - subtasks.task_local_id = UUID（F-PP-1：FK 寫 parent.local_id）
 *         - punches.task_id = UUID（維持 input.task_local_id）
 *         - punches.subtask_id = UUID（純本地 genLocalId()，非 loc: 前綴）
 *         - 同 txn 兩列都在（原子性）
 *
 *  TS2: settleLocalSubtask — 補 end/duration/description、is_settled=1、punch 改 done；
 *       跨 task 不污染（同 punch_uid 兩個 task 各一筆，settle 只動目標 task 那筆，F-PP-3）
 *
 *  TS3: recordLocalOneshot — 一次寫齊兩列、is_settled=1、status='done'
 *
 *  TS4: 冪等（F-PP-4）:
 *       4a: 同 (task_id, punch_uid) 重呼叫 createLocalSubtask → 不產生第二個 subtask，
 *           回傳既有 localId
 *       4b: 同 (task_id, punch_uid) 重呼叫 recordLocalOneshot → 不產生第二個 subtask，
 *           回傳既有 localId
 *
 *  TS5: 去重遷移（F2）— 手動造舊狀態（舊 session_uid 索引 + 重複 punch 列）→
 *       new PunchLedger(dbPath) 觸發 _migrateToTaskUidKey → 斷言：
 *         - 重複列清掉（每組 task_id+punch_uid 只保留 id 最小那筆）
 *         - 新 partial index idx_punch_task_uid 存在
 *         - 舊索引 idx_punch_uid 不存在
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteTaskRepository, ensureSchema } from '../src/main/repo/sqliteTaskRepository';
import { PunchLedger } from '../src/main/db/punchLedger';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTmpPath(): string {
  return join(
    tmpdir(),
    `local_subtask_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
  );
}

/**
 * 開 tmp DB → 建 schema（ensureSchema 含所有表，包含 tasks/subtasks/punches）
 * → 建 SqliteTaskRepository（注入同一連線）。
 * 返回 { db, repo, dbPath }，呼叫端負責 afterEach 清理。
 */
function openFresh(): { db: Database.Database; repo: SqliteTaskRepository; dbPath: string } {
  const dbPath = makeTmpPath();
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  ensureSchema(db);
  const repo = new SqliteTaskRepository(db);
  return { db, repo, dbPath };
}

const NOW = '2026-01-01T00:00:00.000Z';

// ---------------------------------------------------------------------------
// TS1: createLocalSubtask — F-PP-1 FK 驗證 + 原子性
// ---------------------------------------------------------------------------

describe('TS1: createLocalSubtask — subtasks.task_local_id 寫 UUID FK，punches.task_id 寫 task UUID', () => {
  let db: Database.Database;
  let repo: SqliteTaskRepository;
  let dbPath: string;

  beforeEach(() => {
    const f = openFresh();
    db = f.db;
    repo = f.repo;
    dbPath = f.dbPath;
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    if (existsSync(dbPath)) try { rmSync(dbPath); } catch { /* ignore */ }
  });

  it('task local_id=UUID → subtasks.task_local_id=UUID、punches.subtask_id 為 UUID（原子性）', () => {
    const taskUUID = 'aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb';

    // 純本地：tasks 只有本地欄位（無 remote_id / origin / sync_enabled / dirty / tombstone）
    db.prepare(
      `INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)`,
    ).run(taskUUID, '測試任務', NOW);

    // 以 task_local_id=taskUUID 呼叫 createLocalSubtask
    const result = repo.createLocalSubtask({
      punch_uid:     'punch-uid-001',
      session_id:    'sess-ts1',
      task_local_id: taskUUID,
      type:          'main',
      name:          '後端整合',
      start_time:    NOW,
    });

    // 純本地版：localId 為 UUID（不再使用 loc: 前綴）
    expect(result.localId).toBeTruthy();
    expect(typeof result.localId).toBe('string');
    const locId = result.localId;

    // 斷言 subtasks.task_local_id = taskUUID（F-PP-1：parent.local_id）
    const subtask = db
      .prepare('SELECT local_id, task_local_id, name, is_settled FROM subtasks WHERE local_id = ?')
      .get(locId) as Record<string, unknown> | undefined;
    expect(subtask).toBeDefined();
    expect(subtask!['task_local_id']).toBe(taskUUID);   // F-PP-1：UUID FK
    expect(subtask!['is_settled']).toBe(0);              // 尚未 settle

    // 斷言 punches.task_id = taskUUID（維持 input.task_local_id）
    const punch = db
      .prepare('SELECT task_id, subtask_id, status FROM punches WHERE punch_uid = ? AND task_id = ?')
      .get('punch-uid-001', taskUUID) as Record<string, unknown> | undefined;
    expect(punch).toBeDefined();
    expect(punch!['task_id']).toBe(taskUUID);
    expect(punch!['subtask_id']).toBe(locId);            // subtask_id = UUID（消除中間態）
    expect(punch!['status']).toBe('open');

    // 原子性：同 txn，兩列都在
    const subtaskCount = (db.prepare('SELECT COUNT(*) AS c FROM subtasks WHERE local_id = ?').get(locId) as { c: number })['c'];
    const punchCount = (db.prepare('SELECT COUNT(*) AS c FROM punches WHERE punch_uid = ?').get('punch-uid-001') as { c: number })['c'];
    expect(subtaskCount).toBe(1);
    expect(punchCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TS2: settleLocalSubtask — 補欄位 + 跨 task 不污染（F-PP-3）
// ---------------------------------------------------------------------------

describe('TS2: settleLocalSubtask — 補 end/duration/description + 跨 task 不污染', () => {
  let db: Database.Database;
  let repo: SqliteTaskRepository;
  let dbPath: string;

  beforeEach(() => {
    const f = openFresh();
    db = f.db;
    repo = f.repo;
    dbPath = f.dbPath;
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    if (existsSync(dbPath)) try { rmSync(dbPath); } catch { /* ignore */ }
  });

  it('settle 補欄位：subtask is_settled=1, punch status=done', () => {
    const taskUUID = 'aaaabbbb-0001-0001-0001-000000000001';
    db.prepare(
      `INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)`,
    ).run(taskUUID, '任務A', NOW);

    const { localId } = repo.createLocalSubtask({
      punch_uid:     'punch-uid-settle',
      session_id:    'sess-ts2',
      task_local_id: taskUUID,
      type:          'main',
      name:          '子任務A',
      start_time:    '2026-01-01T09:00:00.000Z',
    });

    repo.settleLocalSubtask({
      punch_uid:   'punch-uid-settle',
      local_id:    localId,
      task_id:     taskUUID,
      end_time:    '2026-01-01T11:00:00.000Z',
      duration:    2.0,
      description: '完成後端整合',
    });

    const subtask = db.prepare('SELECT is_settled, end_time, duration, description FROM subtasks WHERE local_id = ?').get(localId) as Record<string, unknown>;
    expect(subtask['is_settled']).toBe(1);
    expect(subtask['end_time']).toBe('2026-01-01T11:00:00.000Z');
    expect(subtask['duration']).toBeCloseTo(2.0);
    expect(subtask['description']).toBe('完成後端整合');
    // 純本地版：subtasks 無 dirty 欄

    const punch = db.prepare('SELECT status, hours, ended_at FROM punches WHERE punch_uid = ? AND task_id = ?').get('punch-uid-settle', taskUUID) as Record<string, unknown>;
    expect(punch['status']).toBe('done');
    expect(punch['hours']).toBeCloseTo(2.0);
    expect(punch['ended_at']).toBe('2026-01-01T11:00:00.000Z');
  });

  // §dup-fix（防呆 ②a）：同 punch_uid 已被「其他任務」物化 → 第二個 task 不再生第二筆 subtask。
  it('§dup-fix ②a：同 punch_uid 第二個 task createLocalSubtask → 不建第二筆，回傳既有 foreign localId', () => {
    const uuidA = 'aaaabbbb-0002-0001-0001-000000000001';
    const uuidB = 'aaaabbbb-0002-0001-0001-000000000002';
    db.prepare(
      `INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)`,
    ).run(uuidA, '任務A', NOW);
    db.prepare(
      `INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)`,
    ).run(uuidB, '任務B', NOW);

    // task A 先物化一筆
    const { localId: locA } = repo.createLocalSubtask({
      punch_uid: 'shared-uid-fp3', session_id: 'sess-A', task_local_id: uuidA,
      type: 'main', name: '子任務A', start_time: NOW,
    });
    // task B 物化「同一 punch_uid」→ 防呆觸發：回傳 task A 的 localId，不建新列
    const { localId: locB } = repo.createLocalSubtask({
      punch_uid: 'shared-uid-fp3', session_id: 'sess-B', task_local_id: uuidB,
      type: 'main', name: '子任務B', start_time: NOW,
    });
    expect(locB).toBe(locA);                       // adopt 既有 foreign localId（非新 UUID）

    // 全庫只有一筆 subtask、一筆 punch（task A 的）；task B 沒有自己的列
    const subCount = (db.prepare('SELECT COUNT(*) AS c FROM subtasks').get() as { c: number }).c;
    const punchCount = (db.prepare('SELECT COUNT(*) AS c FROM punches WHERE punch_uid = ?').get('shared-uid-fp3') as { c: number }).c;
    expect(subCount).toBe(1);
    expect(punchCount).toBe(1);
    const punchB = db.prepare('SELECT status FROM punches WHERE punch_uid = ? AND task_id = ?').get('shared-uid-fp3', uuidB);
    expect(punchB).toBeUndefined();                // task B 無自己的 punch 列
  });

  // §dup-fix（防呆 ②b）：若某 task 仍持有別任務 subtask 的 local_id（防呆 adopt 後的 foreign 參照），
  //   以該 task settle 必須是 no-op，不得污染別任務的 subtask；但真正不存在的 local_id 仍應拋錯。
  it('§dup-fix ②b：settleLocalSubtask 以「別任務」身分結算 foreign subtask → no-op 不污染；真缺漏仍拋', () => {
    const uuidA = 'aaaabbbb-0003-0001-0001-000000000001';
    const uuidB = 'aaaabbbb-0003-0001-0001-000000000002';
    db.prepare(
      `INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)`,
    ).run(uuidA, '任務A', NOW);
    db.prepare(
      `INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)`,
    ).run(uuidB, '任務B', NOW);

    // task A 物化一筆（其 subtask.task_local_id = uuidA）
    const { localId: locA } = repo.createLocalSubtask({
      punch_uid: 'shared-uid-b2', session_id: 'sess-A', task_local_id: uuidA,
      type: 'main', name: '子任務A', start_time: NOW,
    });

    // task B 拿 task A 的 localId 嘗試 settle → 應為 no-op（task A subtask 不變）
    repo.settleLocalSubtask({
      punch_uid: 'shared-uid-b2', local_id: locA, task_id: uuidB,
      end_time: '2026-01-01T10:00:00.000Z', duration: 9.9, description: 'B 不該污染 A',
    });
    const subAfterForeign = db.prepare('SELECT is_settled, end_time, duration, description FROM subtasks WHERE local_id = ?').get(locA) as Record<string, unknown>;
    expect(subAfterForeign['is_settled']).toBe(0);        // 未被 task B settle
    expect(subAfterForeign['end_time']).toBeNull();
    expect(subAfterForeign['duration']).toBeNull();

    // task A 自己 settle → 正常生效（驗證 guard 不誤傷本任務）
    repo.settleLocalSubtask({
      punch_uid: 'shared-uid-b2', local_id: locA, task_id: uuidA,
      end_time: '2026-01-01T11:00:00.000Z', duration: 2.0, description: 'A 結算',
    });
    const subAfterOwn = db.prepare('SELECT is_settled, duration FROM subtasks WHERE local_id = ?').get(locA) as Record<string, unknown>;
    expect(subAfterOwn['is_settled']).toBe(1);
    expect(subAfterOwn['duration']).toBeCloseTo(2.0);

    // 真正不存在的 local_id → 仍拋（保留原有錯誤偵測）
    expect(() =>
      repo.settleLocalSubtask({
        punch_uid: 'nope', local_id: 'does-not-exist', task_id: uuidA,
        end_time: NOW, duration: 1.0, description: 'x',
      }),
    ).toThrow(/subtask not found/);
  });
});

// ---------------------------------------------------------------------------
// TS3: recordLocalOneshot — 一次寫齊兩列、is_settled=1、status='done'
// ---------------------------------------------------------------------------

describe('TS3: recordLocalOneshot — 一次寫齊 subtask + punch，is_settled=1, status=done', () => {
  let db: Database.Database;
  let repo: SqliteTaskRepository;
  let dbPath: string;

  beforeEach(() => {
    const f = openFresh();
    db = f.db;
    repo = f.repo;
    dbPath = f.dbPath;
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    if (existsSync(dbPath)) try { rmSync(dbPath); } catch { /* ignore */ }
  });

  it('一次寫齊兩列，subtask is_settled=1，punch status=done', () => {
    const taskUUID = 'aaaabbbb-0003-0001-0001-000000000001';
    db.prepare(
      `INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)`,
    ).run(taskUUID, '任務C', NOW);

    const result = repo.recordLocalOneshot({
      punch_uid:     'punch-oneshot-001',
      session_id:    'sess-ts3',
      task_local_id: taskUUID,
      type:          'main',
      name:          'Oneshot 子任務',
      start_time:    '2026-01-01T09:00:00.000Z',
      end_time:      '2026-01-01T10:30:00.000Z',
      duration:      1.5,
      description:   'oneshot 一次完成',
    });

    // 純本地版：localId 為 UUID（不再使用 loc: 前綴）
    expect(result.localId).toBeTruthy();
    expect(typeof result.localId).toBe('string');
    const locId = result.localId;

    // subtasks: is_settled=1，含完整 start/end/duration/description
    const subtask = db.prepare(
      'SELECT local_id, task_local_id, is_settled, start_time, end_time, duration, description FROM subtasks WHERE local_id = ?',
    ).get(locId) as Record<string, unknown>;
    expect(subtask['task_local_id']).toBe(taskUUID);    // F-PP-1：UUID FK
    expect(subtask['is_settled']).toBe(1);
    // 純本地版：無 dirty / pending_op 欄
    expect(subtask['start_time']).toBe('2026-01-01T09:00:00.000Z');
    expect(subtask['end_time']).toBe('2026-01-01T10:30:00.000Z');
    expect(subtask['duration']).toBeCloseTo(1.5);
    expect(subtask['description']).toBe('oneshot 一次完成');

    // punches: status='done', ok=1，含 subtask_id=UUID
    const punch = db.prepare(
      'SELECT task_id, subtask_id, status, ok, ended_at, hours FROM punches WHERE punch_uid = ? AND task_id = ?',
    ).get('punch-oneshot-001', taskUUID) as Record<string, unknown>;
    expect(punch['task_id']).toBe(taskUUID);
    expect(punch['subtask_id']).toBe(locId);
    expect(punch['status']).toBe('done');
    expect(punch['ok']).toBe(1);
    expect(punch['ended_at']).toBe('2026-01-01T10:30:00.000Z');
    expect(punch['hours']).toBeCloseTo(1.5);
  });
});

// ---------------------------------------------------------------------------
// TS4: 冪等（F-PP-4）
// ---------------------------------------------------------------------------

describe('TS4: 冪等（F-PP-4）— 重呼叫不產生第二個 subtask，回傳既有 localId', () => {
  let db: Database.Database;
  let repo: SqliteTaskRepository;
  let dbPath: string;

  beforeEach(() => {
    const f = openFresh();
    db = f.db;
    repo = f.repo;
    dbPath = f.dbPath;
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    if (existsSync(dbPath)) try { rmSync(dbPath); } catch { /* ignore */ }
  });

  it('TS4a: createLocalSubtask 同 (task_id, punch_uid) 重呼叫 → 回傳既有 localId，不建新 subtask', () => {
    const taskUUID = 'aaaabbbb-0004-0001-0001-000000000001';
    db.prepare(
      `INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)`,
    ).run(taskUUID, '任務D', NOW);

    // 第一次呼叫
    const first = repo.createLocalSubtask({
      punch_uid:     'punch-idem-create',
      session_id:    'sess-ts4a',
      task_local_id: taskUUID,
      type:          'main',
      name:          '冪等測試',
      start_time:    NOW,
    });

    // 第二次呼叫（同 task_id + 同 punch_uid）
    const second = repo.createLocalSubtask({
      punch_uid:     'punch-idem-create',
      session_id:    'sess-ts4a-again',
      task_local_id: taskUUID,
      type:          'main',
      name:          '冪等測試（第二次，應忽略）',
      start_time:    '2026-01-02T00:00:00.000Z',
    });

    // 回傳既有 localId，非新產生的 UUID
    expect(second.localId).toBe(first.localId);

    // subtasks 只有一列
    const subtaskCount = (db.prepare('SELECT COUNT(*) AS c FROM subtasks WHERE task_local_id = ?').get(taskUUID) as { c: number })['c'];
    expect(subtaskCount).toBe(1);

    // punches 只有一列
    const punchCount = (db.prepare('SELECT COUNT(*) AS c FROM punches WHERE punch_uid = ? AND task_id = ?').get('punch-idem-create', taskUUID) as { c: number })['c'];
    expect(punchCount).toBe(1);
  });

  it('TS4b: recordLocalOneshot 同 (task_id, punch_uid) 重呼叫 → 回傳既有 localId，不建新 subtask', () => {
    const taskUUID = 'aaaabbbb-0004-0002-0001-000000000001';
    db.prepare(
      `INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)`,
    ).run(taskUUID, '任務E', NOW);

    // 第一次 oneshot
    const first = repo.recordLocalOneshot({
      punch_uid:     'punch-idem-oneshot',
      session_id:    'sess-ts4b',
      task_local_id: taskUUID,
      type:          'main',
      name:          '冪等 Oneshot',
      start_time:    NOW,
      end_time:      '2026-01-01T01:00:00.000Z',
      duration:      1.0,
      description:   '初次',
    });

    // 第二次 oneshot（同 task_id + 同 punch_uid）
    const second = repo.recordLocalOneshot({
      punch_uid:     'punch-idem-oneshot',
      session_id:    'sess-ts4b-again',
      task_local_id: taskUUID,
      type:          'main',
      name:          '冪等 Oneshot（第二次，應忽略）',
      start_time:    '2026-01-02T00:00:00.000Z',
      end_time:      '2026-01-02T02:00:00.000Z',
      duration:      2.0,
      description:   '第二次',
    });

    // 回傳既有 localId
    expect(second.localId).toBe(first.localId);

    // subtasks 只有一列
    const subtaskCount = (db.prepare('SELECT COUNT(*) AS c FROM subtasks WHERE task_local_id = ?').get(taskUUID) as { c: number })['c'];
    expect(subtaskCount).toBe(1);

    // punches 只有一列
    const punchCount = (db.prepare('SELECT COUNT(*) AS c FROM punches WHERE punch_uid = ? AND task_id = ?').get('punch-idem-oneshot', taskUUID) as { c: number })['c'];
    expect(punchCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TS5: 去重遷移（F2）— 手動造舊狀態，PunchLedger 初始化後驗證遷移結果
// ---------------------------------------------------------------------------

describe('TS5: 去重遷移（F2）— 手動造舊索引 + 重複列 → new PunchLedger 遷移後驗證', () => {
  let dbPath: string;
  let rawDb: Database.Database;

  beforeEach(() => {
    dbPath = makeTmpPath();
    // 用裸連線，不跑 ensureSchema / PunchLedger，手動造舊狀態
    rawDb = new Database(dbPath);
    rawDb.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    try { rawDb.close(); } catch { /* ignore */ }
    if (existsSync(dbPath)) try { rmSync(dbPath); } catch { /* ignore */ }
  });

  it('舊索引 + 重複列 → PunchLedger 初始化後：重複清掉保留 min id、新 partial index 存在、舊索引不存在', () => {
    // 1. 手動建 punches 表（最小 DDL，不含新 partial index）
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS punches (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        punch_uid  TEXT NOT NULL,
        session_id TEXT, task_id TEXT,
        type TEXT, name TEXT, description TEXT,
        started_at TEXT, ended_at TEXT, hours REAL,
        subtask_id TEXT,
        status TEXT, ok INTEGER, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT
      )
    `);

    // 2. 建「舊」UNIQUE INDEX（session_id, punch_uid）— 模擬遷移前狀態
    rawDb.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_punch_uid ON punches(session_id, punch_uid)',
    );

    // 3. 插入包含重複 (task_id, punch_uid) 的資料
    rawDb.exec('DROP INDEX IF EXISTS idx_punch_uid'); // 先 DROP 舊索引，才能插重複 (task_id, punch_uid) 而不衝突
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, status, created_at)
       VALUES (?, ?, ?, ?, 'done', ?)`,
    ).run('uid-A', 'sess-1', 'task-X', '第一次', '2026-01-01T00:00:00.000Z'); // id=1
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, status, created_at)
       VALUES (?, ?, ?, ?, 'done', ?)`,
    ).run('uid-A', 'sess-2', 'task-X', '第二次（重複）', '2026-01-01T01:00:00.000Z'); // id=2 → 遷移後刪（同 task_id+punch_uid）
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, status, created_at)
       VALUES (?, ?, ?, ?, 'done', ?)`,
    ).run('uid-B', 'sess-1', 'task-Y', '單筆', '2026-01-01T02:00:00.000Z'); // id=3 → 保留
    // NULL task_id：用不同 punch_uid（uid-C / uid-D），GROUP BY 視為不同組，各保留一筆
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, status, created_at)
       VALUES (?, ?, ?, ?, 'done', ?)`,
    ).run('uid-C', 'sess-1', null, 'NULL task uid-C', '2026-01-01T03:00:00.000Z'); // id=4 → 保留
    rawDb.prepare(
      `INSERT INTO punches (punch_uid, session_id, task_id, name, status, created_at)
       VALUES (?, ?, ?, ?, 'done', ?)`,
    ).run('uid-D', 'sess-1', null, 'NULL task uid-D', '2026-01-01T04:00:00.000Z'); // id=5 → 保留

    // 4. 重建舊索引（模擬遷移前狀態），然後關閉裸連線
    rawDb.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_punch_uid ON punches(session_id, punch_uid)',
    );
    rawDb.close();

    // 5. new PunchLedger(dbPath) → 觸發 _ensureSchema → _migrateToTaskUidKey
    const ledger = new PunchLedger(dbPath);
    ledger.close();

    // 6. 驗證（用新裸連線稽核結果）
    const verifyDb = new Database(dbPath, { readonly: true });

    // 6a. 重複列清掉：(task-X, uid-A) 應只剩 id=1（最小），id=2 被刪
    const punchesTaskX = verifyDb
      .prepare('SELECT id, name FROM punches WHERE task_id = ? AND punch_uid = ? ORDER BY id')
      .all('task-X', 'uid-A') as Array<{ id: number; name: string }>;
    expect(punchesTaskX).toHaveLength(1);
    expect(punchesTaskX[0]['id']).toBe(1);
    expect(punchesTaskX[0]['name']).toBe('第一次');

    // 6b. 單筆 (task-Y, uid-B) 保留
    const punchesTaskY = verifyDb
      .prepare('SELECT id FROM punches WHERE task_id = ? AND punch_uid = ?')
      .all('task-Y', 'uid-B') as Array<{ id: number }>;
    expect(punchesTaskY).toHaveLength(1);

    // 6c. NULL task_id 兩筆（不同 punch_uid）各保留一筆
    const nullC = verifyDb
      .prepare('SELECT id FROM punches WHERE task_id IS NULL AND punch_uid = ?')
      .all('uid-C') as Array<{ id: number }>;
    const nullD = verifyDb
      .prepare('SELECT id FROM punches WHERE task_id IS NULL AND punch_uid = ?')
      .all('uid-D') as Array<{ id: number }>;
    expect(nullC).toHaveLength(1);  // id=4 保留
    expect(nullD).toHaveLength(1);  // id=5 保留

    // 6d. 新 partial index idx_punch_task_uid 存在
    const newIdx = verifyDb
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_punch_task_uid'")
      .get() as { name: string; sql: string } | undefined;
    expect(newIdx).toBeDefined();
    expect(newIdx!['sql']).toMatch(/WHERE task_id IS NOT NULL/i);

    // 6e. 舊索引 idx_punch_uid 不存在（DROP INDEX IF EXISTS idx_punch_uid 已清除）
    const oldIdx = verifyDb
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_punch_uid'")
      .get();
    expect(oldIdx).toBeUndefined();

    verifyDb.close();
  });
});
