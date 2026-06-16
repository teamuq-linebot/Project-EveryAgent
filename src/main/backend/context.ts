/**
 * backend/context.ts — BackendContext：delegate service 的共用依賴/狀態注入介面
 * （backend.ts 拆分計畫 §3；Batch 4 建立骨架；B9 移除雲端/auth/sync 欄位）。
 *
 * 設計決策（行為保留的關鍵，對應計畫 §3 / §5 風險表）：
 *   - service 一律經本介面取得共用依賴與可變狀態，**不自建**（R4：lazy 單例不可重複建）。
 *   - emit 是「方法」不是值：setEmit 會在執行期換 emit，service 不可在 constructor capture
 *     emit 值（會抓到 NO_OP_EMIT，R3）。ctx.emit(ch, p) 內部讀「當前」_emit。
 *   - sessions / activeSessions / ptyWaitingTasks / ptyErrorTasks 為共用可變狀態的
 *     **同一參照**（R5：claim 鎖 / monitor 共讀不可各持 copy）。
 */

import type { SqliteTaskRepository } from "../repo/sqliteTaskRepository";
import type { PunchLedger } from "../db/punchLedger";
import type { ClaudeWorktimeSource } from "../worktime/worktimeSource";
import type { PtyManager } from "../pty/ptyManager";
import type { TaskService } from "../services/taskService";
import type { ILocalSubtaskStore } from "../monitor/punchExecutor";
import type { IScanWatermarkStore } from "../worktime/scanWatermarkStore";
import type { ConversationStore } from "../services/conversationStore";
import type { AppSettingsStore } from "../repo/appSettingsStore";
import type { EmitFn, SessionEntry } from "./types";

export interface BackendContext {
  // ---- 注入依賴（readonly；Backend constructor 接線後不換參照） ----
  readonly repo: SqliteTaskRepository;
  readonly ledger: PunchLedger;
  readonly worktimeSource: ClaudeWorktimeSource;
  readonly ptyManagerFactory: () => PtyManager;
  readonly taskService: TaskService;
  readonly subtaskRepo: ILocalSubtaskStore | null;
  readonly watermarkStore: IScanWatermarkStore | null;
  readonly convStore: ConversationStore;

  // ---- 共用可變狀態（同一參照，service 間共享；R5） ----
  readonly sessions: Map<string, SessionEntry>;
  readonly activeSessions: Map<string, string>;
  readonly ptyWaitingTasks: Set<string>;
  readonly ptyErrorTasks: Set<string>;

  // ---- emit（可被 setEmit 換 → 一律走方法，不可 capture 值；R3） ----
  emit(channel: string, payload: unknown): void;
  setEmit(e: EmitFn): void;

  // ---- lazy 單例 accessor（封裝既有 lazy 邏輯，service 不各自重建；R4） ----
  getAppSettingsStore(): AppSettingsStore | null;
}

/**
 * 工廠：Backend 在 constructor 內以閉包包出 host 物件（閉包指回 Backend 私有成員/方法），
 * 本工廠原樣回傳。lazy 狀態與「寫回」都留在 Backend / 對應 service（§3.2 決策），Context
 * 本身不持有任何可變狀態 —— 單一參照、單例語意由 Backend 既有欄位保證。
 */
export function makeBackendContext(host: BackendContext): BackendContext {
  return host;
}
