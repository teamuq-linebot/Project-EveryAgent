/**
 * SessionRunStateMachine.ts — 事件式 run-state 純運算（自 MonitorController.ts 抽出）
 */

import type { SessionRunState } from './sessionLiveness';
import type { PunchEvents } from './types';
import { toEpochMs } from './monitorHelpers';

/**
 * run-state 判定：距最後活動 ≤90s 視為 running。
 * 90s（而非舊 30s）：agent 工作流常有 >30s 不出事件的空檔，30s 太短會誤判成「完成」翻綠
 * 再翻回 running，造成綠↔藍振盪。對齊 sessionLiveness.JSONL_FRESH_MS。
 */
export const RUN_FRESH_SECONDS = 90;

/** 事件式 run-state（原 _updateRunStateFromEvents 邏輯）。對應 Python update_run_state_from_events。 */
export function runStateFromEvents(events: PunchEvents): SessionRunState {
  const subagentEvents = events.subagent_events || [];
  const main = events.main || {};
  // 任一 subagent 未完成 → running
  for (const ev of subagentEvents) {
    if (!Boolean(ev['is_complete'])) {
      return 'running';
    }
  }
  // 所有完成 → 看時間是否新鮮
  const nowMs = Date.now();
  const freshMs = RUN_FRESH_SECONDS * 1000;
  let latest: number | null = null;
  for (const ev of subagentEvents) {
    for (const key of ['ended_at', 'started_at'] as const) {
      const ts = toEpochMs(ev[key]);
      if (ts !== null && (latest === null || ts > latest)) latest = ts;
    }
  }
  for (const key of ['ended_at', 'started_at'] as const) {
    const ts = toEpochMs(main[key]);
    if (ts !== null && (latest === null || ts > latest)) latest = ts;
  }
  if (latest !== null && nowMs - latest <= freshMs) {
    return 'running';
  }
  // 有過事件但已靜止 → 對話已完成（UI 綠色點）；完全無事件（latest===null）→ idle 中性。
  return latest !== null ? 'completed' : 'idle';
}

/**
 * codex 專用 run-state：codex 有**明確結束訊號**（task_complete），不用 claude 的 90s 新鮮度啟發法。
 *   - 任一回合未完成（task_started 無對應 task_complete → main-ai ended_at=null）→ running。
 *   - 全部回合完成（剛結束）→ completed；本輪事件已被水位濾掉（無事件）→ idle。
 * 直接讀 main_events.is_complete，故 AI 一回完就即時翻離 running（不會卡在「思考中」90s）。
 */
export function runStateFromCodexEvents(events: PunchEvents): SessionRunState {
  const mainEvents = events.main_events || [];
  for (const ev of mainEvents) {
    if (!Boolean(ev['is_complete'])) return 'running';
  }
  return mainEvents.length > 0 ? 'completed' : 'idle';
}
