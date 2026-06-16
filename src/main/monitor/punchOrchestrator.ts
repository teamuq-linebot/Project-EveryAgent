/**
 * punchOrchestrator.ts — 打卡兩階段執行流程（自 MonitorController.ts 抽出）
 *
 * 對應 Python presenter_punch.py：
 *   _punch_two_phase / _run_punch_actions / _on_punch_done_impl
 *
 * 設計約束：
 *   - 所有函式接收「同一份」shared state 的 mutable context 物件（非 copy）；
 *     呼叫端（MonitorController）保持對 ctx 各欄位的寫入責任。
 *   - in-flight 標記（ctx.punchInFlight）必須在 await 前同步設（對齊 Python
 *     v._punch_in_flight = True 在 QThread.start() 前同步設旗的語意）。
 *   - 世代 token 比對（ctx.monitorGen）在 await 後、_onPunchDone 前進行；
 *     與 MonitorController._runPunchActionsAsync 語意完全等價。
 *   - _onPunchDone 末尾重畫表格由 renderAfterPunch 回呼執行（調用端傳入，
 *     等價於原 this._renderPunchTableNow(this._canPunch())）。
 */

import type { PunchService, PunchAction } from '../services/punchService';
import type { PunchBuilderMixin } from '../services/punchBuilder';
import type { PunchEvents } from './types';
import type { PunchExecutor, ExecuteResult } from './punchExecutor';
import { monotonicSec } from './monitorHelpers';

// ---------------------------------------------------------------------------
// 共用 context 型別（MonitorController 按欄位傳入，函式讀寫同一份）
// ---------------------------------------------------------------------------

export interface PunchOrchestratorCtx {
  /** 目前 in-flight 樂觀鎖（對應 this._punchInFlight）。函式會同步讀寫。 */
  punchInFlight: boolean;
  /** 世代 token（對應 this._monitorGen）；async 回呼回來比對，不符即丟棄。 */
  readonly monitorGen: number;
  /** 打卡決策服務（對應 this._punchService）。 */
  readonly punchService: PunchService;
  /** 打卡執行層（對應 this._punchExecutor）。 */
  readonly punchExecutor: PunchExecutor;
  /** 對應 this._taskId。 */
  readonly taskId: unknown;
  /** 對應 this._assigneeId。 */
  readonly assigneeId: unknown;
  /** 對應 this._sessionId。 */
  readonly sessionId: string;
  /** 打卡 settle（end / oneshot 成功）後回呼；null → 不觸發。 */
  readonly onPunchSettled: (() => void) | null;
  /** 打卡 builder（對應 this._makeBuilder()）。 */
  readonly builder: PunchBuilderMixin;
  /**
   * 打卡結算後重畫表格（對應原 this._renderPunchTableNow(this._canPunch())）。
   * 由 MonitorController 傳入閉包，內部已包含 canPunch 判斷。
   */
  readonly renderAfterPunch: () => void;
}

// ---------------------------------------------------------------------------
// punchTwoPhase — 對應 Python _punch_two_phase
// ---------------------------------------------------------------------------

/**
 * 兩段式打卡編排。
 * 對應 Python PresenterPunchMixin._punch_two_phase()。
 * in_flight 樂觀鎖（ctx.punchInFlight）：不重入。
 * in_flight_keys 在 decide_two_phase 內部同步加（await 前），保證不 race。
 */
export function punchTwoPhase(events: PunchEvents, ctx: PunchOrchestratorCtx): void {
  if (ctx.punchInFlight) return; // 上一輪打卡還沒回 → 等下輪

  const actions = ctx.punchService.decide_two_phase(
    (events.subagent_events || []) as Record<string, unknown>[],
    (events.main_events || []) as Record<string, unknown>[],
    {
      task_id: ctx.taskId,
      assignee_id: ctx.assigneeId,
      session_id: ctx.sessionId,
      builder: ctx.builder,
      now: monotonicSec(),
    },
  );

  if (actions.length === 0) return;

  runPunchActions(actions, ctx);
}

// ---------------------------------------------------------------------------
// runPunchActions — 對應 Python _run_punch_actions
// ---------------------------------------------------------------------------

/**
 * 背景跑打卡 actions（對應 Python _run_punch_actions，QThread → async）。
 * in-flight 標記在此同步設（await 前），對齊 Python v._punch_in_flight = True
 * 在 QThread.start() 前同步設旗的語意。
 */
export function runPunchActions(actions: PunchAction[], ctx: PunchOrchestratorCtx): void {
  ctx.punchInFlight = true; // 同步標記（await 前）
  void runPunchActionsAsync(actions, ctx);
}

