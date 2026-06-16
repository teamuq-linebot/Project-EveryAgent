/**
 * backend.ts — Composition Root / Application Service 層
 * 設計原則（可單測）：
 *   - webContents.send 包成可注入的 EmitFn callback，讓測試不需要真 Electron window。
 *   - PtyManager / PunchLedger / IWorktimeSource 均可從外部注入（測試 mock）。
 *   - 不 import BrowserWindow / Electron app — 由 index.ts 注入。
 *
 * B9：移除 SyncService / AuthService / PlatformService 及所有雲端欄位/方法。
 */

import { PunchLedger } from "./db/punchLedger";
import { TaskService } from "./services/taskService";
import { SqliteTaskRepository } from "./repo/sqliteTaskRepository";
import { ClaudeWorktimeSource } from "./worktime/worktimeSource";
import {
  SqliteScanWatermarkStore,
  type IScanWatermarkStore,
} from "./worktime/scanWatermarkStore";
import type { ILocalSubtaskStore } from "./monitor/punchExecutor";
import { PtyManager } from "./pty/ptyManager";
import { ConversationStore } from "./services/conversationStore";
import { AgentConversationService } from "./services/agentConversationService";
import { AgentConvSessionStore } from "./services/agentConvSessionStore";
import { initProgressService } from "./services/initProgressService";
import {
  watchDraft as watchDraftStore,
  unwatchDraft as unwatchDraftStore,
} from "./services/introductionDraftStore";
import * as path from "node:path";
import * as os from "node:os";
import { AGENT_ORG_CHANNELS, teamPathPart } from "../shared/ipcContracts";
import { runStartupMigrations } from "./backend/startupMigrations";

// ---------------------------------------------------------------------------
// backend/ 子目錄抽離（行為保留 move-only）：純函式 / 型別 / 常數 / 自含 view class。
//   re-export EmitFn / BackendDeps 維持 `import { ... } from "./backend"` 路徑不變
//   （consumer：index.ts / ipc/router.ts / tests/backend.spec.ts）。
// ---------------------------------------------------------------------------
import { NO_OP_EMIT } from "./backend/constants";
import type { EmitFn, SessionEntry, BackendDeps } from "./backend/types";
import { makeBackendContext, type BackendContext } from "./backend/context";
import { AppSettingsService } from "./backend/services/appSettingsService";
import { AgentTeamsService } from "./backend/services/agentTeamsService";
import { ProjectMilestoneService } from "./backend/services/projectMilestoneService";
import { SessionService } from "./backend/services/sessionService";
import { SessionConversationService } from "./backend/services/sessionConversationService";
import { MonitorService } from "./backend/services/monitorService";

export type { EmitFn, BackendDeps } from "./backend/types";

// ---------------------------------------------------------------------------
// Backend — Composition Root / Application Service
// ---------------------------------------------------------------------------

export class Backend {
  private readonly _ledger: PunchLedger;
  private readonly _worktimeSource: ClaudeWorktimeSource;
  private readonly _ptyManagerFactory: () => PtyManager;
  /** Task 讀路徑 service（Phase 5 / §3 本地讀；預設接 SqliteTaskRepository）。 */
  private readonly _taskService: TaskService;
  /**
   * 打卡本地化寫入目標（plan §2.9 / §6 批次 6c 接線）。注入 → MonitorController/PunchExecutor
   * 三段走本地原子路徑；省略（null）→ 退回既有 ledger 雙寫路徑（向後相容）。
   */
  private readonly _subtaskRepo: ILocalSubtaskStore | null;
  /**
   * 掃描水位持久化（plan §2.14a / D29）：注入給每個 MonitorController，sinceMs 走持久化水位。
   * null=關閉（退回既有 sinceMs 行為）。
   */
  private readonly _watermarkStore: IScanWatermarkStore | null;
  /**
   * 本地 repo（Phase 6.5：projects/milestones 本地 CRUD 直接走 repo，不經 TaskService）。
   * 預設與 TaskService 共用同一 SqliteTaskRepository 實例（單一連線）。
   */
  private readonly _repo: SqliteTaskRepository;
  /** 對話增量 + SQLite 持久化快取（lazy 開 DB；失敗退純記憶體） */
  private readonly _convStore = new ConversationStore();

  /**
   * AgentTeams 專屬「一條 claude 對話」後端服務（與 session 子系統平行）。
   * router 的 agentConv:open/input/close handler 直接呼叫此實例。
   */
  readonly agentConv: AgentConversationService;

