/**
 * scanWatermarkStore.ts — 掃描水位持久化（plan_v1 §2.14a / D29，Phase 6 批次 scan-watermark 1/3）。
 *
 * 目的：解 crash-recovery 缺口（§2.14 情境 A 尾段 + B）。
 *   - 既有行為：MonitorController 的 `sinceMs = Date.now()`（renderer 未傳 sinceMs），
 *     會把「重啟前已結束的事件」「整段離線完成的工作」全部濾掉（punchCore.ts:363-367
 *     `started_at >= sinceMs`）→ 補不了下工卡 / oneshot 卡。
 *   - 本批改法：每輪掃描後把「該 session 已消化到的事件時間水位」持久化；start 時
 *     `sinceMs` 改取**該 session 的水位**（不再 Date.now()），重啟/離線後從水位續掃。
 *
 * 表：scan_watermarks（schema 已由 repo.ensureSchema 建立，§2.14a；本檔不重建）：
 *   session_id   TEXT PRIMARY KEY
 *   jsonl_file   TEXT                       -- 目前監測的 claude session id（追溯用）
 *   consumed_pos INTEGER NOT NULL DEFAULT 0 -- 已消化的事件時間水位（epoch ms；仿 conv_state.consumedPos 範式）
 *   updated_at   TEXT NOT NULL
 *
 * 語意說明：plan 的 `consumed_pos` 註解為「已讀位移（仿 conv_state.consumedPos 範式）」。
 *   worktime 掃描層以 `started_at >= sinceMs`（epoch ms 時間戳）過濾，而非 byte offset，
 *   故本批以 epoch-ms 時間水位存入 consumed_pos（INTEGER 容得下），掃描層一行不改即可續掃。
 *
 * 容錯：所有方法全程 try/catch；讀失敗回 null（呼叫端退回既有行為），寫失敗靜默
 *   （水位是最佳化補卡，絕不可擋監測）。水位**只進不退**（advance 取 max，避免回頭漏掃）。
 */

import type Database from 'better-sqlite3'
import { openTeamuqDb } from '../repo/sqliteTaskRepository'

// ---------------------------------------------------------------------------
// 注入介面（MonitorController 依賴契約；可選注入，未注入則維持既有 sinceMs 行為）
// ---------------------------------------------------------------------------

export interface IScanWatermarkStore {
  /**
   * 取該 session 的已持久化水位（epoch ms）；無紀錄 / 失敗 → null。
   * 呼叫端：null 時退回既有 sinceMs（task 綁定時間 / 0），不再 Date.now()。
   */
  getSinceMs(sessionId: string): number | null

  /**
   * 推進該 session 的水位到 `sinceMs`（epoch ms）。
   * 只進不退（DB 內既有值較大時不覆寫）；jsonlFile 記目前監測的真 claude session id（追溯用）。
   */
  advance(sessionId: string, sinceMs: number, jsonlFile?: string | null): void
}

// ---------------------------------------------------------------------------
// ISO timestamp helper
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// SqliteScanWatermarkStore — better-sqlite3 實作（共用 teamuq.db）
// ---------------------------------------------------------------------------

export class SqliteScanWatermarkStore implements IScanWatermarkStore {
  private readonly _db: Database.Database
  /** 是否由本 store 自開連線（負責 close）；外部注入連線時不關。 */
  private readonly _ownsDb: boolean

  /**
   * @param db 共用 DB 連線（測試 / 與 repo 共用）；省略 → 自開 teamuq.db（吃 TEAMUQ_HOME）。
   */
  constructor(db?: Database.Database) {
    if (db) {
      this._db = db
      this._ownsDb = false
    } else {
      // openTeamuqDb() 內含 ensureSchema（建 scan_watermarks），不需本檔自建表。
      this._db = openTeamuqDb()
      this._ownsDb = true
    }
  }

  getSinceMs(sessionId: string): number | null {
    if (!sessionId) return null
    try {
      const row = this._db
        .prepare('SELECT consumed_pos FROM scan_watermarks WHERE session_id = ?')
        .get(String(sessionId)) as { consumed_pos: number } | undefined
      if (!row) return null
      const pos = Number(row.consumed_pos)
      return Number.isFinite(pos) ? pos : null
    } catch {
      return null
    }
  }

  advance(sessionId: string, sinceMs: number, jsonlFile?: string | null): void {
    if (!sessionId) return
    if (typeof sinceMs !== 'number' || !Number.isFinite(sinceMs) || sinceMs < 0) return
    try {
      // 只進不退：ON CONFLICT 時取 max(既有, 新值)；jsonl_file 以新值（非空才覆寫）。
      this._db
        .prepare(
          'INSERT INTO scan_watermarks (session_id, jsonl_file, consumed_pos, updated_at) ' +
            'VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(session_id) DO UPDATE SET ' +
            '  consumed_pos = MAX(scan_watermarks.consumed_pos, excluded.consumed_pos), ' +
            '  jsonl_file = COALESCE(excluded.jsonl_file, scan_watermarks.jsonl_file), ' +
            '  updated_at = excluded.updated_at',
        )
        .run(String(sessionId), jsonlFile ?? null, Math.trunc(sinceMs), nowIso())
    } catch {
      // 水位寫失敗絕不可擋監測：靜默。
    }
  }

  /** 關閉自開連線（測試 / 清理用）；注入連線不關。 */
  close(): void {
    if (!this._ownsDb) return
    try {
      this._db.close()
    } catch {
      // 靜默
    }
  }
}

// ---------------------------------------------------------------------------
// 純函式：從一輪掃描事件算「可推進到的水位」（epoch ms）
// ---------------------------------------------------------------------------

/**
 * 從事件陣列算下一個水位（plan §2.14a：續掃不漏、不重複）。
 *
 * 規則（安全優先，不漏掉仍在進行的工作段）：
 *   - 有「未完成（is_complete=false）」事件 → 水位 = 這些未完成事件中**最早**的 started_at。
 *     （filter 是 `started_at >= sinceMs` 含等號 → 該未完成事件下輪仍被掃到，等它完成才前進。）
 *   - 全部完成 → 水位 = 所有事件中**最晚**的 started_at。
 *     （已完成事件即便再被掃到，done_keys/preloadDoneKeys 既有去重防重複補卡。）
 *   - 無任何可解析 started_at → 回 null（呼叫端不推進）。
 *
 * @param prev 目前水位（epoch ms）；回傳值與 prev 取 max（只進不退）。null = 無前值。
 */
export function computeWatermarkMs(
  events: { started_at?: unknown; is_complete?: unknown }[],
  toEpochMs: (v: unknown) => number | null,
  prev: number | null,
): number | null {
  let earliestIncomplete: number | null = null
  let latestAll: number | null = null

  for (const ev of events || []) {
    const ms = toEpochMs(ev.started_at)
    if (ms === null) continue
    if (latestAll === null || ms > latestAll) latestAll = ms
    if (!ev.is_complete) {
      if (earliestIncomplete === null || ms < earliestIncomplete) earliestIncomplete = ms
    }
  }

  const candidate = earliestIncomplete !== null ? earliestIncomplete : latestAll
  if (candidate === null) return prev
  if (prev === null) return candidate
  return Math.max(prev, candidate)
}
