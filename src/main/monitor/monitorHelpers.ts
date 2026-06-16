/**
 * monitorHelpers.ts — 小型純函式 helper（自 MonitorController.ts 抽出）
 */

import type { SessionRunState } from './sessionLiveness';

export function toEpochMs(value: unknown): number | null {
  if (!value) return null;
  try {
    const s = String(value).trim();
    const ms = Date.parse(s);
    return isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

/** 目前 monotonic 時間（秒）。用 performance.now() / 1000 模擬 Python time.monotonic() */
export function monotonicSec(): number {
  return performance.now() / 1000;
}

/**
 * 合併多 session 的 run-state，取「最積極」者：running > waiting > idle > none。
 * 用於一個任務監測多個 session（主 + subagent）時，避免某 session 的 idle 殘檔
 * 蓋掉另一個真在跑 / 真在等待的 session。
 */
const _RUN_STATE_RANK: Record<SessionRunState, number> = {
  none: 0,
  idle: 1,
  completed: 2,
  waiting: 3,
  running: 4,
};
export function mergeRunState(a: SessionRunState | null, b: SessionRunState): SessionRunState {
  if (a === null) return b;
  return _RUN_STATE_RANK[b] > _RUN_STATE_RANK[a] ? b : a;
}