  /**
   * BackendContext（拆分計畫 §3 / Batch 4 骨架）：delegate service 的共用依賴/狀態注入介面。
   */
  private readonly _ctx: BackendContext;

  /**
   * app_settings delegate service（Batch 4）：通用 app_settings 讀寫 + lazy store。
   */
  private readonly _appSettingsService: AppSettingsService;

  /**
   * AgentOrg + CLI + Team Registry delegate service（Batch 7）。
   */
  private readonly _agentTeamsService: AgentTeamsService;

  /**
   * Project / Milestone / Task 本地 CRUD delegate service（Batch 10）。
   */
  private readonly _projectMilestoneService: ProjectMilestoneService;

  /**
   * Session delegate service（Batch 11 / 11b）。
   */
  private readonly _sessionService: SessionService;

  /**
   * Session 綁定 + 對話查詢 delegate service（Batch 11 / 11a）。
   */
  private readonly _sessionConvService: SessionConversationService;

  /**
   * Monitor delegate service（Batch 12 / 收尾批）。
   */
  private readonly _monitorService: MonitorService;

  /** 執行期 session 表：sessionId → SessionEntry */
  private readonly _sessions = new Map<string, SessionEntry>();
  /** 執行期 claim 鎖：sessionId → taskId（同時只有一個任務監測一個 session）*/
  private readonly _activeSessions = new Map<string, string>();
  /**
   * PTY 互動提示偵測 — 由本偵測設為 waiting 的 taskId 集合。
   */
  private readonly _ptyWaitingTasks = new Set<string>();
  /**
   * PTY 錯誤偵測 — 由本偵測設為 error 的 taskId 集合。
   */
  private readonly _ptyErrorTasks = new Set<string>();

  /** IPC emit callback（測試可注入 mock；真機由 setEmit 注入 webContents.send）*/
  private _emit: EmitFn = NO_OP_EMIT;

  constructor(deps: BackendDeps = {}) {
    this.agentConv = new AgentConversationService(NO_OP_EMIT, this._convStore, new AgentConvSessionStore());
    this._ledger = deps.ledger ?? new PunchLedger();
    this._worktimeSource = deps.worktimeSource ?? new ClaudeWorktimeSource();
    this._ptyManagerFactory =
      deps.ptyManagerFactory ?? (() => new PtyManager());
    this._repo = deps.repo ?? new SqliteTaskRepository();
    this._taskService =
      deps.taskService ??
      new TaskService(this._repo);
    this._subtaskRepo = deps.subtaskRepo ?? null;
    if (deps.watermarkStore === undefined) {
      try {
        this._watermarkStore = new SqliteScanWatermarkStore();
      } catch (err) {
        console.error(
          "[watermark] SqliteScanWatermarkStore init failed (non-fatal):",
          err,
        );
        this._watermarkStore = null;
      }
    } else {
      this._watermarkStore = deps.watermarkStore;
    }

    const getTaskService = (): TaskService => this._taskService;
    this._appSettingsService = new AppSettingsService();
    this._ctx = makeBackendContext({
      repo: this._repo,
      ledger: this._ledger,
      worktimeSource: this._worktimeSource,
      ptyManagerFactory: this._ptyManagerFactory,
      get taskService(): TaskService { return getTaskService(); },
      subtaskRepo: this._subtaskRepo,
      watermarkStore: this._watermarkStore,
      convStore: this._convStore,
      sessions: this._sessions,
      activeSessions: this._activeSessions,
      ptyWaitingTasks: this._ptyWaitingTasks,
      ptyErrorTasks: this._ptyErrorTasks,
      emit: (channel, payload) => this._emit(channel, payload),
      setEmit: (e) => {
        this._emit = e;
      },
      getAppSettingsStore: () => this._appSettingsService.getStore(),
    });
    this._agentTeamsService = new AgentTeamsService(this._appSettingsService, this._repo);
    this._projectMilestoneService = new ProjectMilestoneService(this._ctx);
    this._sessionService = new SessionService(this._ctx, {
      getEmit: () => this._emit,
      startMonitor: (opts) => this._monitorService.startMonitor(opts),
    });
    this._sessionConvService = new SessionConversationService(this._ctx);
    this._monitorService = new MonitorService(this._ctx, {
      claimSession: (sessionId, taskId) =>
        this._sessionService.claimSession(sessionId, taskId),
      releaseClaim: (sessionId, taskId) =>
        this._sessionService.releaseClaim(sessionId, taskId),
      openSession: (opts) => this._sessionService.openSession(opts),
    });

    runStartupMigrations(this._repo, this._appSettingsService, this._agentTeamsService);
  }

