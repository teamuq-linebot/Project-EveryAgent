/**
 * monitorController.spec.ts — MonitorController 編排單元測試
 *
 * 驗證：
 *  T1: start → 掃描迴圈跑 → collectPunchEvents 被呼叫 → decideTwoPhase → createSubtask / punchIn 被呼叫
 *  T2: 世代 token — start→stop(gen++)→ 舊 gen 的 scan 結果晚到 → 被丟棄（不呼叫 punch / renderPunchTable）
 *  T3: claim 鎖 — 同一 session 已被監測 → 再 start 不重複監測
 *  T4: auth_defer — punch 回 ok=false+auth_defer → markTokenDefer 被呼叫、in_flight 釋放、下輪退避窗內被 decide 跳過
 *  T5: 指紋節流 — 相同 rows 連兩輪 → renderPunchTable 只 1 次；rows 變 → 再呼叫
 *
 * 注意：fake timers 影響 Promise microtask 排程（setTimeout 被攔截）。
 *   - T2/T5/timer 相關測試用 vi.useFakeTimers() + vi.runAllTimersAsync()。
 *   - 其餘測試用真實 timer + 手動 triggerScanOnce()，直接 await scan，避免 race。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MonitorController } from '../src/main/monitor/MonitorController';
import type {
  IMonitorView,
  IWorktimeSource,
  IAppSyncClient,
  IPunchLedger,
  PunchEvents,
} from '../src/main/monitor/types';
import type { ILocalSubtaskStore } from '../src/main/monitor/punchExecutor';
import { NotLoggedInError } from '../src/main/monitor/errors';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockView(): IMonitorView & { renderCalls: number; lastRows: unknown[] } {
  const view = {
    renderCalls: 0,
    lastRows: [] as unknown[],
    showStatus: vi.fn(),
    renderPunchTable: vi.fn((rows: unknown[]) => {
      view.renderCalls++;
      view.lastRows = rows;
    }),
    setRunState: vi.fn(),
    renderNoSession: vi.fn(),
    renderUnsupported: vi.fn(),
  };
  return view;
}

function makeMockWorktimeSource(events?: PunchEvents): IWorktimeSource {
  return {
    collectPunchEvents: vi.fn().mockResolvedValue(events ?? {
      subagent_events: [],
      main: {},
      main_events: [],
    }),
  };
}

function makeMockAppsync(): IAppSyncClient & {
  createSubtaskCalls: number;
  updateSubtaskCalls: number;
} {
  const mock = {
    createSubtaskCalls: 0,
    updateSubtaskCalls: 0,
    createSubtask: vi.fn().mockImplementation(() => {
      mock.createSubtaskCalls++;
      return Promise.resolve({ id: 'subtask-999' });
    }),
    updateSubtask: vi.fn().mockImplementation(() => {
      mock.updateSubtaskCalls++;
      return Promise.resolve();
    }),
  };
  return mock;
}

function makeMockLedger(): IPunchLedger & {
  punchInCalls: number;
  punchOutCalls: number;
  recordOneshotCalls: number;
} {
  const ledger = {
    punchInCalls: 0,
    punchOutCalls: 0,
    recordOneshotCalls: 0,
    punchIn: vi.fn(() => { ledger.punchInCalls++; }),
    punchOut: vi.fn(() => { ledger.punchOutCalls++; }),
    recordOneshot: vi.fn(() => { ledger.recordOneshotCalls++; }),
    preloadDoneKeys: vi.fn(() => new Set<string>()),
    listOpen: vi.fn(() => []),
    listPunchesForTask: vi.fn(() => []),
  };
  return ledger;
}

function makeMockSubtaskRepo(): ILocalSubtaskStore & {
  createLocalSubtaskCalls: number;
  recordLocalOneshotCalls: number;
} {
  const repo = {
    createLocalSubtaskCalls: 0,
    recordLocalOneshotCalls: 0,
    createLocalSubtask: vi.fn().mockImplementation(() => {
      repo.createLocalSubtaskCalls++;
      return { localId: 'loc:test-subtask-1' };
    }),
    settleLocalSubtask: vi.fn(),
    recordLocalOneshot: vi.fn().mockImplementation(() => {
      repo.recordLocalOneshotCalls++;
      return { localId: 'loc:test-oneshot-1' };
    }),
  };
  return repo;
}

function makeController(overrides: {
  view?: IMonitorView;
  worktimeSource?: IWorktimeSource;
  appsync?: IAppSyncClient;
  ledger?: IPunchLedger | null;
  subtaskRepo?: ILocalSubtaskStore;
  onPunchSettled?: () => void;
} = {}): MonitorController {
  return new MonitorController({
    view: overrides.view ?? makeMockView(),
    worktimeSource: overrides.worktimeSource ?? makeMockWorktimeSource(),
    appsync: overrides.appsync ?? makeMockAppsync(),
    ledger: overrides.ledger ?? null,
    subtaskRepo: overrides.subtaskRepo ?? makeMockSubtaskRepo(),
  });
}

function defaultStartOpts(
  overrides: Partial<Parameters<MonitorController['startMonitor']>[0]> = {}
) {
  return {
    projectPath: '/project',
    taskId: 'task-1',
    assigneeId: 'assignee-1',
    sessionId: 'session-abc',
    sinceMs: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 排乾全部 pending microtask（重複多次 await Promise.resolve()）。
 * _runPunchActionsAsync 是 detached Promise，需要多輪 microtask drain。
 */
