/**
 * backend/services/sessionService.ts — Session 生命週期 + PTY 轉發 + claim 鎖
 * delegate service（backend.ts 拆分計畫 Batch 11（11b 生命週期 M+V+claim）；
 * 行為保留 move-only）。
 *
 * 自 backend.ts 機械搬入：
 *   - M 區（Session 生命週期，對應 Python App.open_session_tab / close_session）：
 *     openSession / closeSession / listActiveSessions / setSessionProject +
 *     私有 _sessionInfoOf / _resolveSessionPlan。
 *   - V 區（PTY 轉發 / RunState 查詢 / 全關）：getPtyManager / getRunState / destroyAll
 *     （agentConv.disposeAll 留在 Backend.destroyAll，agentConv 是 Backend public 欄位）。
 *   - claim 鎖（對應 Python App.claim_session / release_session）：claimSession /
 *     releaseClaim（原 `_claimSession`/`_releaseClaim`；改 public —— Monitor 域
 *     （Batch 12 前仍在 Backend）的 startMonitor / stopMonitor 需要）。
 *
 * U 區（綁定 / 對話查詢）同批拆至 sessionConversationService.ts（11a；ESLint
 * max-lines:500 守門，新檔不入 allowlist）。
 *
 * 共用可變狀態（R5 單一參照）：核心 `_sessions`/`_activeSessions` Map 與
 * `_ptyWaitingTasks`/`_ptyErrorTasks` Set 仍為 Backend 欄位，本 service 一律經
 * ctx.sessions / ctx.activeSessions / ctx.ptyWaitingTasks / ctx.ptyErrorTasks 取
 * **同一**參照（claim 鎖 / monitor 共讀不可各持 copy）。
 *
 * emit（R3）：closeSession 推播走 ctx.emit（呼叫時讀當前值）；openSession 建
 * MainProcessMonitorView 需要 raw emit「值」（view 自存、由 Backend.setEmit 統一
 * refresh —— 既有機制不動）→ 經 hooks.getEmit() 於呼叫當下取 Backend._emit 現值
 * （與原 `new MainProcessMonitorView(sessionId, taskId, this._emit)` 逐字等價）。
 *
 * 跨域依賴一律經 BackendContext（§3.3 / §3.4 依賴矩陣）：
 *   - onPunchSettled gate：ctx.isLoggedIn()（AuthService）+ ctx.sync()（SyncService）。
 *   - 打卡 client：ctx.getPunchClient()（SyncService lazy 單例，R4）。
 *   - setSessionProject 工具切換重啟監測：hooks.startMonitor 轉呼 Backend.startMonitor
 *     （Monitor 域 Batch 12 下放後改指 MonitorService；轉呼點不變）。
 *
 * Backend 對應 public 方法改 thin delegation（facade 簽名不變，consumer 零改動）。
 */

import * as fs from "fs";
import * as os from "os";
import { MonitorController } from "../../monitor/MonitorController";
import type { PtyManager } from "../../pty/ptyManager";
import * as milestonesConfig from "../../config/milestones";
import * as taskSessionsConfig from "../../config/taskSessions";
import { buildLaunchCommand } from "../../services/sessions";
import {
  listSessionFilesLight,
  findSessionHome,
} from "../../worktime/claude/lightList";
import type {
  CardRunStatePayload,
  SessionInfo,
} from "../../../shared/ipcContracts";
import {
  CARD_CHANNELS,
  ALERT_CHANNELS,
} from "../../../shared/ipcContracts";
import { _genSessionId, _samePath, _genUuid } from "../ids";
import { MainProcessMonitorView } from "../monitorView";
import type { EmitFn, SessionEntry } from "../types";
import type { BackendContext } from "../context";

/** 路徑存在且為目錄（用於偵測綁定資料夾是否已被刪除）。失敗一律回 false。 */
function _dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Backend 回呼掛鉤（仍留在 Backend 本體的協作點；建構時注入閉包，呼叫時 lazy 取值）。
 */
