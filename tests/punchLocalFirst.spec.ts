/**
 * punchLocalFirst.spec.ts — 打卡 local-first + crash-recovery hard gate（plan_v1 §2.9 / §2.14 / §9 Phase 6）。
 *
 * 驗收（plan §9 Phase 6「crash-recovery 是本計畫核心承諾」hard gate）：
 *   P1: 離線打卡寫 punches + subtasks（subtask origin='local'、pending_op='create'、dirty=1
 *       — 即 plan 文字所稱 outbox「pending_create」；本 repo schema 以 pending_op='create' 表達）。
 *   P2: punchIn + createLocalSubtask 同 transaction（中間態不存在 — subtask_id=null 的 open 列永不出現）。
 *   P3: `loc:` 暫鍵跨重啟兩段接續（preload openMap：listOpen → PunchService.preload → end 階段帶回 subtask_id）。
 *   P4: scan_watermarks 寫入與續掃（sinceMs 走水位非 Date.now()；computeWatermarkMs 規則）。
 *   P5: done_keys 防重複補卡（preloadDoneKeys → 已 done 的 uid 不重複 punch）。
 *   P6: punch_artifacts 落表（end / oneshot 路徑；insertPunchArtifacts 冪等）。
 *
 * 隔離手法（參考 punchLedger.spec.ts / punchService.spec.ts / sqliteTaskRepository.spec.ts）：
 *   - SqliteTaskRepository / SqliteScanWatermarkStore：注入同一 in-memory :memory: 連線。
 *   - PunchLedger：注入獨立 tmp file DB（其 schema 與 repo punches 表 byte-identical）。
 *   - PunchExecutor：注入 mock ILocalSubtaskStore + mock IPunchArtifactStore 驗三段呼叫透明。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync, existsSync } from 'fs'
import { SqliteTaskRepository, ensureSchema } from '../src/main/repo/sqliteTaskRepository'
import {
  SqliteScanWatermarkStore,
  computeWatermarkMs,
} from '../src/main/worktime/scanWatermarkStore'
import { PunchLedger } from '../src/main/db/punchLedger'
import { PunchService } from '../src/main/services/punchService'
import { PunchBuilderMixin } from '../src/main/services/punchBuilder'
import {
  PunchExecutor,
  type ILocalSubtaskStore,
  type IPunchArtifactStore,
  type PunchArtifactItem,
} from '../src/main/monitor/punchExecutor'
import type { PunchAction } from '../src/main/services/punchService'

// ---------------------------------------------------------------------------
// 輔助
// ---------------------------------------------------------------------------

function makeRepo(): { repo: SqliteTaskRepository; db: Database.Database } {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureSchema(db)
  return { repo: new SqliteTaskRepository(db), db }
}

/**
 * 建一個 parent task（createLocalSubtask 要求 FK→tasks.local_id）。
 * 純本地版：tasks 無 origin / sync_enabled / platform_local_id / dirty / tombstone。
 */
function insertTask(
  db: Database.Database,
  localId: string,
): void {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)',
  ).run(localId, '父任務', now)
}

class FakeBuilder extends PunchBuilderMixin {
  constructor(sessionId = 'sessLOCAL12345678') {
    super(sessionId)
  }
}

// ===========================================================================
// P1 / P2: 離線打卡寫 punches + subtasks（同 txn，中間態不存在）
// ===========================================================================