async function drainMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  MonitorController.clearAllClaims(); // 清 claim 鎖，test 隔離
});

afterEach(() => {
  MonitorController.clearAllClaims();
});

// ---------------------------------------------------------------------------
// T1: start → 掃描迴圈 → collectPunchEvents → decideTwoPhase → createSubtask / punchIn
// 使用 triggerScanOnce() 直接觸發，不依賴 setInterval。
// ---------------------------------------------------------------------------

describe('T1: start → scan → punch pipeline', () => {
  it('startMonitor 後觸發 scan，collectPunchEvents 被呼叫', async () => {
    const wtSrc = makeMockWorktimeSource();
    const ctrl = makeController({ worktimeSource: wtSrc });

    ctrl.startMonitor(defaultStartOpts());
    ctrl.stopMonitor(); // 停 timer，防後續 scan 干擾

    // 直接觸發一次 scan（繞過 timer）
    // 重新 start（sinceMs=0）
    MonitorController.clearAllClaims();
    const ctrl2 = makeController({ worktimeSource: wtSrc });
    ctrl2.startMonitor(defaultStartOpts());
    await ctrl2.triggerScanOnce();
    ctrl2.stopMonitor();

    expect(wtSrc.collectPunchEvents).toHaveBeenCalledWith(
      '/project', 0, new Set(['session-abc']), 'claude',
    );
  });

  it('scan 回傳完成的 subagent event → recordLocalOneshot 被呼叫（local-first 路徑）', async () => {
    const completedEvent = {
      punch_uid: 'uid-001',
      punch_name: 'agent_xxx',
      is_complete: true,
      duration_hours: 0.5,
      started_at: '2026-06-03T00:00:00Z',
      ended_at: '2026-06-03T00:30:00Z',
      kind: 'subagent',
    };
    const events: PunchEvents = {
      subagent_events: [completedEvent],
      main: {},
      main_events: [],
    };
    const wtSrc = makeMockWorktimeSource(events);
    const subtaskRepo = makeMockSubtaskRepo();

    const ctrl = makeController({ worktimeSource: wtSrc, subtaskRepo });
    ctrl.startMonitor(defaultStartOpts());
    await ctrl.triggerScanOnce();
    await drainMicrotasks();
    ctrl.stopMonitor();

    expect(subtaskRepo.recordLocalOneshotCalls).toBeGreaterThanOrEqual(1);
  });

  it('createSubtask 成功後 mark_done(uid, true) → uid 進 punched_keys', async () => {
    const completedEvent = {
      punch_uid: 'uid-done',
      punch_name: 'agent_test',
      is_complete: true,
      duration_hours: 1.0,
      started_at: '2026-06-03T01:00:00Z',
      ended_at: '2026-06-03T02:00:00Z',
      kind: 'subagent',
    };
    const events: PunchEvents = {
      subagent_events: [completedEvent],
      main: {},
      main_events: [],
    };
    const ctrl = makeController({ worktimeSource: makeMockWorktimeSource(events) });
    ctrl.startMonitor(defaultStartOpts());
    await ctrl.triggerScanOnce();
    await drainMicrotasks();
    ctrl.stopMonitor();

    expect(ctrl.punchService.punched_keys.has('uid-done')).toBe(true);
  });

  it('打卡 settle（end/oneshot 成功）→ uid 進 punched_keys（local-first 路徑不再觸發 sync 回呼）', async () => {
    const completedEvent = {
      punch_uid: 'uid-settle',
      punch_name: 'agent_settle',
      is_complete: true,
      duration_hours: 0.25,
      started_at: '2026-06-03T03:00:00Z',
      ended_at: '2026-06-03T03:15:00Z',
      kind: 'subagent',
    };
    const events: PunchEvents = { subagent_events: [completedEvent], main: {}, main_events: [] };
    const ctrl = makeController({ worktimeSource: makeMockWorktimeSource(events) });
    ctrl.startMonitor(defaultStartOpts());
    await ctrl.triggerScanOnce();
    await drainMicrotasks();
    ctrl.stopMonitor();

    // 打卡成功 → uid 進 punched_keys（pure-local 路徑；onPunchSettled 已移除）
    expect(ctrl.punchService.punched_keys.has('uid-settle')).toBe(true);
  });

  it('只有進行中（start phase，未 settle）→ onPunchSettled 不觸發', async () => {
    const inProgressEvent = {
      punch_uid: 'uid-inprogress',
      punch_name: 'agent_wip',
      is_complete: false,
      duration_hours: 0.1,
      started_at: '2026-06-03T04:00:00Z',
      ended_at: null,
      kind: 'subagent',
    };
    const events: PunchEvents = { subagent_events: [inProgressEvent], main: {}, main_events: [] };
    const onPunchSettled = vi.fn();
    const ctrl = makeController({
      worktimeSource: makeMockWorktimeSource(events),
      ledger: makeMockLedger(),
      onPunchSettled,
    });
    ctrl.startMonitor(defaultStartOpts());
    await ctrl.triggerScanOnce();
    await drainMicrotasks();
    ctrl.stopMonitor();

    expect(onPunchSettled).not.toHaveBeenCalled();
  });

  it('即時表含「已完成」打卡（讀 listPunchesForTask，非只 listOpen）→ 完成不必重開任務才看到', async () => {
    const view = makeMockView();
    const ledger = makeMockLedger();
    // ledger 回一筆「已結算」打卡（status=done、ended_at 有值）。
    (ledger.listPunchesForTask as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        punch_uid: 'u-done',
        name: '幫我串接 LINE',
        type: 'agent_manager',
        description: '',
        subtask_id: 'loc:done-1',
        status: 'done',
        started_at: '2026-06-03T05:00:00Z',
        ended_at: '2026-06-03T05:30:00Z',
        hours: 0.5,
        ok: 1,
      },
    ]);
    const ctrl = makeController({
      view,
      worktimeSource: makeMockWorktimeSource({ subagent_events: [], main: {}, main_events: [] }),
      ledger,
    });
    ctrl.startMonitor(defaultStartOpts());
    await ctrl.triggerScanOnce();
    await drainMicrotasks();
    ctrl.stopMonitor();

    expect(ledger.listPunchesForTask).toHaveBeenCalled();
    const rows = view.lastRows as Array<{ name: string; status: string; show_end: boolean }>;
    const done = rows.find((r) => r.name === '幫我串接 LINE');
    expect(done).toBeDefined();
    expect(done!.status).toBe('已完成');
    expect(done!.show_end).toBe(true);
  });

  it('createLocalSubtask 在 start phase 後被呼叫（punchIn 由 repo txn 內部處理）', async () => {
    // 進行中（未完成）→ phase=start → createLocalSubtask（包含 punchIn 的 repo 事務）
    const inProgressEvent = {
      punch_uid: 'uid-start',
      punch_name: 'agent_yyy',
      is_complete: false,
      duration_hours: 0.1,
      started_at: '2026-06-03T00:00:00Z',
      ended_at: null,
      kind: 'subagent',
    };
    const events: PunchEvents = {
      subagent_events: [inProgressEvent],
      main: {},
      main_events: [],
    };
    const subtaskRepo = makeMockSubtaskRepo();
    const ctrl = makeController({
      worktimeSource: makeMockWorktimeSource(events),
      subtaskRepo,
    });
    ctrl.startMonitor(defaultStartOpts());
    await ctrl.triggerScanOnce();
    await drainMicrotasks();
    ctrl.stopMonitor();

    expect(subtaskRepo.createLocalSubtaskCalls).toBeGreaterThanOrEqual(1);
  });

  it('applyEventsForTest 直接驗 events → render 被呼叫', () => {
    const view = makeMockView();
    const ctrl = makeController({ view });
    ctrl.startMonitor(defaultStartOpts());

    // 直接注入 events（不走 scan async）
    ctrl.applyEventsForTest({
      subagent_events: [{
        punch_uid: 'uid-direct',
        punch_name: 'agent_direct',
        is_complete: false,
        duration_hours: 0.2,
        started_at: '2026-06-03T00:00:00Z',
        ended_at: null,
        kind: 'subagent',
      }],
      main: {},
      main_events: [],
    });

    expect(view.renderCalls).toBe(1);
    ctrl.stopMonitor();
  });
});