  // --------------------------------------------------------------------------
  // Public accessor getters — 各 delegate service 的唯一暴露點
  // --------------------------------------------------------------------------

  /** 通用 app_settings 讀寫 + 資料目錄。 */
  get settings(): AppSettingsService { return this._appSettingsService; }

  /** Project / Milestone / Task 本地 CRUD + sync binding。 */
  get projects(): ProjectMilestoneService { return this._projectMilestoneService; }

  /** Session 管理（open/close/list/setProject/pty/runState）。 */
  get sessions(): SessionService { return this._sessionService; }

  /** Session 對話查詢 + 綁定（listProject/conversation/skills/segments/rebind/rename）。 */
  get conversations(): SessionConversationService { return this._sessionConvService; }

  /** Monitor 啟停/恢復 + PTY 提示偵測 + 打卡查詢。 */
  get monitor(): MonitorService { return this._monitorService; }

  /** AgentOrg / CLI / Team Registry。 */
  get agentTeams(): AgentTeamsService { return this._agentTeamsService; }

  // --------------------------------------------------------------------------
  // keepOnBackend：跨域協調 / 測試輔助 / 不值得單獨 accessor 的小型委派
  // --------------------------------------------------------------------------

  /**
   * 注入 IPC emit callback（BrowserWindow 建立後呼叫）。
   */
  setEmit(emit: EmitFn): void {
    this._emit = emit;
    // 更新現有所有 session 的 view emit
    for (const entry of this._sessions.values()) {
      entry.view.setEmit(emit);
    }
    // AgentTeams 對話服務的 emit 同步注入（agentConv:messages 推播靠它）。
    this.agentConv.setEmit(emit);
    // init-progress-pipeline：開機進度推播（init:progress UPDATE）同步注入。
    initProgressService.setEmit(emit);
  }

  /**
   * 停止所有 monitor + kill 所有 pty（app 退出 / window-all-closed）。
   */
  destroyAll(): void {
    this._sessionService.destroyAll();
    this.agentConv.disposeAll();
  }

  // --------------------------------------------------------------------------
  // watchAgentDraft / unwatchAgentDraft — 含 emit callback 閉包，保留在 Backend
  // --------------------------------------------------------------------------

  /**
   * 開始 fs.watch 監看指定 agent 的草稿檔（agentteams-edit-flow §4.4）。
   */
  watchAgentDraft(teamId: string, agentName: string): void {
    const rootPath = this._agentTeamsService.resolveTeamSourceRoot(teamId);
    const agentDir = path.join(
      rootPath,
      ...teamPathPart(teamId).split("/"),
      agentName,
    );
    const hostname = os.hostname();
    watchDraftStore(agentDir, hostname, (draft) => {
      this._emit(AGENT_ORG_CHANNELS.DRAFT_UPDATED, { teamId, agentName, draft });
    });
  }

  /**
   * 停止 fs.watch 監看指定 agent 的草稿檔。
   */
  unwatchAgentDraft(teamId: string, agentName: string): void {
    const rootPath = this._agentTeamsService.resolveTeamSourceRoot(teamId);
    const agentDir = path.join(
      rootPath,
      ...teamPathPart(teamId).split("/"),
      agentName,
    );
    unwatchDraftStore(agentDir, os.hostname());
  }

  // --------------------------------------------------------------------------
  // 測試輔助
  // --------------------------------------------------------------------------

  /** 取 session 數量（測試用）。*/
  get sessionCount(): number {
    return this._sessions.size;
  }

  /** 取 active sessions map（測試用）。*/
  get activeSessions(): ReadonlyMap<string, string> {
    return this._activeSessions;
  }

  /** 取 session entry（測試用）。*/
  getSessionEntry(sessionId: string): SessionEntry | undefined {
    return this._sessions.get(sessionId);
  }

  /**
   * workflow 子代理完整逐字稿（進度卡展開 agent → 載入完整內容）。
   */
  getWorkflowAgentConversation(
    sessionId: string,
    runId: string,
    agentId: string,
  ) {
    return this._sessionConvService.getWorkflowAgentConversation(sessionId, runId, agentId);
  }
}

// ---------------------------------------------------------------------------
// helpers — 已抽離至 backend/ 子目錄（行為保留 move-only）：
//   backend/rowMappers.ts   _pendingOp / parseProjectStatus / projectRowToDto /
//                           milestoneRowToDto / milestoneMemberRowToDto /
//                           platformRowToDto / platformOperationRowToDto
//   backend/ids.ts          _genSessionId / _samePath / _genUuid
// ---------------------------------------------------------------------------