describe('P1/P2: 離線打卡 createLocalSubtask（subtask + punchIn 同 txn）', () => {
  let repo: SqliteTaskRepository
  let db: Database.Database

  beforeEach(() => {
    ;({ repo, db } = makeRepo())
    insertTask(db, 'task-1')
  })

  it('P1a: createLocalSubtask 寫 subtask（UUID local_id、is_settled=0）', () => {
    const { localId } = repo.createLocalSubtask({
      punch_uid: 'uid-001',
      session_id: 'sess-A',
      task_local_id: 'task-1',
      type: 'main',
      name: '離線打卡',
      start_time: '2026-06-01T10:00:00.000Z',
    })
    // 純本地版：local_id 為 UUID（不再使用 loc: 前綴）。
    expect(localId).toBeTruthy()
    expect(typeof localId).toBe('string')

    const sub = db.prepare('SELECT * FROM subtasks WHERE local_id = ?').get(localId) as Record<
      string,
      unknown
    >
    expect(sub).toBeDefined()
    expect(sub['is_settled']).toBe(0)
    expect(sub['name']).toBe('離線打卡')
    expect(sub['start_time']).toBe('2026-06-01T10:00:00.000Z')
    expect(sub['task_local_id']).toBe('task-1')
  })

  it('P1b: createLocalSubtask 同時寫 punches（status=open、subtask_id=loc:）', () => {
    const { localId } = repo.createLocalSubtask({
      punch_uid: 'uid-001',
      session_id: 'sess-A',
      task_local_id: 'task-1',
      type: 'main',
      name: '離線打卡',
      start_time: '2026-06-01T10:00:00.000Z',
    })
    const punch = db
      .prepare('SELECT * FROM punches WHERE session_id = ? AND punch_uid = ?')
      .get('sess-A', 'uid-001') as Record<string, unknown>
    expect(punch).toBeDefined()
    expect(punch['status']).toBe('open')
    // 關鍵（§2.14 情境 D）：open 列的 subtask_id 直帶 loc: 暫鍵 — 非 null 中間態。
    expect(punch['subtask_id']).toBe(localId)
  })

  it('P2a: 中間態不存在 — 不存在 subtask_id=null 的 open punch 列', () => {
    repo.createLocalSubtask({
      punch_uid: 'uid-001',
      session_id: 'sess-A',
      task_local_id: 'task-1',
      type: 'main',
      name: '離線打卡',
      start_time: '2026-06-01T10:00:00.000Z',
    })
    const nullMidState = db
      .prepare("SELECT COUNT(*) AS n FROM punches WHERE status = 'open' AND subtask_id IS NULL")
      .get() as { n: number }
    expect(nullMidState.n).toBe(0)
  })

  it('P2b: 原子性 — task_local_id 缺則拋且 punches/subtasks 皆無半套', () => {
    expect(() =>
      repo.createLocalSubtask({
        punch_uid: 'uid-bad',
        session_id: 'sess-A',
        task_local_id: null,
        type: 'main',
        name: 'x',
        start_time: '2026-06-01T10:00:00.000Z',
      }),
    ).toThrow()
    // 拋在 txn 前（task_local_id 檢查），故兩表皆無此 punch_uid。
    const sub = db.prepare('SELECT COUNT(*) AS n FROM subtasks').get() as { n: number }
    const punch = db
      .prepare('SELECT COUNT(*) AS n FROM punches WHERE punch_uid = ?')
      .get('uid-bad') as { n: number }
    expect(sub.n).toBe(0)
    expect(punch.n).toBe(0)
  })

  it('P2c: settleLocalSubtask 補 end/duration/desc + punchOut 同 txn（is_settled=1、status=done）', () => {
    const { localId } = repo.createLocalSubtask({
      punch_uid: 'uid-002',
      session_id: 'sess-A',
      task_local_id: 'task-1',
      type: 'main',
      name: '離線打卡',
      start_time: '2026-06-01T10:00:00.000Z',
    })
    repo.settleLocalSubtask({
      punch_uid: 'uid-002',
      local_id: localId,
      // F-PP-3：punchOut WHERE 帶 task_id 限定（防同 punch_uid 跨 task 污染），
      // 須與 createLocalSubtask 寫入 punches.task_id 的值（task_local_id='task-1'）一致。
      task_id: 'task-1',
      end_time: '2026-06-01T11:00:00.000Z',
      duration: 1.0,
      description: '{"desc":"x"}',
    })
    const sub = db.prepare('SELECT * FROM subtasks WHERE local_id = ?').get(localId) as Record<
      string,
      unknown
    >
    expect(sub['is_settled']).toBe(1)
    expect(sub['end_time']).toBe('2026-06-01T11:00:00.000Z')
    expect(sub['duration']).toBe(1.0)
    // 純本地版：subtasks 無 pending_op / dirty 欄（已移除）。

    const punch = db
      .prepare('SELECT * FROM punches WHERE punch_uid = ?')
      .get('uid-002') as Record<string, unknown>
    expect(punch['status']).toBe('done')
    expect(punch['ended_at']).toBe('2026-06-01T11:00:00.000Z')
    expect(punch['ok']).toBe(1)
  })

  it('P2d: createLocalSubtask 冪等 — 同 (session_id, punch_uid) 第二次 punchIn 不產生第二列', () => {
    repo.createLocalSubtask({
      punch_uid: 'uid-dup',
      session_id: 'sess-A',
      task_local_id: 'task-1',
      type: 'main',
      name: '第一次',
      start_time: '2026-06-01T10:00:00.000Z',
    })
    repo.createLocalSubtask({
      punch_uid: 'uid-dup',
      session_id: 'sess-A',
      task_local_id: 'task-1',
      type: 'main',
      name: '第二次',
      start_time: '2026-06-01T10:05:00.000Z',
    })
    const punchCount = db
      .prepare('SELECT COUNT(*) AS n FROM punches WHERE session_id = ? AND punch_uid = ?')
      .get('sess-A', 'uid-dup') as { n: number }
    // punches 唯一索引 (session_id, punch_uid) + ON CONFLICT DO NOTHING → 只一列。
    expect(punchCount.n).toBe(1)
  })
})

