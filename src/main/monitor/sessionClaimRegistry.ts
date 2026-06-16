/**
 * sessionClaimRegistry.ts — claim 鎖單例與操作（自 MonitorController.ts 抽出）
 *
 * claim 鎖狀態（單例，controller 層跨 instance 共用）
 * 對應 Python App.claim_session / release_session：
 *   _claimedSessions: 已被任一任務佔用的 session id 集合
 *   _claimedByTask:   sid → taskId（哪個任務佔用）
 *
 * ⚠️ module-level 單例：整個 app 與測試只 import 同一份模組（同一路徑），
 *   ESM/CJS 模組快取保證單例，維持跨 instance claim 語意。
 */

const _claimedSessions = new Set<string>();
const _claimedByTask = new Map<string, unknown>();

/** 嘗試 claim session；成功 → true，已被別任務佔用 → false。 */
export function claimSession(sid: string, taskId: unknown): boolean {
  if (_claimedSessions.has(sid) && _claimedByTask.get(sid) !== taskId) {
    return false; // 已被別任務佔用
  }
  _claimedSessions.add(sid);
  _claimedByTask.set(sid, taskId);
  return true;
}

/** 釋放 session 鎖（同一 taskId 才釋放；防止誤釋別人的鎖）。 */
export function releaseSession(sid: string, taskId: unknown): void {
  if (_claimedByTask.get(sid) === taskId) {
    _claimedSessions.delete(sid);
    _claimedByTask.delete(sid);
  }
}

/** 查詢某 session 是否被佔用（測試可用）。 */
export function isSessionClaimed(sid: string): boolean {
  return _claimedSessions.has(sid);
}

/** 清除全部 claim 鎖（測試隔離用）。 */
export function clearAllClaims(): void {
  _claimedSessions.clear();
  _claimedByTask.clear();
}
