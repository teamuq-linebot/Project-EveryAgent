/**
 * punchSqlHelpers.ts — 打卡帳本 module-level 純函式 helper（自 punchLedger.ts 原樣抽出）
 *
 * 來源：原 punchLedger.ts L124-126 / L132-136 / L142-145。一行不改，僅由 `function`
 *   改為 `export function`。原檔以 import 取回使用，並 re-export 維持原 import path 可達。
 *
 * 依賴方向：本檔僅 import sqliteTaskRepository 的 teamuqDbPath（既有跨檔依賴方向不變，
 *   sqliteTaskRepository 不 import punchLedger/punchSchema/punchSqlHelpers，無新增 import cycle）。
 */

import { teamuqDbPath } from '../repo/sqliteTaskRepository';

// ---------------------------------------------------------------------------
// 預設 DB 路徑（rev10：單一 teamuq.db；復用 repo 的 teamuqDbPath，吃 TEAMUQ_HOME）
// ---------------------------------------------------------------------------

export function defaultDbPath(): string {
  return teamuqDbPath();
}

// ---------------------------------------------------------------------------
// ISO timestamp helper（對應 Python _now_iso）
// ---------------------------------------------------------------------------

export function nowIso(): string {
  const now = new Date();
  const ms = String(now.getUTCMilliseconds()).padStart(3, '0');
  return now.toISOString().replace(/\.\d+Z$/, `.${ms}Z`);
}

// ---------------------------------------------------------------------------
// _s helper（對應 Python _s：None → null，else str）
// ---------------------------------------------------------------------------

export function _s(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}
