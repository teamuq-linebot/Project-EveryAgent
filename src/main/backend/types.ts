/**
 * backend/types.ts — Backend 層的可注入抽象型別與執行期狀態型別。
 *
 * 自 backend.ts 機械抽離（行為保留 move-only）：
 *   - EmitFn（webContents.send 可注入抽象；測試/spec import）
 *   - SessionEntry（單一 session 的執行期狀態）
 *   - BackendDeps（可注入依賴；測試/spec import）
 * backend.ts 以 re-export 維持 `import { EmitFn, BackendDeps } from "./backend"` 路徑不變。
 *
 * B9：移除 SyncEngine / SecretStore / ExternalOpener 等雲端注入型別。
 */

import type { PunchLedger } from "../db/punchLedger";
import type { TaskService } from "../services/taskService";
import type { SqliteTaskRepository } from "../repo/sqliteTaskRepository";
import type { ClaudeWorktimeSource } from "../worktime/worktimeSource";
import type { MonitorController } from "../monitor/MonitorController";
import type { IScanWatermarkStore } from "../worktime/scanWatermarkStore";
import type { ILocalSubtaskStore } from "../monitor/punchExecutor";
import type { PtyManager } from "../pty/ptyManager";
import type { MainProcessMonitorView } from "./monitorView";

// ---------------------------------------------------------------------------
// EmitFn — webContents.send 的可注入抽象（測試用 mock 替換）
// ---------------------------------------------------------------------------

/** 對應 Electron WebContents.send(channel, ...args) 的最小介面。*/
export type EmitFn = (channel: string, payload: unknown) => void;

// ---------------------------------------------------------------------------
// SessionEntry — 單一 session 的執行期狀態
// ---------------------------------------------------------------------------

export interface SessionEntry {
  sessionId: string;
  taskId: string;
  projectPath: string;
  milestoneId: string | null;
  /** 工具（claude / codex / vscode / custom）。 */
  tool: string;
  /** 被監測/resume 的真實 claude session uuid（非合成 sessionId）；null=非 claude 或無。 */
  claudeSessionId: string | null;
  /** 終端機開啟要注入的啟動指令（claude --resume <uuid> 等）；null=不注入。 */
  launchCommand: string | null;
  /** openSession 時 binding 路徑失效、由 JSONL cwd 反解修正時為 true。 */
  pathAutofixed: boolean;
  /**
   * session tab 開啟時間（Date.now()）。早於使用者點「開啟 CLI」spawn 之時，
   * 故 codex rollout 的 session_meta.timestamp 必然 ≥ 此值（單調安全）。
   * codex 定檔以此當「mtime/startedAt ≥ openedAtMs」下界，排掉本 tab 開啟前的舊 rollout。
   * 純 main 內部，不對外曝露（SessionInfo 不含）。
   */
  openedAtMs: number;
  view: MainProcessMonitorView;
  monitor: MonitorController;
  ptyManager: PtyManager;
}

// ---------------------------------------------------------------------------
// BackendDeps — 可注入依賴（測試時替換）
// ---------------------------------------------------------------------------

export interface BackendDeps {
  ledger?: PunchLedger;
  worktimeSource?: ClaudeWorktimeSource;
  ptyManagerFactory?: () => PtyManager;
  /**
   * Task 讀路徑 service（Phase 5 / §3 本地讀）。省略則預設接 SqliteTaskRepository
   *   + 以 client 解析 myUserId（mineOnly 過濾值，§3）。測試可注入 mock repo 的 service。
   */
  taskService?: TaskService;
  /**
   * 打卡本地化寫入目標（plan §6 批次 6c 接線）。省略 → null → MonitorController/PunchExecutor
   * 退回既有 appsync + ledger 雙寫路徑（向後相容）。真實 repo 由批次 6d 提供後注入。
   */
  subtaskRepo?: ILocalSubtaskStore | null;
  /**
   * 掃描水位持久化（plan §2.14a / D29）。注入 → MonitorController 的 sinceMs 取「該 session
   * 的持久化水位」（不再 Date.now()），每輪掃描後回寫水位 → 重啟/離線後從斷點續掃補卡。
   * 省略 → 自開一個 SqliteScanWatermarkStore（共用 teamuq.db，吃 TEAMUQ_HOME）；測試可注入
   * fake/null（傳 null 顯式關閉 → MonitorController 退回既有 sinceMs 行為）。
   */
  watermarkStore?: IScanWatermarkStore | null;
  /**
   * 本地 repo（Phase 6.5 sidebar 管理 UI：projects/milestones 本地 CRUD）。省略則自開一個
   * SqliteTaskRepository（吃 TEAMUQ_HOME 隔離，與 taskService 預設同型；測試可注入 mock）。
   * 注意：與 taskService 預設各自 new 會開兩條連線；正式接線時建議由 composition root 傳入
   * 同一實例（本批僅補 CRUD 介面，連線收斂於後續 backend 接線批次）。
   */
  repo?: SqliteTaskRepository;
}