export interface SessionServiceHooks {
  /**
   * 取「當前」raw emit 值（openSession 建 view 用）。view 自存 emit、由 Backend.setEmit
   * 統一 refresh（既有機制不動）；本 hook 於呼叫當下讀 Backend._emit 現值（R3：不可
   * 在 constructor capture 值）。
   */
  getEmit(): EmitFn;
  /**
   * 轉呼 Backend.startMonitor（setSessionProject 工具切換時結算舊卡 + 重啟監測）。
   * Monitor 域 Batch 12 下放 MonitorService 後改指向之；本 service 不直接相依 Monitor 域。
   */
  startMonitor(opts: {
    sessionId: string;
    taskId: string;
    projectPath: string;
    milestoneId?: string | null;
    sinceMs?: number;
  }): Promise<boolean>;
}

export class SessionService {
  constructor(
    private readonly _ctx: BackendContext,
    private readonly _hooks: SessionServiceHooks,
  ) {}

  // --------------------------------------------------------------------------
  // Session 管理（對應 Python App.open_session_tab / close_session）
  // --------------------------------------------------------------------------

  /**
   * 開啟一個 session（建立 SessionEntry：view + monitor + ptyManager）。
   * 對應 Python App.open_session_tab（claim 鎖 + 建 backend / QtSessionTab 的 TS 版）。
   *
   * 同一 taskId 若已有 session → 回既有 sessionId（冪等，對應 _find_session_tab_by_task）。
   * milestoneId 若帶入 → 從 config/milestones 查 project_path（對應 Python _on_card_open）。
   * 回傳 SessionInfo { sessionId, taskId, projectPath, milestoneId }。
   */
  openSession(opts: {
    taskId: string;
    projectPath?: string;
    milestoneId?: string | null;
    tool?: string;
    customCommand?: string | null;
    /** 強制開全新 session（不沿用 active / 不 resume 同資料夾最新）；「開始團隊對話」用。 */
    forceNewSession?: boolean;
  }): SessionInfo {
    const { taskId, milestoneId = null } = opts;

    // 已有同 taskId 的 session → 冪等回傳
    for (const [sid, entry] of this._ctx.sessions.entries()) {
      if (entry.taskId === taskId) {
        return this._sessionInfoOf(sid, entry);
      }
    }

    // 解析 projectPath + tool + customCommand：milestoneId → config/milestones.get
    // 對應 Python _on_card_open: entry = milestones.get(mid); project_path = entry.get("project_path")
    let projectPath = opts.projectPath ?? "";
    let tool = (opts.tool ?? "").trim().toLowerCase() || "claude";
    let customCommand = opts.customCommand ?? null;
    if (milestoneId) {
      const cfgEntry = milestonesConfig.get(milestoneId);
      if (cfgEntry) {
        if (cfgEntry.project_path) projectPath = cfgEntry.project_path;
        if (cfgEntry.tool) tool = String(cfgEntry.tool).trim().toLowerCase();
        if (cfgEntry.custom_command) customCommand = cfgEntry.custom_command;
      }
    }
    // milestone 沒給路徑（或此 task 無 milestone）→ 退回 task_sessions 記錄的 per-task
    // 路徑（使用者在監測區設定後存於此，不依賴 milestone id）。
    if (!projectPath) {
      try {
        const saved = taskSessionsConfig.getActiveProjectPath(taskId);
        if (saved) projectPath = saved;
      } catch {
        // 容錯
      }
    }
    // 仍無路徑 → 本地專案任務的資料夾綁在 project_folders（以 task.project_local_id 為鍵，
    // 經 linkProjectFolder 建立），milestone / task_sessions 都查不到。由此反查補上，否則
    // 從看板雙擊開啟本地專案任務時 projectPath="" → session plan / 對話檔解析皆失敗 →
    // 監測不啟動、對話欄全空（修：本地專案任務對話無法監測）。
    if (!projectPath) {
      try {
        const folder = this._resolveFolderByTaskProject(taskId);
        if (folder) projectPath = folder;
      } catch {
        // 反查失敗不阻斷（退回原本空路徑行為）
      }
    }

    // 產生新 sessionId（合成 tab/pty id；對應 Python App._gen_session_id()）
    const sessionId = _genSessionId();

    // 解析「要監測/resume 哪個 claude session」+ 終端啟動指令（對應 Qt
    // _ensure_cli_terminal 的分支 + MonitorTargetsService.resolve）。
    // plan.projectPath 為生效路徑（autofix 時與傳入值不同）；plan.pathAutofixed 表示
    // 發生了全域反查自動修正（用戶拍板的例外，授權此處回寫 taskSessionsConfig）。
    const plan = this._resolveSessionPlan(
      taskId,
      projectPath,
      tool,
      customCommand,
      opts.forceNewSession ?? false,
    );

    const view = new MainProcessMonitorView(sessionId, taskId, this._hooks.getEmit());
    const monitor = new MonitorController({
      view,
      worktimeSource: this._ctx.worktimeSource,
      ledger: this._ctx.ledger,
      // 純本地：subtaskRepo 必填（SqliteTaskRepository 同時實作 ILocalSubtaskStore）。
      subtaskRepo: (this._ctx.subtaskRepo ?? this._ctx.repo) as import('../../monitor/punchExecutor').ILocalSubtaskStore,
      // §2.14d / D31：打卡成功（end/oneshot）後落 punch_artifacts（hunk 級精確行數，純本地）。
      artifactStore: this._ctx.repo,
      // §2.14a / D29：注入持久化水位 → sinceMs 走斷點續掃（不再 Date.now()），補下工卡 / oneshot 卡。
      watermarkStore: this._ctx.watermarkStore,
    });
    const ptyManager = this._ctx.ptyManagerFactory();

    const entry: SessionEntry = {
      sessionId,
      taskId,
      projectPath: plan.projectPath,
      milestoneId,
      tool,
      claudeSessionId: plan.claudeSessionId,
      launchCommand: plan.launchCommand,
      pathAutofixed: plan.pathAutofixed,
      openedAtMs: Date.now(),
      view,
      monitor,
      ptyManager,
    };
    this._ctx.sessions.set(sessionId, entry);

    if (plan.pathAutofixed) {
      try {
        taskSessionsConfig.setActiveProjectPath(taskId, plan.projectPath);
      } catch {
        // 自我修復回寫失敗不阻斷
      }
      view.showStatus(`已自動修正專案路徑 → ${plan.projectPath}`);
    }

    return this._sessionInfoOf(sessionId, entry);
  }

