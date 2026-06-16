/**
 * backend/services/monitorService.ts — Monitor 啟停/恢復 + PTY 互動提示偵測 + 打卡查詢
 * delegate service（backend.ts 拆分計畫 Batch 12（收尾批）；行為保留 move-only）。
 *
 * 自 backend.ts 機械搬入：
 *   - W 區（PTY 互動提示偵測，全域 PtyManager 轉發入口）：onPtyPromptState。
 *   - S 區（Monitor 啟停/恢復，對應 Python QtSessionTab → presenter.start / stop）：
 *     startMonitor / stopMonitor / recoverMonitoring。
 *   - T 區（Punch 查詢）：listPunchesForTask。
 *
 * 共用可變狀態（R5 單一參照）：核心 `_sessions` Map 與 `_ptyWaitingTasks`/`_ptyErrorTasks`
 * Set 仍為 Backend 欄位，本 service 一律經 ctx.sessions / ctx.ptyWaitingTasks /
 * ctx.ptyErrorTasks 取**同一**參照（claim 鎖 / session 共讀不可各持 copy）。
 *
 * emit（R3）：alert 推播一律走 ctx.emit（呼叫時讀「當前」Backend._emit 值，setEmit
 * 換 emit 後自動生效；與原 `this._emit(...)` 逐字等價）。
 *
 * 跨域依賴一律經 BackendContext / hooks（§3.4 依賴矩陣）：
 *   - claim 鎖：hooks.claimSession / releaseClaim（SessionService 同一把鎖，R5）。
 *   - headless 恢復：hooks.openSession（SessionService；recoverMonitoring 重建 entry）。
 *   - assigneeId 解析：ctx.getSyncEngine()（SyncService lazy 單例，R4）。
 *   - 打卡帳本：ctx.ledger。
 *
 * Backend 對應 public 方法改 thin delegation（facade 簽名不變，consumer 零改動：
 * index.ts 的 onPtyPromptState/recoverMonitoring、router 的 startMonitor/stopMonitor/
 * listPunchesForTask）。
 */

import * as taskSessionsConfig from "../../config/taskSessions";
import { ALERT_CHANNELS } from "../../../shared/ipcContracts";
import type {
  PromptAlertPayload,
  SessionInfo,
} from "../../../shared/ipcContracts";
import type { BackendContext } from "../context";

/**
 * SessionService 協作點（建構時注入閉包，呼叫時 lazy 取值）：claim 鎖與 headless
 * openSession 的擁有權在 SessionService（Batch 11），本 service 不直接相依之。
 */
export interface MonitorServiceHooks {
  /** 轉呼 SessionService.claimSession（同一把鎖；對應 Python App.claim_session）。 */
  claimSession(sessionId: string, taskId: string): boolean;
  /** 轉呼 SessionService.releaseClaim（同一把鎖；對應 Python App.release_session）。 */
  releaseClaim(sessionId: string, taskId: string): void;
  /** 轉呼 SessionService.openSession（recoverMonitoring headless 重建 SessionEntry）。 */
  openSession(opts: {
    taskId: string;
    projectPath?: string;
    milestoneId?: string | null;
    tool?: string;
    customCommand?: string | null;
  }): SessionInfo;
}

export class MonitorService {
  constructor(
    private readonly _ctx: BackendContext,
    private readonly _hooks: MonitorServiceHooks,
  ) {}

  // --------------------------------------------------------------------------
  // PTY 互動提示偵測（全域 PtyManager 轉發入口）
  // --------------------------------------------------------------------------