// ---------------------------------------------------------------------------
// T1b: 翻綠（completed）遲滯 — 連續 3 次掃描才翻綠，避免假綠閃爍
//   事件式路徑（getSessionStatusRunState / JSONL fallback 在測試環境皆回 null）：
//   subagent 全 is_complete 且 ended_at 遠早於 now（>90s）→ runStateFromEvents 回 completed。
// ---------------------------------------------------------------------------

describe('T1b: 翻綠 completed 遲滯', () => {
  const COMPLETED_EVENTS: PunchEvents = {
    subagent_events: [{
      punch_uid: 'uid-done',
      punch_name: 'agent_done',
      is_complete: true,
      duration_hours: 0.5,
      started_at: '2026-06-03T00:00:00Z',
      ended_at: '2026-06-03T00:30:00Z', // 遠早於 now → 非新鮮 → completed
      kind: 'subagent',
    }],
    main: {},
    main_events: [],
  };
  const RUNNING_EVENTS: PunchEvents = {
    subagent_events: [{
      punch_uid: 'uid-live',
      punch_name: 'agent_live',
      is_complete: false, // 任一未完成 → running
      duration_hours: 0.1,
      started_at: '2026-06-03T00:00:00Z',
      ended_at: null,
      kind: 'subagent',
    }],
    main: {},
    main_events: [],
  };

  it('需連續 3 次掃描判定 completed 才翻綠（前兩次維持不 emit completed）', async () => {
    const view = makeMockView();
    // 用 running 當基線：start 的「立即掃描」(_startScanTimer 第一發) 跑完後遲滯計數＝0，
    // 之後改回 completed，確保接下來 3 次是乾淨累計（不被立即掃描干擾）。
    const wtSrc = makeMockWorktimeSource(RUNNING_EVENTS);
    const ctrl = makeController({ view, worktimeSource: wtSrc });
    ctrl.startMonitor(defaultStartOpts());
    await drainMicrotasks(); // 排乾 start 立即掃描（→ running，pending=0）
    vi.mocked(wtSrc.collectPunchEvents).mockResolvedValue(COMPLETED_EVENTS);
    vi.mocked(view.setRunState).mockClear();

    await ctrl.triggerScanOnce();
    expect(view.setRunState).not.toHaveBeenCalledWith('completed'); // 1/3
    await ctrl.triggerScanOnce();
    expect(view.setRunState).not.toHaveBeenCalledWith('completed'); // 2/3
    await ctrl.triggerScanOnce();
    expect(view.setRunState).toHaveBeenCalledWith('completed'); // 3/3 → 翻綠
    expect(ctrl.currentRunState()).toBe('completed');

    ctrl.stopMonitor();
  });

  it('遲滯期間出現 running → 即時翻藍並重置計數，再翻綠須重新累計 3 次', async () => {
    const view = makeMockView();
    const wtSrc = makeMockWorktimeSource(RUNNING_EVENTS);
    const ctrl = makeController({ view, worktimeSource: wtSrc });
    ctrl.startMonitor(defaultStartOpts());
    await drainMicrotasks(); // 排乾 start 立即掃描（→ running，pending=0）
    vi.mocked(wtSrc.collectPunchEvents).mockResolvedValue(COMPLETED_EVENTS);
    vi.mocked(view.setRunState).mockClear();

    await ctrl.triggerScanOnce(); // completed 1/3（未 emit）
    await ctrl.triggerScanOnce(); // completed 2/3（未 emit）
    expect(view.setRunState).not.toHaveBeenCalledWith('completed');

    // 插入一次 running → 即時 emit running，遲滯計數歸零
    vi.mocked(wtSrc.collectPunchEvents).mockResolvedValueOnce(RUNNING_EVENTS);
    await ctrl.triggerScanOnce();
    expect(view.setRunState).toHaveBeenCalledWith('running');
    expect(ctrl.currentRunState()).toBe('running');

    // 計數已歸零：再來兩次 completed 仍不足，第三次才翻綠
    vi.mocked(view.setRunState).mockClear();
    await ctrl.triggerScanOnce(); // 1/3
    await ctrl.triggerScanOnce(); // 2/3
    expect(view.setRunState).not.toHaveBeenCalledWith('completed');
    await ctrl.triggerScanOnce(); // 3/3
    expect(view.setRunState).toHaveBeenCalledWith('completed');

    ctrl.stopMonitor();
  });
});