  /** SessionEntry → 對外 SessionInfo（含 tool / launchCommand / claudeSessionId）。 */
  private _sessionInfoOf(sessionId: string, entry: SessionEntry): SessionInfo {
    // backend 直接查 repo 取任務名稱，避免 renderer hydrate 時看板 tasks 未載入而顯示數字 ID。
    let taskName: string = entry.taskId;
    try {
      const row = this._ctx.repo.getTask(entry.taskId);
      if (row?.name) taskName = row.name;
    } catch {
      // repo 查詢失敗（非致命）：退回 taskId
    }
    return {
      sessionId,
      taskId: entry.taskId,
      taskName,
      projectPath: entry.projectPath,
      milestoneId: entry.milestoneId,
      tool: entry.tool,
      launchCommand: entry.launchCommand,
      claudeSessionId: entry.claudeSessionId,
      pathAutofixed: entry.pathAutofixed,
    };
  }

  /**
   * 列出目前 main 端「實際存在」的所有 session（含 headless recoverMonitoring 恢復的）。
   *
   * 這是「實際監測 / 開啟集合」的單一真相來源：renderer 啟動時據此 hydrate tab，
   * 使「看板 card 閃 === 左邊監測列表 === backend 在監測的 session」三者一致，
   * 且每個監測中 session 都有對應 tab（修「監測中 card 閃數 ≠ 監測列表數」）。
   *
   * recoverMonitoring 走 headless openSession + startMonitor → entry 進 _sessions，
   * 但 renderer 不知道；本 API 把這些 entry 暴露出去供 renderer 補開 tab。
   * 冪等友善：renderer 補開 tab → SessionTab mount 再 start，因 MonitorController
   * 的 `_monitorActive` 守門而不重複掃 / 不重複建 monitor。
   */
  listActiveSessions(): SessionInfo[] {
    const out: SessionInfo[] = [];
    for (const [sid, entry] of this._ctx.sessions.entries()) {
      out.push(this._sessionInfoOf(sid, entry));
    }
    return out;
  }