// ===========================================================================
// P3: loc: 暫鍵跨重啟兩段接續（preload openMap）
// ===========================================================================

describe('P3: loc: 暫鍵跨重啟接續（listOpen → preload openMap → end 帶回 subtask_id）', () => {
  let repo: SqliteTaskRepository
  let db: Database.Database

  beforeEach(() => {
    ;({ repo, db } = makeRepo())
    insertTask(db, 'task-1')
  })

  it('P3a: 重啟前 punchIn（open，subtask_id=loc:）；「重啟後」preload 還原 openMap，end 接同一 loc:', () => {
    // ── 重啟前：start 段落地 open 列 ──────────────────────────────────────
    const { localId } = repo.createLocalSubtask({
      punch_uid: 'uid-X',
      session_id: 'sess-R',
      task_local_id: 'task-1',
      type: 'main',
      name: '跨重啟工作',
      start_time: '2026-06-01T10:00:00.000Z',
    })

    // ── 「重啟」：新 PunchService 從帳本 preload（模擬 MonitorController._preloadLedgerIntoService）──
    // listOpen 用同一 punches 表（repo 注入的 db）查 open 列。
    const opens = db
      .prepare(
        "SELECT punch_uid, subtask_id FROM punches WHERE session_id = ? AND status = 'open'",
      )
      .all('sess-R') as Array<{ punch_uid: string; subtask_id: string }>
    const openMap = new Map<string, string>()
    for (const o of opens) openMap.set(o.punch_uid, o.subtask_id)
    expect(openMap.get('uid-X')).toBe(localId) // loc: 暫鍵跨「重啟」還原

    const svc = new PunchService()
    svc.preload(new Set(), openMap)
    expect(svc.open_keys.get('uid-X')).toBe(localId)

    // ── 重啟後該 uid 完成 → decide_two_phase 排 end action，帶回同一 loc: subtask_id ──
    const builder = new FakeBuilder()
    const ev = {
      punch_uid: 'uid-X',
      kind: 'main',
      is_complete: true,
      duration_hours: 0.5,
      punch_name: 'main',
      started_at: '2026-06-01T10:00:00.000Z',
      ended_at: '2026-06-01T11:00:00.000Z',
      output_json_title: null,
      output_json_description: null,
      last_output: null,
      input_prompt: '',
    }
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'task-1',
      assignee_id: 1,
      session_id: 'sess-R',
      builder,
    })
    expect(actions).toHaveLength(1)
    expect(actions[0].phase).toBe('end')
    expect(actions[0].subtask_id).toBe(localId) // 兩段接續同一 loc: 鍵
    expect(actions[0].punch_uid).toBe('uid-X')
  })

  it('P3b: 已 preload 的 open uid 不會重複 punch-in（不排 start，只排 end）', () => {
    const svc = new PunchService()
    svc.preload(new Set(), new Map([['uid-X', 'loc:abc']]))
    const builder = new FakeBuilder()
    const ev = {
      punch_uid: 'uid-X',
      kind: 'main',
      is_complete: true,
      duration_hours: 0.5,
      punch_name: 'main',
      started_at: '2026-06-01T10:00:00.000Z',
      ended_at: '2026-06-01T11:00:00.000Z',
    }
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'task-1',
      assignee_id: 1,
      session_id: 'sess-R',
      builder,
    })
    // open_keys 命中 → 走 end 分支（非 start）。
    expect(actions.every((a) => a.phase !== 'start')).toBe(true)
    expect(actions[0].phase).toBe('end')
  })
})