// ---------------------------------------------------------------------------
// runPunchActionsAsync（內部）
// ---------------------------------------------------------------------------

async function runPunchActionsAsync(actions: PunchAction[], ctx: PunchOrchestratorCtx): Promise<void> {
  const gen = ctx.monitorGen;
  const results: Array<{
    punch_uid: string;
    punch_name: string;
    phase: string;
    ok: boolean;
    auth_defer?: boolean;
    subtask_id?: string | null;
    fallback_oneshot?: boolean;
    hours?: number;
    error?: string;
    absorbed_uid?: string | null;
  }> = [];

  for (const action of actions) {
    const result = await executeOnePunchAction(action, ctx);
    results.push(result);
  }

  // 世代 token 比對（對應 Python _on_punch_done 的 view.is_alive() / _closing 守門）
  if (gen !== ctx.monitorGen) return; // 舊世代 → 丟棄

  onPunchDone(results, ctx);
}

// ---------------------------------------------------------------------------
// executeOnePunchAction（內部）
// ---------------------------------------------------------------------------

/**
 * 執行單一打卡動作。
 * 委派給 PunchExecutor.executeAction（_do_start / _do_end / _do_oneshot + retry + qwen + auth 分類）。
 * 對應 Python monitor_workers._PunchWorker._process_actions 的單筆分支邏輯。
 */
async function executeOnePunchAction(action: PunchAction, ctx: PunchOrchestratorCtx): Promise<ExecuteResult> {
  const result = await ctx.punchExecutor.executeAction(action);
  // 欄位名稱對齊：PunchExecutor 回 authDefer，_onPunchDone 期望 auth_defer
  return {
    ...result,
    auth_defer: result.authDefer,
  } as ExecuteResult & { auth_defer?: boolean };
}

// ---------------------------------------------------------------------------
// onPunchDone — 對應 Python _on_punch_done_impl
// ---------------------------------------------------------------------------

/**
 * 打卡回呼（對應 Python _on_punch_done_impl）。
 * ok=false + auth_defer → markTokenDefer（退避 60s）；
 * ok=false → markDone(uid, false)；
 * phase=start + ok → markPunchedIn / markOneshotPending；
 * phase=end/oneshot + ok → markDone(uid, true)。
 */
export function onPunchDone(results: Array<{
  punch_uid: string;
  punch_name?: string;
  phase: string;
  ok: boolean;
  auth_defer?: boolean;
  subtask_id?: string | null;
  fallback_oneshot?: boolean;
  hours?: number;
  error?: string;
  absorbed_uid?: string | null;
}>, ctx: PunchOrchestratorCtx): void {
  ctx.punchInFlight = false;

  // 本輪是否有打卡 settle 成功（end / oneshot + ok）→ 觸發結算後回呼。
  let settledAny = false;

  for (const r of results) {
    const uid = r.punch_uid;
    if (!uid) continue;

    if (!r.ok) {
      if (r.auth_defer) {
        // token 過期 / 未登入 → 退避 60s
        ctx.punchService.mark_token_defer(uid, monotonicSec(), 60.0);
      } else {
        // 一般錯誤 → 釋放 in_flight + 記 error，下輪可重試
        ctx.punchService.mark_done(uid, false);
      }
      // F-Z1：補償配對 settle 失敗 → 回滾 decide 階段對 old_uid 的狀態變更（還原 anchor + consumed + 清新 uid in_flight）
      if (r.absorbed_uid) {
        ctx.punchService.mark_absorption_failed(r.absorbed_uid);
      }
      continue;
    }

    if (r.phase === 'start') {
      if (r.fallback_oneshot || !r.subtask_id) {
        ctx.punchService.mark_oneshot_pending(uid);
      } else {
        ctx.punchService.mark_punched_in(uid, r.subtask_id!);
      }
    } else {
      // end / oneshot 成功
      ctx.punchService.mark_done(uid, true);
      settledAny = true;
      // 補償配對：phase=end + absorbed_uid → 同步 mark_done 新 uid，
      // 防止下輪掃描將被吸收的新 uid 再次建立 oneshot/start action。
      if (r.phase === 'end' && r.absorbed_uid) {
        ctx.punchService.mark_done(r.absorbed_uid, true);
      }
    }
  }

  // 打卡 settle 成功 → 通知 backend 執行結算後處理。
  if (settledAny && ctx.onPunchSettled) {
    try {
      ctx.onPunchSettled();
    } catch {
      /* 回呼自負錯誤隔離；不影響打卡主流程 */
    }
  }

  // 重畫表格
  ctx.renderAfterPunch();
}