  /**
   * 設定 session 的專案路徑（+ 工具）—— 對應 Qt 監測區「設定」段（工具/專案路徑）。
   * milestone 沒設 project_path 時 session 撈不到任何 claude session；此方法讓使用者
   * 於監測區直接提供路徑。更新 entry、存回 milestone 設定、依新路徑重解析監測對象，
   * 並用新路徑重啟監測（重掃）。回新的 projectPath / tool / claudeSessionId / launchCommand。
   */
  async setSessionProject(
    sessionId: string,
    projectPath: string,
    tool?: string,
  ): Promise<{
    ok: boolean;
    projectPath: string;
    tool: string;
    claudeSessionId: string | null;
    launchCommand: string | null;
  }> {
    const entry = this._ctx.sessions.get(sessionId);
    if (!entry) {
      return {
        ok: false,
        projectPath: "",
        tool: "",
        claudeSessionId: null,
        launchCommand: null,
      };
    }

    const oldTool = entry.tool;
    entry.projectPath = (projectPath ?? "").trim();
    if (tool) entry.tool = String(tool).trim().toLowerCase();
    const toolChanged = entry.tool !== oldTool;

    // 存回 milestone 設定（下次開同 milestone 沿用）。
    if (entry.milestoneId) {
      try {
        const ex = milestonesConfig.get(entry.milestoneId);
        milestonesConfig.setEntry(entry.milestoneId, {
          project_path: entry.projectPath || null,
          tool: entry.tool,
          custom_command: ex?.custom_command ?? null,
        });
      } catch {
        // 寫設定失敗不阻斷
      }
    }

    // 依新路徑重新解析監測對象 + 啟動指令。
    const plan = this._resolveSessionPlan(
      entry.taskId,
      entry.projectPath,
      entry.tool,
      null,
    );
    entry.projectPath = plan.projectPath;
    entry.claudeSessionId = plan.claudeSessionId;
    entry.launchCommand = plan.launchCommand;

    // 路徑也存進 task_sessions（per-task，不依賴 milestone id）：記到 active session。
    // setActive 只在空時填；setActiveProjectPath 無條件覆寫（使用者改路徑時用）。
    if (entry.claudeSessionId) {
      try {
        taskSessionsConfig.setActive(entry.taskId, entry.claudeSessionId, {
          source: "claude",
          project_path: entry.projectPath || null,
        });
        taskSessionsConfig.setActiveProjectPath(
          entry.taskId,
          entry.projectPath || null,
        );
      } catch {
        // 容錯
      }
    }

    if (toolChanged) {
      // 工具改變 → 重啟監測（對齊 Qt _on_tool_changed：重新決定 source —— claude 打卡 /
      //  codex/vscode/custom 尚未支援；結算舊卡、重置基準線）。
      try {
        entry.monitor.stopMonitor();
      } catch {
        // 容錯
      }
      this.releaseClaim(sessionId, entry.taskId);
      try {
        await this._hooks.startMonitor({
          sessionId,
          taskId: entry.taskId,
          projectPath: entry.projectPath,
          milestoneId: entry.milestoneId,
        });
      } catch {
        // 啟動失敗不阻斷回傳
      }
    } else {
      // 只改路徑 → 對齊 Qt _apply：scan 讀即時 project_path，不重啟 backend（避免
      //  非預期監測重置 + 多餘 assignee 重解析）。即時更新路徑 + 輕量 rebind（換目標重掃）。
      try {
        entry.monitor.setProjectPath(entry.projectPath);
        if (entry.claudeSessionId) entry.monitor.rebind(entry.claudeSessionId);
      } catch {
        // 容錯
      }
    }

    return {
      ok: true,
      projectPath: entry.projectPath,
      tool: entry.tool,
      claudeSessionId: entry.claudeSessionId,
      launchCommand: entry.launchCommand,
    };
  }