  /**
   * PTY 互動提示偵測入口（由 index.ts 全域 PtyManager 的 onPromptStateChange 轉發）。
   * ptyId = 終端機 PTY 的 id = sessionId（TerminalPanel spawn 時以 sessionId 為 id）。
   * 回傳命中的 {sessionId, taskId}（waiting/error 轉換瞬間），否則 null —— index.ts 據此發系統通知。
   */
  onPtyPromptState(
    ptyId: string,
    state: "waiting" | "active" | "error",
    reason?: string,
    options?: { value: string; label: string }[],
    prompt?: string,
  ): { sessionId: string; taskId: string } | null {
    const entry = this._ctx.sessions.get(ptyId);
    if (!entry) return null; // 非 session 終端機（如 admin terminal），略過

    const { taskId, view } = entry;

    if (state === "waiting") {
      if (!this._ctx.ptyWaitingTasks.has(taskId)) {
        this._ctx.ptyWaitingTasks.add(taskId);
        view.setRunState("waiting");
        const alertPayload: PromptAlertPayload = {
          sessionId: ptyId,
          taskId,
          state: "waiting",
          reason: reason ?? "unknown",
          ...(options && options.length > 0 ? { options } : {}),
          ...(prompt ? { prompt } : {}),
        };
        this._ctx.emit(ALERT_CHANNELS.PROMPT_ALERT, alertPayload);
        return { sessionId: ptyId, taskId };
      }
    } else if (state === "error") {
      // CLI 錯誤或早夭：設 error run-state + 在狀態列顯示 ⚠ 文字
      if (!this._ctx.ptyErrorTasks.has(taskId)) {
        this._ctx.ptyErrorTasks.add(taskId);
        view.setRunState("error");
        view.showStatus(`⚠ CLI 錯誤：${reason ?? "unknown"}`);
        const alertPayload: PromptAlertPayload = {
          sessionId: ptyId,
          taskId,
          state: "error",
          reason: reason ?? "unknown",
        };
        this._ctx.emit(ALERT_CHANNELS.PROMPT_ALERT, alertPayload);
        return { sessionId: ptyId, taskId };
      }
    } else {
      // active — 只有本偵測設的 waiting/error 才回 running，不蓋 monitor 的 waiting
      if (this._ctx.ptyWaitingTasks.has(taskId)) {
        this._ctx.ptyWaitingTasks.delete(taskId);
        view.setRunState("running");
        this._ctx.emit(ALERT_CHANNELS.PROMPT_ALERT, {
          sessionId: ptyId,
          taskId,
          state: "resolved",
          reason: "",
        });
      } else if (this._ctx.ptyErrorTasks.has(taskId)) {
        this._ctx.ptyErrorTasks.delete(taskId);
        view.setRunState("running");
        this._ctx.emit(ALERT_CHANNELS.PROMPT_ALERT, {
          sessionId: ptyId,
          taskId,
          state: "resolved",
          reason: "",
        });
      }
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Monitor（對應 Python QtSessionTab → presenter.start / stop）
  // --------------------------------------------------------------------------

  /**
   * 啟動 session 的打卡監測。
   * 對應 Python SessionMonitorPresenter.start()。
   * 若 session 不存在或 claim 失敗 → return false。
   */
  async startMonitor(opts: {
    sessionId: string;
    taskId: string;
    projectPath: string;
    milestoneId?: string | null;
    sinceMs?: number;
  }): Promise<boolean> {
    const { sessionId, taskId, projectPath, milestoneId, sinceMs } = opts;

    const entry = this._ctx.sessions.get(sessionId);
    if (!entry) return false;

    // claim 鎖（對應 Python App.claim_session；實作已下放 SessionService，Batch 11 —— 同一把鎖）
    if (!this._hooks.claimSession(sessionId, taskId)) return false;

    // 純本地：assigneeId 恆為 null（雲端 assignee 概念已移除）。
    const assigneeId: number | null = null;

    // 監測目標 = 真實 claude session uuid（非合成 tab sessionId）。
    // claude 無解析 → 退回合成 id（維持舊行為，掃不到只是空表）。
    // codex：claudeSessionId 恆為 null（裸啟動無 uuid），傳 undefined → MonitorController
    //   依 tool==='codex' 維持空集（定檔靠 cwd，不依 id 過濾）。
    const monitoredSessionIds = entry.claudeSessionId
      ? [entry.claudeSessionId]
      : undefined;

    // codex sinceMs 下界：monitoredSessionIds 為空 → resolveSinceMs 找不到水位會退回
    //   `sinceMs ?? 0`（=從頭掃，會把同 cwd 歷史 rollout 全聚成大量舊打卡）。故補 openedAtMs
    //   當下界，排掉本 tab 開啟前的回合（與對話面板 findCodexRollout 的 openedAtMs 下界一致）。
    const effectiveSinceMs =
      sinceMs ?? (entry.tool === "codex" ? entry.openedAtMs : undefined);

    const started = entry.monitor.startMonitor({
      projectPath,
      taskId,
      assigneeId,
      sessionId,
      sinceMs: effectiveSinceMs,
      monitoredSessionIds,
      tool: entry.tool,
    });

    if (!started) {
      // startMonitor 內部 claim 也有守門（MonitorController 自有 claim 邏輯）；
      // 已在監測 → 不重開
      this._hooks.releaseClaim(sessionId, taskId);
    } else {
      // §2.14c D30：監測啟動成功 → 持久化 monitoring 旗標（app 重啟後自動恢復）。
      // 只對 claude 監測對象落地（非 claude 無打卡掃描；setMonitoring 自身亦守門需有 active）。
      if (entry.claudeSessionId) {
        try {
          taskSessionsConfig.setMonitoring(taskId, true);
        } catch {
          // 旗標寫盤失敗不阻斷監測（記憶體仍在跑，只是少了重啟自動恢復）
        }
      }
    }

    return started;
  }

  /**
   * 停止 session 的打卡監測。
   * 對應 Python SessionMonitorPresenter.stop()。
   */
  stopMonitor(sessionId: string): void {
    const entry = this._ctx.sessions.get(sessionId);
    if (!entry) return;
    try {
      entry.monitor.stopMonitor();
    } catch {
      // 容錯
    }
    this._hooks.releaseClaim(sessionId, entry.taskId);
    // §2.14c D30：使用者主動停止監測 → 清 monitoring 旗標（下次啟動不自動恢復）。
    // 注意：app 退出走 closeSession（destroyAll），**不**清旗標 → 重啟才會自動恢復。
    try {
      taskSessionsConfig.setMonitoring(entry.taskId, false);
    } catch {
      // 容錯
    }
  }

  /**
   * App 啟動自動恢復監測（§2.14c D30）。對 task_sessions 中 monitoring=1 的綁定，
   * **不需開 Tab** 即重建 SessionEntry（headless openSession）+ 重啟監測。
   *
   * 由 composition root（index.ts whenReady、遷移完成後）單點呼叫；冪等：
   *   - openSession 對同 taskId 已有 session → 回既有（不重複建）。
   *   - startMonitor 不傳 sinceMs → MonitorController 走持久化水位續掃（D29），
   *     重啟前完成的 end 事件 / 整段離線的工作段都掃得到 → 自然補卡。
   * 容錯：單一綁定恢復失敗只記，不阻斷其他綁定。回成功恢復的 taskId 清單。
   */
  async recoverMonitoring(): Promise<string[]> {
    let bindings: taskSessionsConfig.MonitoringBinding[] = [];
    try {
      bindings = taskSessionsConfig.listMonitoringTasks();
    } catch {
      return [];
    }

    const recovered: string[] = [];
    for (const b of bindings) {
      try {
        // headless 開 session（建 view+monitor+pty，不依賴 renderer Tab）。
        const info = this._hooks.openSession({
          taskId: b.task_id,
          projectPath: b.project_path ?? undefined,
          tool: "claude",
        });
        const started = await this.startMonitor({
          sessionId: info.sessionId,
          taskId: b.task_id,
          projectPath: info.projectPath,
          milestoneId: info.milestoneId,
          // 不傳 sinceMs → 走持久化水位續掃（D29）。
        });
        if (started) recovered.push(b.task_id);
      } catch {
        // 單一綁定恢復失敗不阻斷其餘
      }
    }
    return recovered;
  }

  // --------------------------------------------------------------------------
  // Punches
  // --------------------------------------------------------------------------

  /**
   * 取某 task 的所有打卡紀錄。
   * 對應 Python 帳本 list_punches_for_task。
   */
  listPunchesForTask(taskId: string): Record<string, unknown>[] {
    return this._ctx.ledger.listPunchesForTask(taskId);
  }
}