// ===========================================================================
// P4: scan_watermarks 寫入與續掃（sinceMs 走水位非 Date.now()）
// ===========================================================================

describe('P4: scan_watermarks 持久化與續掃（computeWatermarkMs / SqliteScanWatermarkStore）', () => {
  let db: Database.Database
  let store: SqliteScanWatermarkStore

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    ensureSchema(db)
    store = new SqliteScanWatermarkStore(db)
  })

  it('P4a: advance 寫入水位、getSinceMs 讀回（無水位 → null，呼叫端退回非 Date.now()）', () => {
    expect(store.getSinceMs('sess-W')).toBeNull() // 無紀錄
    store.advance('sess-W', 1_700_000_000_000, 'claude-sess-1')
    expect(store.getSinceMs('sess-W')).toBe(1_700_000_000_000)
    const row = db
      .prepare('SELECT * FROM scan_watermarks WHERE session_id = ?')
      .get('sess-W') as Record<string, unknown>
    expect(row['consumed_pos']).toBe(1_700_000_000_000)
    expect(row['jsonl_file']).toBe('claude-sess-1')
  })

  it('P4b: 水位只進不退（advance 取 max，避免回頭漏掃）', () => {
    store.advance('sess-W', 2000)
    store.advance('sess-W', 1000) // 較小值不覆寫
    expect(store.getSinceMs('sess-W')).toBe(2000)
    store.advance('sess-W', 3000) // 較大值前進
    expect(store.getSinceMs('sess-W')).toBe(3000)
  })

  it('P4c: computeWatermarkMs — 有未完成事件 → 釘最早未完成 start（續掃不漏進行中工作）', () => {
    const toEpochMs = (v: unknown) =>
      typeof v === 'number' ? v : v ? Date.parse(String(v)) : null
    const events = [
      { started_at: 1000, is_complete: true },
      { started_at: 2000, is_complete: false }, // 未完成 → 水位釘這裡
      { started_at: 3000, is_complete: true },
    ]
    expect(computeWatermarkMs(events, toEpochMs, null)).toBe(2000)
  })

  it('P4d: computeWatermarkMs — 全部完成 → 釘最晚 start（已完成由 done_keys 去重）', () => {
    const toEpochMs = (v: unknown) => (typeof v === 'number' ? v : null)
    const events = [
      { started_at: 1000, is_complete: true },
      { started_at: 3000, is_complete: true },
      { started_at: 2000, is_complete: true },
    ]
    expect(computeWatermarkMs(events, toEpochMs, null)).toBe(3000)
  })

  it('P4e: computeWatermarkMs 與 prev 取 max（持久水位只進不退）', () => {
    const toEpochMs = (v: unknown) => (typeof v === 'number' ? v : null)
    const events = [{ started_at: 1500, is_complete: true }]
    // prev=2000 > candidate=1500 → 維持 2000。
    expect(computeWatermarkMs(events, toEpochMs, 2000)).toBe(2000)
  })
})

// ===========================================================================
// P5: done_keys 防重複補卡（preloadDoneKeys）
// ===========================================================================