  /**
   * 解析「要監測/resume 的 claude session uuid」+ 終端啟動指令。
   * 對應 Qt session_panel_build._ensure_cli_terminal 的分支 + MonitorTargetsService.resolve：
   *   - 非 claude：無 claude session；指令 = 工具預設 / customCommand。
   *   - claude，config 有 active 且磁碟有其 JSONL → resume 它。
   *   - claude，config 有 active 但磁碟**無** JSONL（綁過「新 session」但 claude 從未
   *     啟動、或檔案被刪）→ resume 會失敗 → 改用同 uuid `claude --session-id` 開新對話。
   *   - claude，無 active 但專案有既有 session → resume 最新並設為 active。
   *   - claude，全新任務（無任何 session）→ 生成新 uuid，`claude --session-id <uuid>`，設為 active。
   * claudeSessionId 即監測對象（真 uuid），與合成 tab sessionId 解耦。
   */
  private _resolveSessionPlan(
    taskId: string,
    projectPath: string,
    tool: string,
    customCommand: string | null,
    forceNew = false,
  ): {
    claudeSessionId: string | null;
    launchCommand: string | null;
    projectPath: string;
    pathAutofixed: boolean;
  } {
    if (tool !== "claude") {
      // 非 claude：無監測對象 uuid，指令走工具預設 / customCommand。
      const { command } = buildLaunchCommand(
        tool,
        projectPath,
        null,
        customCommand,
        "resume",
      );
      return {
        claudeSessionId: null,
        launchCommand: command,
        projectPath,
        pathAutofixed: false,
      };
    }

    // forceNew（從「開始團隊對話」過來）：略過所有「沿用既有 session」的解析
    //（active 綁定 + 同資料夾最新 session），claudeSessionId 維持 null →
    // 下方 step 3 直接 _genUuid + new_id 開一條全新 session，確保 /tuq-agent <任務>
    // 注入一條乾淨對話，而非接到資料夾裡的舊對話。
    let claudeSessionId: string | null = null;
    if (!forceNew) {
      // 1) config 已綁定的 active session 優先。
      try {
        claudeSessionId = taskSessionsConfig.getActive(taskId);
      } catch {
        claudeSessionId = null;
      }
    }

    // 1.5) 使用者剛在綁定 UI 換了專案路徑（傳入 projectPath ≠ active session 當初綁定的
    //   路徑）→ 視為明確的情境切換：舊 active uuid 是在「舊路徑」產生的，對新路徑無效。
    //   丟棄它 → 走下方「無 active」分支：在新路徑下找最新 session resume，否則開新對話。
    //   此舉**優先於** §4 的全域反查 autofix——否則 autofix 會用舊 uuid 把生效路徑拉回舊
    //   路徑，等於忽略使用者剛選的新路徑（用戶實測：選了新路徑套用後仍開在舊路徑）。
    //   專案沒搬、路徑沒變的情境：boundPath === projectPath → 不觸發，autofix 行為不變。
    if (claudeSessionId && projectPath) {
      let boundPath: string | null = null
      try {
        boundPath = taskSessionsConfig.getActiveProjectPath(taskId)
      } catch {
        boundPath = null
      }
      if (boundPath && !_samePath(boundPath, projectPath)) {
        claudeSessionId = null
      }
    }

    // 2) 無 active → 取最新既有 session（輕量 readdir+stat，不做完整解析——
    //    getProject 全解析大 session 會卡死 main process）。
    //    §dup-fix（根因）：跳過「已被其他任務綁定/監測」的 session。否則同資料夾的兩個
    //    任務都會解析到同一個 latest session → 各自物化同一筆 worktime 打卡 → 本地重複記錄
    //    （claim 鎖只鎖 tab sessionId，鎖不到共用的 claude uuid，故須在解析端排除）。
    if (!forceNew && !claudeSessionId && projectPath) {
      try {
        const ownedByOthers = this._sessionIdsOwnedByOtherTasks(taskId);
        const latest = listSessionFilesLight(projectPath).find(
          (s) => s.session_id && !ownedByOthers.has(s.session_id),
        )?.session_id;
        // 全部 latest 皆被別任務佔用 → 留 null → 下方開「新」session（一 session ↔ 一任務）。
        if (latest) claudeSessionId = latest;
      } catch {
        // 掃描失敗不阻斷
      }
    }

    let mode: "resume" | "new_id" = "resume";
    let effectivePath = projectPath;
    let pathAutofixed = false;

    if (!claudeSessionId) {
      // 3) 全新任務：生成新 uuid，以 --session-id 啟動。
      // 新 session 一旦由 claude 產生 JSONL，下次開啟即被 getProject 當 latest 抓回
      // → resume，自我收斂。
      claudeSessionId = _genUuid();
      mode = "new_id";
    } else {
      // 4) 有 active uuid → 驗證磁碟上真有此 uuid 的 JSONL：
      //    - projectPath 非空且驗到 → 原行為 resume。
      //    - projectPath 空 或 驗不到 → 全域反查 findSessionHome：
      //        命中 → 以查到的路徑 resume（autofix）；
      //        未命中 → mode='new_id'（同 uuid 開新對話，永不炸 No conversation found）。
      const foundLocally = effectivePath
        ? (() => {
            try {
              return listSessionFilesLight(effectivePath).some(
                (s) => s.session_id === claudeSessionId,
              );
            } catch {
              return false;
            }
          })()
        : false;

      if (!foundLocally) {
        const globalPath = findSessionHome(claudeSessionId);
        if (globalPath) {
          effectivePath = globalPath;
          pathAutofixed = true;
          mode = "resume";
        } else {
          mode = "new_id";
        }
      }
    }

    // effectivePath 仍指向「不存在的資料夾」（如綁定資料夾被刪除：autofix 也找不到、留在原無效
    // 路徑）→ 三個子系統會各看各的 bucket：PTY cwd 無效會被 resolveCwd 回退到 home（claude 實際
    // 在 home 跑、JSONL 寫 home），但對話讀取 / 監測仍用此無效 projectPath → 對話框空白、監測掃不到。
    // 統一回退到 home（與 ptyManager.resolveCwd 的 fallback 一致），讓 PTY cwd / 對話讀取 / 監測對齊；
    // pathAutofixed 觸發 openSession 回寫 task_sessions + 顯示「已自動修正專案路徑」提示使用者重設。
    if (tool === "claude" && effectivePath && !_dirExists(effectivePath)) {
      console.warn(
        `[session] 綁定資料夾不存在，effectivePath 回退 home：${effectivePath} → ${os.homedir()}`,
      );
      effectivePath = os.homedir();
      pathAutofixed = true;
    }

    const { command } = buildLaunchCommand(
      tool,
      effectivePath,
      claudeSessionId,
      customCommand,
      mode,
    );
    return {
      claudeSessionId,
      launchCommand: command,
      projectPath: effectivePath,
      pathAutofixed,
    };
  }

