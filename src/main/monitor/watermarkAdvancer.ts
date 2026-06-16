/**
 * watermarkAdvancer.ts — 掃描水位推進與解析（自 MonitorController.ts 抽出）
 *
 * 對應 Python presenter_scan.py 中 _advance_watermark / _resolve_since_ms 相關邏輯。
 *
 * 設計約束：
 *   - 兩個函式均為純函式化包裝：讀寫 watermarkStore 與 monitoredSessionIds，
 *     但不自建任何 DB 連線，全部透過注入介面（IScanWatermarkStore）進行。
 *   - advanceWatermark 寫失敗絕不可擋監測（store 內部已容錯）。
 *   - resolveSinceMs 多 session 取**最小**水位（不漏任一段仍未完成的工作）。
 */

import type { IScanWatermarkStore } from '../worktime/scanWatermarkStore';
import { computeWatermarkMs } from '../worktime/scanWatermarkStore';
import type { PunchEvents } from './types';
import { toEpochMs } from './monitorHelpers';

// ---------------------------------------------------------------------------
// advanceWatermark — 對應 MonitorController._advanceWatermark
// ---------------------------------------------------------------------------

/**
 * 每輪掃描後推進水位（plan §2.14a）。對被監測的每個 session 寫回水位（只進不退）。
 * 水位由本輪事件算（computeWatermarkMs：有未完成事件 → 釘在最早未完成 start；
 *   全完成 → 推到最晚 start）。水位寫失敗絕不可擋監測（store 內部已容錯）。
 *
 * @param events           本輪掃描事件
 * @param store            水位持久化 store（null → 直接 return，維持既有行為）
 * @param monitoredSessionIds 被監測的 session id 集合
 * @param monitorStartMs   目前記憶體基準（epoch ms）；推進後回傳新值（呼叫端應更新）
 * @returns                推進後的新 monitorStartMs（無變化時回傳原值）
 */
export function advanceWatermark(
  events: PunchEvents,
  store: IScanWatermarkStore | null,
  monitoredSessionIds: Set<string>,
  monitorStartMs: number,
): number {
  if (!store) return monitorStartMs;
  const evs = [
    ...((events.main_events || []) as { started_at?: unknown; is_complete?: unknown }[]),
    ...((events.subagent_events || []) as { started_at?: unknown; is_complete?: unknown }[]),
  ];
  const next = computeWatermarkMs(evs, toEpochMs, monitorStartMs);
  if (next === null) return monitorStartMs;
  // 推進記憶體基準（下輪 scan 直接用新水位過濾）+ 持久化到每個被監測 session。
  const newStart = next > monitorStartMs ? next : monitorStartMs;
  for (const sid of monitoredSessionIds) {
    store.advance(sid, next, sid);
  }
  return newStart;
}

// ---------------------------------------------------------------------------
// resolveSinceMs — 對應 MonitorController._resolveSinceMs
// ---------------------------------------------------------------------------

/**
 * 解析掃描基準 sinceMs（plan §2.14a / D29）。
 * 注入水位 store：取被監測 session 的持久化水位，多 session 取**最小**（不漏任一段
 *   仍未完成的工作）；全無水位 → 退回傳入 sinceMs（task 綁定時間），**不再 Date.now()**。
 * 未注入：維持既有行為 `sinceMs ?? Date.now()`（向後相容）。
 *
 * @param watermarkStore       水位持久化 store（null → 維持既有行為）
 * @param monitoredSessionIds  被監測的 session id 集合
 * @param sinceMs              task 綁定時間（epoch ms）；水位無時的 fallback
 * @returns                    解析後的 sinceMs
 */
export function resolveSinceMs(
  watermarkStore: IScanWatermarkStore | null,
  monitoredSessionIds: Set<string>,
  sinceMs?: number,
): number {
  if (!watermarkStore) {
    return sinceMs ?? Date.now();
  }
  let minWatermark: number | null = null;
  for (const sid of monitoredSessionIds) {
    const wm = watermarkStore.getSinceMs(sid);
    if (wm === null) continue;
    if (minWatermark === null || wm < minWatermark) minWatermark = wm;
  }
  if (minWatermark !== null) return minWatermark;
  // 無水位：task 綁定時間起算（傳入 sinceMs）；仍無 → 0（從頭掃，不 Date.now()）。
  return sinceMs ?? 0;
}