describe('P5: done_keys 防重複補卡（PunchLedger.preloadDoneKeys → PunchService.preload）', () => {
  let ledgerPath: string
  let ledger: PunchLedger

  beforeEach(() => {
    ledgerPath = join(tmpdir(), `punchlf_${Date.now()}_${Math.random().toString(36).slice(2)}.db`)
    ledger = new PunchLedger(ledgerPath)
  })

  afterEach(() => {
    try {
      ledger.close()
    } catch {
      /* ignore */
    }
    if (existsSync(ledgerPath)) {
      try {
        rmSync(ledgerPath)
      } catch {
        /* ignore */
      }
    }
  })

  it('P5a: 已 done 的 uid 進 done_keys；preload 後 decide_two_phase 不重複補卡', () => {
    // 帳本已有一筆 done（模擬「重啟前已結算」）。
    ledger.recordOneshot({
      punch_uid: 'uid-done',
      session_id: 'sess-D',
      task_id: 'task-1',
      name: '已完成',
      started_at: '2026-06-01T08:00:00.000Z',
      ended_at: '2026-06-01T09:00:00.000Z',
      hours: 1.0,
    })
    const doneKeys = ledger.preloadDoneKeys('sess-D')
    expect(doneKeys.has('uid-done')).toBe(true)

    const svc = new PunchService()
    svc.preload(doneKeys, null)
    const builder = new FakeBuilder()
    // 同一 uid 的事件重掃（離線續掃會再看到）→ punched_keys 命中 → 不重複補卡。
    const ev = {
      punch_uid: 'uid-done',
      kind: 'subagent',
      is_complete: true,
      duration_hours: 1.0,
      punch_name: 'agent',
      started_at: '2026-06-01T08:00:00.000Z',
      ended_at: '2026-06-01T09:00:00.000Z',
    }
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'task-1',
      assignee_id: 1,
      session_id: 'sess-D',
      builder,
    })
    expect(actions).toEqual([])
  })

  it('P5b: 未 done 的新 uid 仍可補卡（續掃對歷史事件 oneshot 補卡）', () => {
    const doneKeys = ledger.preloadDoneKeys('sess-D') // 空
    const svc = new PunchService()
    svc.preload(doneKeys, null)
    const builder = new FakeBuilder()
    const ev = {
      punch_uid: 'uid-new',
      kind: 'subagent',
      is_complete: true,
      duration_hours: 0.5,
      punch_name: 'agent',
      started_at: '2026-06-01T08:00:00.000Z',
      ended_at: '2026-06-01T09:00:00.000Z',
    }
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'task-1',
      assignee_id: 1,
      session_id: 'sess-D',
      builder,
    })
    // 新 uid 無 open_keys → 走 oneshot 補卡（離線整段工作的補卡路徑）。
    expect(actions).toHaveLength(1)
    expect(actions[0].punch_uid).toBe('uid-new')
    expect(actions[0].phase).toBe('oneshot')
  })
})

// ===========================================================================
// P6: punch_artifacts 落表（end / oneshot 路徑；insertPunchArtifacts 冪等）
// ===========================================================================