  /**
   * 關閉一個 session（stop monitor + kill pty + release claim）。
   * 對應 Python App._on_tab_close_requested / widget.close()。
   */
  closeSession(sessionId: string): void {
    const entry = this._ctx.sessions.get(sessionId);
    if (!entry) return;

    // 停 monitor（自動 releaseSession）
    try {
      entry.monitor.stopMonitor();
    } catch {
      // 容錯
    }

    // Kill 全部 pty
    try {
      entry.ptyManager.killAll();
    } catch {
      // 容錯
    }

    // 釋放 claim 鎖（monitor.stopMonitor 已呼叫 releaseSession；這裡補保險）
    this.releaseClaim(sessionId, entry.taskId);

    this._ctx.sessions.delete(sessionId);
    // 清除 PTY prompt waiting/error 旗標（防止 session 關閉後殘留影響下次開啟）
    const wasWaiting = this._ctx.ptyWaitingTasks.delete(entry.taskId);
    const wasError = this._ctx.ptyErrorTasks.delete(entry.taskId);
    // 若原本在 waiting/error → 通知 renderer 移除殭屍 toast
    if (wasWaiting || wasError) {
      this._ctx.emit(ALERT_CHANNELS.PROMPT_ALERT, {
        sessionId,
        taskId: entry.taskId,
        state: "resolved",
        reason: "",
      });
    }

    // 推送 card:runState none（對應 Python set_card_run_state(task_id, "none")）
    const payload: CardRunStatePayload = {
      taskId: entry.taskId,
      state: "none",
    };
    this._ctx.emit(CARD_CHANNELS.RUN_STATE, payload);
  }

  // --------------------------------------------------------------------------
  // PTY 轉發（給 IPC router 用）
  // --------------------------------------------------------------------------

  /**
   * 取某 session 的 PtyManager（IPC router 轉發 pty 指令用）。
   * session 不存在 → null。
   */
  getPtyManager(sessionId: string): PtyManager | null {
    return this._ctx.sessions.get(sessionId)?.ptyManager ?? null;
  }

  // --------------------------------------------------------------------------
  // MonitorController runState 查詢（給卡片變色指示器用）
  // --------------------------------------------------------------------------

  /**
   * 取某 session 的 current run state。
   * 對應 Python App._poll_indicators → widget.current_run_state()。
   */
  getRunState(sessionId: string): "none" | "idle" | "running" | "waiting" | "completed" {
    return this._ctx.sessions.get(sessionId)?.monitor.currentRunState() ?? "none";
  }