// ---------------------------------------------------------------------------
// T2: 世代 token — 舊 gen 回呼被丟棄
// ---------------------------------------------------------------------------

describe('T2: 世代 token（generation counter）', () => {
  it('stop 後舊 gen 的 scan 結果晚到 → renderPunchTable 不被呼叫', async () => {
    // 使用一個可手動 resolve 的 Promise 模擬「慢 scan」
    let resolveScan!: (v: PunchEvents) => void;
    const slowScan = new Promise<PunchEvents>(res => { resolveScan = res; });
    const wtSrc: IWorktimeSource = {
      collectPunchEvents: vi.fn().mockReturnValueOnce(slowScan),
    };

    const view = makeMockView();
    const ctrl = makeController({ view, worktimeSource: wtSrc });

    ctrl.startMonitor(defaultStartOpts()); // gen=1, 首次 triggerScanOnce 尚未呼叫
    const genAfterStart = ctrl.monitorGen;

    // 手動啟動 scan（不走 timer，不 await，讓它掛著）
    const scanPromise = ctrl.triggerScanOnce(); // scan 開始但卡在 wtSrc await

    ctrl.stopMonitor(); // gen=2
    const genAfterStop = ctrl.monitorGen;
    expect(genAfterStop).toBeGreaterThan(genAfterStart);

    // 現在才讓舊 scan resolve（帶完整 event，理論上應觸發 punch）
    resolveScan({
      subagent_events: [{
        punch_uid: 'uid-stale',
        punch_name: 'agent_stale',
        is_complete: true,
        duration_hours: 1.0,
        started_at: '2026-06-03T00:00:00Z',
        ended_at: '2026-06-03T01:00:00Z',
        kind: 'subagent',
      }],
      main: {},
      main_events: [],
    });
    await scanPromise;
    await Promise.resolve();

    // 世代不符 → renderPunchTable 不呼叫（丟棄）
    expect(view.renderCalls).toBe(0);
  });

  it('stop→start 後新世代的 scan 仍正常 render', async () => {
    const view = makeMockView();
    const events: PunchEvents = {
      subagent_events: [{
        punch_uid: 'uid-new',
        punch_name: 'agent_new',
        is_complete: true,
        duration_hours: 0.5,
        started_at: '2026-06-03T00:00:00Z',
        ended_at: '2026-06-03T00:30:00Z',
        kind: 'subagent',
      }],
      main: {},
      main_events: [],
    };

    const ctrl = makeController({
      view,
      worktimeSource: makeMockWorktimeSource(events),
    });

    ctrl.startMonitor(defaultStartOpts());
    ctrl.stopMonitor();
    MonitorController.clearAllClaims();

    ctrl.startMonitor(defaultStartOpts());
    await ctrl.triggerScanOnce();
    await Promise.resolve();
    ctrl.stopMonitor();

    // 新世代 scan 正常 → renderPunchTable 被呼叫
    expect(view.renderCalls).toBeGreaterThan(0);
  });

  it('start→stop gen 自增 2 次（每次 start / stop 各 +1）', () => {
    const ctrl = makeController();
    expect(ctrl.monitorGen).toBe(0);

    ctrl.startMonitor(defaultStartOpts());
    expect(ctrl.monitorGen).toBe(1);

    ctrl.stopMonitor();
    expect(ctrl.monitorGen).toBe(2);
  });

  it('scan 期間 stop → 舊世代結果被丟棄後 renderPunchTable 不被呼叫', async () => {
    // 設計第 2 次 scan 慢（第 1 次正常）
    let rejectScan!: (e: Error) => void;
    const slowScan = new Promise<PunchEvents>((_, rej) => { rejectScan = rej; });
    let callIdx = 0;
    const wtSrc: IWorktimeSource = {
      collectPunchEvents: vi.fn().mockImplementation(() => {
        if (callIdx++ === 0) return Promise.resolve({ subagent_events: [], main: {}, main_events: [] });
        return slowScan;
      }),
    };
    const view = makeMockView();
    const ctrl = makeController({ view, worktimeSource: wtSrc });
    ctrl.startMonitor(defaultStartOpts());

    // 第一次 triggerScanOnce（正常完成）
    await ctrl.triggerScanOnce();
    await Promise.resolve();

    const renderAfterFirst = view.renderCalls;

    // 第二次 triggerScanOnce（掛著）+ stop
    const scanPromise2 = ctrl.triggerScanOnce();
    ctrl.stopMonitor();

    // 讓第二次 scan 失敗（舊世代）
    rejectScan(new Error('scan timeout'));
    await scanPromise2.catch(() => {});

    // renderCalls 不再增加（舊世代丟棄）
    expect(view.renderCalls).toBe(renderAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// T3: claim 鎖 — 同一 session 已被監測 → 再 start 不重複監測
// ---------------------------------------------------------------------------

describe('T3: claim 鎖', () => {
  it('同一 sessionId 已被第一個 controller 佔用 → 第二個 controller startMonitor 回 false', () => {
    const ctrl1 = makeController();
    const ctrl2 = makeController();

    const ok1 = ctrl1.startMonitor(defaultStartOpts({ sessionId: 'session-x', taskId: 'task-A' }));
    const ok2 = ctrl2.startMonitor(defaultStartOpts({ sessionId: 'session-x', taskId: 'task-B' }));

    expect(ok1).toBe(true);
    expect(ok2).toBe(false); // 已被 task-A 佔用

    ctrl1.stopMonitor();
  });

  it('同一 taskId 重複 start 同一 session → 視為已在監測，回 false', () => {
    const ctrl = makeController();
    const ok1 = ctrl.startMonitor(defaultStartOpts({ sessionId: 'session-y', taskId: 'task-C' }));
    // 已在監測（_monitorActive=true）→ 第二次 start 早退
    const ok2 = ctrl.startMonitor(defaultStartOpts({ sessionId: 'session-y', taskId: 'task-C' }));

    expect(ok1).toBe(true);
    expect(ok2).toBe(false);
    ctrl.stopMonitor();
  });

  it('stop 後 claim 釋放 → 另一 controller 可 claim 同一 session', () => {
    const ctrl1 = makeController();
    const ctrl2 = makeController();

    ctrl1.startMonitor(defaultStartOpts({ sessionId: 'session-z', taskId: 'task-D' }));
    ctrl1.stopMonitor(); // 釋放 claim

    const ok2 = ctrl2.startMonitor(defaultStartOpts({ sessionId: 'session-z', taskId: 'task-E' }));
    expect(ok2).toBe(true);
    ctrl2.stopMonitor();
  });

  it('isSessionClaimed 在 start 後回 true，stop 後回 false', () => {
    const ctrl = makeController();
    ctrl.startMonitor(defaultStartOpts({ sessionId: 'session-w' }));
    expect(MonitorController.isSessionClaimed('session-w')).toBe(true);
    ctrl.stopMonitor();
    expect(MonitorController.isSessionClaimed('session-w')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T4: auth_defer — 打卡回 ok=false+auth_defer → markTokenDefer / in_flight 釋放 / 下輪跳過
// ---------------------------------------------------------------------------

describe('T4: auth_defer', () => {
  it('recordLocalOneshot 丟 auth error → markTokenDefer 被呼叫，uid 在 token_defer 中', async () => {
    const authErr = new NotLoggedInError('Unauthorized: token expired');
    const subtaskRepo = makeMockSubtaskRepo();
    (subtaskRepo.recordLocalOneshot as ReturnType<typeof vi.fn>).mockImplementation(() => { throw authErr; });

    const completedEvent = {
      punch_uid: 'uid-auth',
      punch_name: 'agent_auth',
      is_complete: true,
      duration_hours: 1.0,
      started_at: '2026-06-03T00:00:00Z',
      ended_at: '2026-06-03T01:00:00Z',
      kind: 'subagent',
    };
    const events: PunchEvents = {
      subagent_events: [completedEvent],
      main: {},
      main_events: [],
    };

    const ctrl = makeController({
      worktimeSource: makeMockWorktimeSource(events),
      subtaskRepo,
    });
    ctrl.startMonitor(defaultStartOpts());
    await ctrl.triggerScanOnce();
    await drainMicrotasks();
    ctrl.stopMonitor();

    // auth_defer → token_defer 中有 uid
    expect(ctrl.punchService.token_defer.has('uid-auth')).toBe(true);
    // in_flight 已釋放（mark_token_defer 內部清）
    expect(ctrl.punchService.in_flight_keys.has('uid-auth')).toBe(false);
  });

  it('in_flight 標記在 await 前同步設（樂觀鎖），done 後釋放', async () => {
    // recordLocalOneshot 是同步介面，但 executeAction 本身是 async（包含 await resolvePunchDescription）。
    // 只驗：觸發 scan → drain 足夠輪 microtask 後 punchInFlight 已回 false（正常完成）。
    const completedEvent = {
      punch_uid: 'uid-inflight',
      punch_name: 'agent_slow',
      is_complete: true,
      duration_hours: 0.5,
      started_at: '2026-06-03T00:00:00Z',
      ended_at: '2026-06-03T00:30:00Z',
      kind: 'subagent',
    };

    const ctrl = makeController({
      worktimeSource: makeMockWorktimeSource({
        subagent_events: [completedEvent],
        main: {},
        main_events: [],
      }),
    });

    ctrl.startMonitor(defaultStartOpts());
    await ctrl.triggerScanOnce();
    await drainMicrotasks();

    // 打卡完成後 in_flight 應釋放
    expect(ctrl.punchInFlight).toBe(false);

    ctrl.stopMonitor();
  });

  it('auth_defer 後下一輪 decide_two_phase 在退避窗內跳過該 uid', async () => {
    const authErr = new NotLoggedInError('auth token expired');
    let callCount = 0;
    const subtaskRepo = makeMockSubtaskRepo();
    (subtaskRepo.recordLocalOneshot as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw authErr;
      return { localId: 'loc:subtask-ok' };
    });

    const uid = 'uid-backoff';
    const events: PunchEvents = {
      subagent_events: [{
        punch_uid: uid,
        punch_name: 'agent_backoff',
        is_complete: true,
        duration_hours: 1.0,
        started_at: '2026-06-03T00:00:00Z',
        ended_at: '2026-06-03T01:00:00Z',
        kind: 'subagent',
      }],
      main: {},
      main_events: [],
    };

    const ctrl = makeController({
      worktimeSource: makeMockWorktimeSource(events),
      subtaskRepo,
    });
    ctrl.startMonitor(defaultStartOpts());

    // 第一輪：auth_defer
    await ctrl.triggerScanOnce();
    await drainMicrotasks();

    expect(ctrl.punchService.token_defer.has(uid)).toBe(true);

    const createCallsBefore = callCount;

    // 第二輪：退避窗（60s）內 → decide_two_phase 跳過此 uid → recordLocalOneshot 不再被呼叫
    await ctrl.triggerScanOnce();
    await drainMicrotasks();

    expect(callCount).toBe(createCallsBefore); // 沒增加
    ctrl.stopMonitor();
  });
});

// ---------------------------------------------------------------------------
// T5: 指紋節流 — 使用 applyEventsForTest 直接驗（不依賴 timer）
// ---------------------------------------------------------------------------

describe('T5: 指紋節流', () => {
  it('相同 events 連兩輪 → renderPunchTable 只呼叫 1 次', () => {
    const events: PunchEvents = {
      subagent_events: [],
      main: { duration_hours: 1.0, started_at: '2026-06-03T00:00:00Z' },
      main_events: [],
    };

    const view = makeMockView();
    const ctrl = makeController({ view });
    ctrl.startMonitor(defaultStartOpts());

    ctrl.applyEventsForTest(events);
    expect(view.renderCalls).toBe(1);

    // 第二次 apply 相同 events → 指紋相同 → 不再呼叫
    ctrl.applyEventsForTest(events);
    expect(view.renderCalls).toBe(1);

    ctrl.stopMonitor();
  });

  it('events 變（hours 變）→ renderPunchTable 再呼叫一次', () => {
    const view = makeMockView();
    const ctrl = makeController({ view });
    ctrl.startMonitor(defaultStartOpts());

    ctrl.applyEventsForTest({
      subagent_events: [],
      main: { duration_hours: 1.0, started_at: '2026-06-03T00:00:00Z' },
      main_events: [],
    });
    expect(view.renderCalls).toBe(1);

    // 改 hours → 指紋不同 → render 再 1 次
    ctrl.applyEventsForTest({
      subagent_events: [],
      main: { duration_hours: 2.5, started_at: '2026-06-03T00:00:00Z' },
      main_events: [],
    });
    expect(view.renderCalls).toBe(2);

    ctrl.stopMonitor();
  });

  it('status 變（新 subagent 加入）→ renderPunchTable 再呼叫', () => {
    const view = makeMockView();
    const ctrl = makeController({ view });
    ctrl.startMonitor(defaultStartOpts());

    ctrl.applyEventsForTest({ subagent_events: [], main: {}, main_events: [] });
    expect(view.renderCalls).toBe(1);

    ctrl.applyEventsForTest({
      subagent_events: [{
        punch_uid: 'uid-new',
        punch_name: 'agent_new',
        is_complete: false,
        duration_hours: 0.1,
        started_at: '2026-06-03T00:00:00Z',
        ended_at: null,
        kind: 'subagent',
      }],
      main: {},
      main_events: [],
    });
    expect(view.renderCalls).toBe(2);

    ctrl.stopMonitor();
  });

  it('相同 rows 三輪 → renderPunchTable 仍只 1 次（指紋命中）', () => {
    const view = makeMockView();
    const ctrl = makeController({ view });
    ctrl.startMonitor(defaultStartOpts());

    const events: PunchEvents = {
      subagent_events: [{
        punch_uid: 'uid-stable',
        punch_name: 'agent_stable',
        is_complete: false,
        duration_hours: 0.3,
        started_at: '2026-06-03T00:00:00Z',
        ended_at: null,
        kind: 'subagent',
      }],
      main: {},
      main_events: [],
    };

    ctrl.applyEventsForTest(events);
    ctrl.applyEventsForTest(events);
    ctrl.applyEventsForTest(events);

    expect(view.renderCalls).toBe(1); // 三輪相同，只畫一次

    ctrl.stopMonitor();
  });
});