describe('P6: punch_artifacts 落表（insertPunchArtifacts 冪等 + PunchExecutor 接線）', () => {
  let repo: SqliteTaskRepository
  let db: Database.Database

  beforeEach(() => {
    ;({ repo, db } = makeRepo())
  })

  it('P6a: insertPunchArtifacts 寫 hunk 級列（精確行數）；回新插入列數', () => {
    const n = repo.insertPunchArtifacts({
      punch_session_id: 'sess-A',
      punch_uid: 'uid-1',
      artifacts: [
        {
          tool_use_id: 'toolu_1',
          hunk_index: 0,
          file_path: 'src/foo.ts',
          tool: 'Edit',
          old_start: 10,
          lines_added: 3,
          lines_removed: 1,
        },
        {
          tool_use_id: 'toolu_2',
          hunk_index: 0,
          file_path: 'src/bar.ts',
          tool: 'Write',
          op_type: 'create',
          content_lines: 20,
          lines_added: 20,
          lines_removed: 0,
        },
      ],
    })
    expect(n).toBe(2)
    const rows = repo.findPunchArtifacts('sess-A', 'uid-1')
    expect(rows).toHaveLength(2)
    const edit = rows.find((r) => r.tool === 'Edit')!
    expect(edit.old_start).toBe(10)
    expect(edit.lines_added).toBe(3)
    expect(edit.lines_removed).toBe(1)
    const write = rows.find((r) => r.tool === 'Write')!
    expect(write.op_type).toBe('create')
    expect(write.content_lines).toBe(20)
  })

  it('P6b: 冪等 — 同 PK (session,uid,tool_use_id,hunk_index) 重放不重複（INSERT OR IGNORE）', () => {
    const arts: PunchArtifactItem[] = [
      {
        tool_use_id: 'toolu_1',
        hunk_index: 0,
        file_path: 'src/foo.ts',
        tool: 'Edit',
        lines_added: 3,
        lines_removed: 1,
      },
    ]
    const first = repo.insertPunchArtifacts({ punch_session_id: 'sess-A', punch_uid: 'uid-1', artifacts: arts })
    const second = repo.insertPunchArtifacts({ punch_session_id: 'sess-A', punch_uid: 'uid-1', artifacts: arts })
    expect(first).toBe(1)
    expect(second).toBe(0) // 重放命中既有 PK → 不重複
    const total = db.prepare('SELECT COUNT(*) AS n FROM punch_artifacts').get() as { n: number }
    expect(total.n).toBe(1)
  })

  it('P6c: PunchExecutor end 路徑 → 落 artifacts（artifactStore 注入透明）', async () => {
    // mock local store（三段 no-op，回 loc: id）。
    const localStore: ILocalSubtaskStore = {
      createLocalSubtask: () => ({ localId: 'loc:x' }),
      settleLocalSubtask: () => undefined,
      recordLocalOneshot: () => ({ localId: 'loc:y' }),
    }
    const captured: Array<{ punch_uid: string; artifacts: PunchArtifactItem[] }> = []
    const artifactStore: IPunchArtifactStore = {
      insertPunchArtifacts: (input) => {
        captured.push({ punch_uid: input.punch_uid, artifacts: input.artifacts })
        return input.artifacts.length
      },
    }
    const exec = new PunchExecutor({
      appsync: {} as never, // 本地路徑不打 appsync
      local: localStore,
      artifactStore,
      sessionId: 'sess-A',
    })
    const action: PunchAction = {
      punch_key: 'uid-1',
      kind: 'main',
      event_key: 'uid-1',
      punch_name: 'main',
      subtask_name: 'sub',
      description: 'd',
      task_id: 'task-1',
      assignee_id: 1,
      category_name: 'main',
      start_time: '2026-06-01T10:00:00.000Z',
      end_time: '2026-06-01T11:00:00.000Z',
      duration: 1.0,
      phase: 'end',
      punch_uid: 'uid-1',
      session_id: 'sess-A',
      subtask_id: 'loc:x',
      input_prompt: '',
      description_is_fallback: false,
      llm_source_text: '',
      artifacts: [
        {
          tool_use_id: 'toolu_1',
          hunk_index: 0,
          file_path: 'src/foo.ts',
          tool: 'Edit',
          lines_added: 3,
          lines_removed: 1,
        },
      ],
    } as unknown as PunchAction
    const result = await exec.executeAction(action)
    expect(result.ok).toBe(true)
    // end 成功後落 artifacts（純本地證據鏈）。
    expect(captured).toHaveLength(1)
    expect(captured[0].punch_uid).toBe('uid-1')
    expect(captured[0].artifacts).toHaveLength(1)
  })

  it('P6d: PunchExecutor oneshot 路徑 → 落 artifacts', async () => {
    const localStore: ILocalSubtaskStore = {
      createLocalSubtask: () => ({ localId: 'loc:x' }),
      settleLocalSubtask: () => undefined,
      recordLocalOneshot: () => ({ localId: 'loc:y' }),
    }
    const captured: PunchArtifactItem[][] = []
    const artifactStore: IPunchArtifactStore = {
      insertPunchArtifacts: (input) => {
        captured.push(input.artifacts)
        return input.artifacts.length
      },
    }
    const exec = new PunchExecutor({
      appsync: {} as never,
      local: localStore,
      artifactStore,
      sessionId: 'sess-A',
    })
    const action = {
      punch_key: 'uid-2',
      kind: 'subagent',
      punch_name: 'agent',
      subtask_name: 'sub',
      description: 'd',
      task_id: 'task-1',
      assignee_id: 1,
      category_name: 'agent',
      start_time: '2026-06-01T10:00:00.000Z',
      end_time: '2026-06-01T11:00:00.000Z',
      duration: 0.5,
      phase: 'oneshot',
      punch_uid: 'uid-2',
      session_id: 'sess-A',
      input_prompt: '',
      description_is_fallback: false,
      llm_source_text: '',
      artifacts: [
        { tool_use_id: 'toolu_9', hunk_index: 0, file_path: 'src/z.ts', tool: 'Edit', lines_added: 1, lines_removed: 0 },
      ],
    } as unknown as PunchAction
    const result = await exec.executeAction(action)
    expect(result.ok).toBe(true)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toHaveLength(1)
  })
})