  // --------------------------------------------------------------------------
  // 關閉所有 session（app 退出時）
  // --------------------------------------------------------------------------

  /**
   * 停止所有 monitor + kill 所有 pty（app 退出 / window-all-closed）。
   * 對應 Python App.closeEvent。
   * （agentConv.disposeAll 由 Backend.destroyAll 接續呼叫 —— agentConv 是 Backend
   *   public 欄位，不下放本 service。）
   */
  destroyAll(): void {
    for (const sid of [...this._ctx.sessions.keys()]) {
      this.closeSession(sid);
    }
  }

  // --------------------------------------------------------------------------
  // claim 鎖（對應 Python App.claim_session / release_session）
  //   原 Backend 私有 `_claimSession`/`_releaseClaim`；改 public —— Monitor 域
  //   （startMonitor/stopMonitor，Batch 12 前仍在 Backend）跨域需要。邏輯逐字不變。
  // --------------------------------------------------------------------------

  claimSession(sessionId: string, taskId: string): boolean {
    const sid = String(sessionId || "").trim();
    const tid = String(taskId || "").trim();
    if (!sid) return false;
    const owner = this._ctx.activeSessions.get(sid);
    if (owner === undefined || owner === tid) {
      this._ctx.activeSessions.set(sid, tid);
      return true;
    }
    return false;
  }

  releaseClaim(sessionId: string, taskId: string): void {
    const sid = String(sessionId || "").trim();
    const tid = String(taskId || "").trim();
    if (!sid) return;
    if (this._ctx.activeSessions.get(sid) === tid) {
      this._ctx.activeSessions.delete(sid);
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers（§dup-fix / project folder fallback）
  // --------------------------------------------------------------------------

  /**
   * §dup-fix（根因）：列出「被『其他任務』綁定/監測中」的 claude session uuid 集合。
   * 用於 resolveSessionPlan 步驟 2 的 latest 解析排除——確保同一資料夾的兩個任務
   * 不會解析到同一個 claude session（避免同筆 worktime 打卡被各自物化、重複上傳）。
   *
   * 來源取聯集，涵蓋「現在開著的 tab」與「持久化的監測綁定」兩種情境：
   *   - 執行期 _sessions：其他任務 entry.claudeSessionId（含尚未落 DB 的剛開 tab）。
   *   - taskSessionsConfig.listMonitoringTasks()：其他任務 monitoring=1 的 active 綁定。
   */
  private _sessionIdsOwnedByOtherTasks(taskId: string): Set<string> {
    const tid = String(taskId || "").trim();
    const owned = new Set<string>();
    for (const entry of this._ctx.sessions.values()) {
      if (entry.taskId !== tid && entry.claudeSessionId) {
        owned.add(entry.claudeSessionId);
      }
    }
    try {
      for (const b of taskSessionsConfig.listMonitoringTasks()) {
        if (b.task_id !== tid && b.session_id) owned.add(b.session_id);
      }
    } catch {
      // 綁定查詢失敗不阻斷（退回只用執行期 _sessions）。
    }
    return owned;
  }

  /**
   * 由 taskId 反查其所屬本地專案綁定的資料夾路徑（openSession 第四層 fallback）。
   *
   * 本地專案任務（origin='local'）的資料夾不存於 milestone / task_sessions，而是綁在
   * project_folders（task.project_local_id → folder_path，經 linkProjectFolder 建立）。
   *
   * taskId 認親：renderer 傳的 id = remote_id ?? local_id，故先試 local_id（getTask），
   * 未中再以舊識別欄位線性反查（相容存量資料）。
   * 一個 project 可關聯多個資料夾時取建立順序最早的非空者；查無回 null。
   */
  private _resolveFolderByTaskProject(taskId: string): string | null {
    const tid = String(taskId || "").trim();
    if (!tid) return null;
    let row = this._ctx.repo.getTask(tid);
    if (!row) {
      try {
        row = this._ctx.repo.findAllTasks().find((t) => t.local_id === tid) ?? null;
      } catch {
        row = null;
      }
    }
    const projectLocalId = row?.project_local_id;
    if (!projectLocalId) return null;
    const folders = this._ctx.repo.findFoldersByProject(projectLocalId);
    return folders.find((f) => typeof f === "string" && f.trim().length > 0) ?? null;
  }
}
