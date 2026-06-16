/**
 * MonitorController.ts — 監測編排 Controller
 *
 * 忠實移植自 Python:
 *   teamuq/app/session_monitor_presenter.py   (組裝 + run-state 純運算)
 *   teamuq/app/presenter_lifecycle.py         (start/stop + claim/release)
 *   teamuq/app/presenter_scan.py              (2s 掃描迴圈 + 世代 token)
 *   teamuq/app/presenter_punch.py             (打卡編排 + 指紋節流)
 *
 * QThread → async 對映：
 *   - 掃描迴圈：setInterval(2000) 觸發 _scanOnce（對應 QTimer.timeout → _scan_once）
 *   - 世代 token：_monitorGen 計數器，async 回呼回來先比對，不符就 return
 *     （對應 Python self._monitor_gen 語意完全等價）
 *   - in-flight 樂觀鎖：await 前同步標記（_punchInFlight = true），對應
 *     Python _punch_in_flight = True 在 QThread 前同步設旗
 *   - claim 鎖：Controller 內部 _claimedSessions: Set<string> + _claimedByTask Map
 *     （對應 App.claim_session / release_session 語意）
 *
 * 硬約束：零 Qt / 零 I/O；I/O 全部由注入介面提供（IWorktimeSource / IAppSyncClient /
 *   IPunchLedger / IMonitorView）。
 */

import { PunchService } from '../services/punchService';
import type { OpenAnchor } from '../services/punchService';
import { PunchBuilderMixin } from '../services/punchBuilder';
import {
  isSessionLive,
  getSessionStatusRunState,
  getJsonlFallbackRunState,
} from './sessionLiveness';
import type { SessionRunState } from './sessionLiveness';
import type {
  IMonitorView,
  IWorktimeSource,
  IAppSyncClient,
  IPunchLedger,
  PunchRow,
  PunchEvents,
  MonitorControllerOptions,
} from './types';
import { PunchExecutor } from './punchExecutor';
import type { ILocalSubtaskStore, IPunchArtifactStore } from './punchExecutor';
import type { IScanWatermarkStore } from '../worktime/scanWatermarkStore';
// claim 鎖單例 + helper 純函式 + run-state 狀態機 + 掃描間隔解析 + punch 表建構：
// 已抽出至 sibling 檔；原檔以 import 綁定使用（行為等價，呼叫面零變化）。
// punch 兩階段執行流程 + watermark 推進：抽至 punchOrchestrator / watermarkAdvancer。
import { punchTwoPhase } from './punchOrchestrator';
import type { PunchOrchestratorCtx } from './punchOrchestrator';
import { advanceWatermark, resolveSinceMs as resolveSinceMsFn } from './watermarkAdvancer';
import {
  claimSession,
  releaseSession,
  isSessionClaimed,
  clearAllClaims,
} from './sessionClaimRegistry';
import { mergeRunState } from './monitorHelpers';
import { runStateFromEvents, runStateFromCodexEvents } from './SessionRunStateMachine';
import { resolveScanIntervalMs } from './scanIntervalConfig';
import {
  buildLiveOverlay,
  buildPunchRowsFromDb,
  buildPunchRowsFromEvents,
} from './PunchTableBuilder';
import { findProjectFolder } from '../worktime/claude/discover';
import { readSessionWorkflows, workflowsSignature } from '../worktime/claude/workflows';

// ---------------------------------------------------------------------------
// MonitorController
// ---------------------------------------------------------------------------

export class MonitorController {
  // ---- 注入依賴 ----
  private readonly _view: IMonitorView;
  private readonly _worktimeSource: IWorktimeSource;
  private readonly _ledger: IPunchLedger | null;
  /**
   * 打卡本地化寫入目標（唯一路徑；必填）。
   */
  private readonly _subtaskRepo: ILocalSubtaskStore;
  /**
   * punch_artifacts 落表目標（plan §2.14d D31）。注入 → 打卡成功（end/oneshot）後把該 punch
   * 涵蓋的 Edit/Write 操作落表（純本地不上傳）；未注入（null）→ PunchExecutor 略過落表。
   */
  private readonly _artifactStore: IPunchArtifactStore | null;
  /**
   * 掃描水位持久化（plan §2.14a / D29；§6 批次 scan-watermark）。
   * 注入 → startMonitor 的 sinceMs 取「該 session 的持久化水位」（不再 Date.now()），
   *   每輪掃描後回寫水位 → 重啟/離線後從斷點續掃（補下工卡 / oneshot 卡）。
   * 未注入（null）→ 維持既有 sinceMs 行為（向後相容；既有 wiring/spec 不變）。
   */
  private readonly _watermarkStore: IScanWatermarkStore | null;

  // ---- 世代 token（Presenter canonical，對應 Python self._monitor_gen）----
  /** 每次 start / stop 自增。async 回呼回來先比對，不符就丟棄。 */
  private _monitorGen = 0;

  // ---- 監測狀態 ----
  private _monitorActive = false;
  private _projectPath = '';
  private _taskId: unknown = null;
  private _assigneeId: unknown = null;
  private _sessionId = '';
  /** CLI 工具（'claude' | 'codex'）；決定 collectPunchEvents 掃哪個來源。 */
  private _tool = 'claude';
  /** 要掃描的真實 claude session uuid 集合（與合成 tab sessionId 解耦）。 */
  private _monitoredSessionIds: Set<string> = new Set();
  private _monitorStartMs = 0;
  private _monitorTimer: ReturnType<typeof setInterval> | null = null;

  // ---- 打卡服務（每次 start 重建，重置去重 / 樂觀鎖）----
  private _punchService: PunchService = new PunchService();

  // ---- 掃描狀態 ----
  private _scanInFlight = false;

  // ---- 打卡 in-flight 樂觀鎖 ----
  private _punchInFlight = false;

  // ---- 事件快照（表格決策用）----
  private _lastSubagentEvents: Record<string, unknown>[] = [];
  private _mainState: Record<string, unknown> = {};
  private _mainEvents: Record<string, unknown>[] = [];
  private _liveOverlay: Map<string, { hours: number; in_progress: boolean }> = new Map();

  // ---- run-state ----
  private _runState: SessionRunState = 'none';

  /**
   * 翻「綠（completed）」遲滯：連續判定 completed 的掃描次數。
   * 掃描週期 2s，需連續 COMPLETED_HYSTERESIS_SCANS 次（≈6s）才真正翻綠，
   * 避免 agent 工作流中單次短暫靜止就誤判完成、再翻回 running 的綠↔藍閃爍。
   * 只對「進入 completed」遲滯；離開 completed 或進入 running/waiting/error 皆即時反映。
   */
  private _pendingCompletedScans = 0;
  private static readonly COMPLETED_HYSTERESIS_SCANS = 3;

  // ---- 指紋節流（對應 Python _last_punch_fingerprint）----
  private _lastPunchFingerprint: string | null = null;

  // ---- workflow 進度節流（只在 run/agent 狀態變動時推 card:workflowProgress）----
  private _lastWorkflowSig: string | null = null;

  // ---- 初始 fallback DB rows snapshot ----
  private _dbRowsSnapshot: Record<string, unknown>[] | null = null;

  // ---- 打卡執行層（PunchExecutor 委派）--------------------------------------
  private _punchExecutor: PunchExecutor;

  // ---- 打卡 settle 後回呼（backend 觸發 sync；登入態才推）----
  private _onPunchSettled: (() => void) | null = null;

  constructor(opts: {
    view: IMonitorView;
    worktimeSource: IWorktimeSource;
    /** @deprecated 純本地後不再使用；保留參數避免呼叫端一次大改。 */
    appsync?: IAppSyncClient | null;
    ledger?: IPunchLedger | null;
    /** 打卡本地化寫入目標（必填；唯一打卡路徑）。 */
    subtaskRepo: ILocalSubtaskStore;
    /** punch_artifacts 落表目標（plan §2.14d D31）；省略 → null → PunchExecutor 略過落表。 */
    artifactStore?: IPunchArtifactStore | null;
    /** 掃描水位持久化（plan §2.14a / D29）；省略 → null → 維持既有 sinceMs 行為。 */
    watermarkStore?: IScanWatermarkStore | null;
    /** @deprecated 純本地後 sync 已移除；保留參數避免呼叫端一次大改。 */
    onPunchSettled?: () => void;
  }) {
    this._view = opts.view;
    this._worktimeSource = opts.worktimeSource;
    this._ledger = opts.ledger ?? null;
    this._subtaskRepo = opts.subtaskRepo;
    this._artifactStore = opts.artifactStore ?? null;
    this._watermarkStore = opts.watermarkStore ?? null;
    this._onPunchSettled = null; // 純本地後不再觸發 sync
    // 初始化 PunchExecutor（local 為唯一路徑；sessionId 在 startMonitor 時更新）
    this._punchExecutor = new PunchExecutor({
      local: this._subtaskRepo,
      artifactStore: this._artifactStore,
      cli: this._tool,
    });
  }

  // ---- run-state 純運算 -------------------------------------------------------

  currentRunState(): SessionRunState {
    return this._runState;
  }

  private _setRunState(state: SessionRunState): void {
    this._runState = state;
    this._view.setRunState(state);
  }

  /**
   * 套用掃描判定出的 run-state，並對「翻綠（completed）」施加遲滯。
   *   - computed === 'completed'：累計連續次數；未達門檻 → 維持目前狀態（不 emit），
   *     避免短暫靜止造成假綠。達門檻 → 翻綠。
   *   - 其他狀態（running/waiting/error/idle/none）：重置遲滯計數，即時反映。
   * 僅用於掃描迴圈路徑；生命週期（start/stop/rebind）直接呼 _setRunState 並重置計數。
   */
  private _applyComputedRunState(computed: SessionRunState): void {
    if (computed === 'completed') {
      this._pendingCompletedScans += 1;
      if (this._pendingCompletedScans < MonitorController.COMPLETED_HYSTERESIS_SCANS) {
        return; // 尚未連續足夠次數 → 維持目前狀態，等穩定再翻綠
      }
      this._setRunState('completed');
      return;
    }
    this._pendingCompletedScans = 0;
    this._setRunState(computed);
  }

  /**
   * 更新卡片 run-state。偵測順序（用戶定案）：
   *   1. 首選 ~/.claude/sessions 心跳檔的 status 欄（busy→running / waiting→waiting / idle→idle）。
   *   2. 無對應檔或無 status 欄 → JSONL fallback（主對話 + subagent）：
   *        尾端未回答的 AskUserQuestion → waiting；近期事件 → running；否則 idle。
   *   3. 兩者皆無從判斷 → 退回既有事件式判斷（_runStateFromEvents）。
   * 對應 Python update_run_state_from_events（事件式為最終 fallback）。
   */
  private _updateRunStateFromEvents(events: PunchEvents): void {
    if (!this._monitorActive) return;

    // codex：無 ~/.claude/sessions 心跳、無 claude JSONL（步驟 1/2 皆 claude 專用），且 codex 有
    //   明確 task_complete 結束訊號 → 直接用 main_events.is_complete 判定（未完成→running，
    //   否則 completed/idle），避免落到 claude 的 90s 新鮮度啟發法而卡在「思考中」。
    if (this._tool === 'codex') {
      this._applyComputedRunState(runStateFromCodexEvents(events));
      return;
    }

    // 1. sessions 心跳 status 為主：被監測的任一 session 有可映射的 status 即採用。
    //    多 session 取「最積極」狀態（running > waiting > idle），避免一個 idle 殘檔蓋掉真在跑的。
    let fromStatus: SessionRunState | null = null;
    for (const sid of this._monitoredSessionIds) {
      const st = getSessionStatusRunState(sid);
      if (st === null) continue;
      fromStatus = mergeRunState(fromStatus, st);
    }
    if (fromStatus !== null) {
      this._applyComputedRunState(fromStatus);
      return;
    }

    // 2. JSONL fallback（主對話 + subagent）。
    if (this._projectPath) {
      const fromJsonl = getJsonlFallbackRunState(this._projectPath, this._monitoredSessionIds);
      if (fromJsonl !== null) {
        this._applyComputedRunState(fromJsonl);
        return;
      }
    }

    // 3. 退回既有事件式判斷。
    this._applyComputedRunState(this._runStateFromEvents(events));
  }

  /** 事件式 run-state（原 _updateRunStateFromEvents 邏輯）。對應 Python update_run_state_from_events。 */
  private _runStateFromEvents(events: PunchEvents): SessionRunState {
    return runStateFromEvents(events);
  }

  // ---- 生命週期：startMonitor / stopMonitor ----------------------------------

  /**
   * 啟動打卡監測。
   * 對應 Python PresenterLifecycleMixin.start()。
   * claim 鎖：同一 session 已被佔用（別任務）→ 不重複監測，直接 return。
   */
  startMonitor(opts: MonitorControllerOptions): boolean {
    const { projectPath, taskId, assigneeId, sessionId, sinceMs, monitoredSessionIds, tool } = opts;

    if (this._monitorActive) return false; // 已在監測

    // claim 鎖：嘗試佔用 session
    if (!claimSession(sessionId, taskId)) {
      // 已被別任務佔用 → 不監測
      return false;
    }

    // 遞增世代 token：舊在途回呼失效
    this._monitorGen += 1;

    this._monitorActive = true;
    this._projectPath = projectPath;
    this._taskId = taskId;
    this._assigneeId = assigneeId;
    this._sessionId = sessionId;
    this._tool = (tool ?? 'claude').trim().toLowerCase() || 'claude';
    // 掃描目標：注入的真 claude uuid 集合；省略 → 退回合成 id（舊行為）。
    // codex 例外：啟動不指定 session id（檔名 uuid 事前未知），定檔靠 cwd，故維持空集
    //   （不退回合成 tab id —— 退回會讓 aggregate 以該 id 過濾而掃不到任何 rollout）。
    this._monitoredSessionIds = new Set(
      monitoredSessionIds && monitoredSessionIds.length > 0
        ? monitoredSessionIds
        : this._tool === 'codex'
          ? []
          : [sessionId],
    );
    // 掃描基準 sinceMs（plan §2.14a / D29）：
    //   注入水位 store → 取「被監測 session 的持久化水位」（多 session 取最小，不漏任一段未完工作），
    //     無任何水位 → 退回傳入 sinceMs（= task 綁定時間起算），**不再 Date.now()**。
    //   未注入 store → 維持既有行為（sinceMs ?? Date.now()；向後相容）。
    this._monitorStartMs = this._resolveSinceMs(sinceMs);

    // 每輪 start 重建 PunchService（完整重置去重 / 樂觀鎖 / errors / main 旗標）
    this._punchService = new PunchService();

    // 重建 PunchExecutor（帶新 sessionId + 本地 subtask repo + artifacts sink）
    this._punchExecutor = new PunchExecutor({
      local: this._subtaskRepo,
      artifactStore: this._artifactStore,
      sessionId,
      cli: this._tool,
    });

    // 重置快照
    this._lastSubagentEvents = [];
    this._mainState = {};
    this._mainEvents = [];
    this._liveOverlay = new Map();
    this._punchInFlight = false;
    this._scanInFlight = false;
    this._dbRowsSnapshot = null;
    this._lastPunchFingerprint = null;
    this._pendingCompletedScans = 0;

    this._setRunState('idle');

    // 預載帳本（跨重啟去重）
    this._preloadLedgerIntoService();

    // 啟動掃描迴圈（2s）
    this._startScanTimer();

    return true;
  }

  /**
   * 解析掃描基準 sinceMs（plan §2.14a / D29）。委派 watermarkAdvancer.resolveSinceMs。
   */
  private _resolveSinceMs(sinceMs?: number): number {
    return resolveSinceMsFn(this._watermarkStore, this._monitoredSessionIds, sinceMs);
  }

  /**
   * 每輪掃描後推進水位（plan §2.14a）。委派 watermarkAdvancer.advanceWatermark。
   */
  private _advanceWatermark(events: PunchEvents): void {
    this._monitorStartMs = advanceWatermark(
      events,
      this._watermarkStore,
      this._monitoredSessionIds,
      this._monitorStartMs,
    );
  }

  /**
   * 停止監測。
   * 對應 Python PresenterLifecycleMixin.stop()。
   * 遞增 gen → 所有在途舊 scan/punch 回呼失效。
   * 釋放 session claim 鎖。
   */
  stopMonitor(): void {
    if (!this._monitorActive) return;

    this._monitorActive = false;

    // 遞增世代 token：所有在途回呼立即失效
    this._monitorGen += 1;

    this._pendingCompletedScans = 0;
    this._setRunState('none');

    // 停掃描 timer
    if (this._monitorTimer !== null) {
      clearInterval(this._monitorTimer);
      this._monitorTimer = null;
    }

    // 清掉 workflow 進度卡（推空陣列）+ 重置節流簽名
    if (this._view.setWorkflowProgress) this._view.setWorkflowProgress([]);
    this._lastWorkflowSig = null;

    // 釋放 session claim 鎖
    releaseSession(this._sessionId, this._taskId);
  }

  /**
   * 換監測對象（對應 Qt monitor_bind._on_bind_session 的重置邏輯）。
   * - 未在監測：只更新下次 start 用的 target 集合。
   * - 監測中：換 _monitoredSessionIds、重置 since 基準 + 去重 / 樂觀鎖 / 指紋 /
   *   事件快照，重建 PunchService/Executor，預載帳本後立即掃一次。
   */
  rebind(claudeSessionId: string): void {
    const target = new Set([claudeSessionId]);
    if (!this._monitorActive) {
      this._monitoredSessionIds = target;
      return;
    }
    this._monitoredSessionIds = target;
    // 換 session：有水位 store → 取新 session 的水位續掃（不再 Date.now()）；無 → 維持舊行為。
    this._monitorStartMs = this._watermarkStore
      ? this._resolveSinceMs(undefined)
      : Date.now();
    this._punchService = new PunchService();
    this._punchExecutor = new PunchExecutor({
      local: this._subtaskRepo,
      artifactStore: this._artifactStore,
      sessionId: this._sessionId,
      cli: this._tool,
    });
    this._lastSubagentEvents = [];
    this._mainState = {};
    this._mainEvents = [];
    this._liveOverlay = new Map();
    this._punchInFlight = false;
    this._scanInFlight = false;
    this._dbRowsSnapshot = null;
    this._lastPunchFingerprint = null;
    this._lastWorkflowSig = null; // 換 session → 重置 workflow 進度節流
    this._pendingCompletedScans = 0; // 換 session → 重置翻綠遲滯
    this._preloadLedgerIntoService();
    void this._scanOnce();
  }

  /**
   * 即時更新監測的專案路徑（對齊 Qt：scan 迴圈讀即時 project_path，改路徑不必重啟）。
   * 下一輪掃描即用新路徑；不重置 since/去重（重置由 rebind 在換 session 時負責）。
   */
  setProjectPath(projectPath: string): void {
    this._projectPath = projectPath;
  }

  // ---- claim 鎖查詢（測試用）-------------------------------------------------

  /** 查詢某 session 是否被佔用（測試可用）。委派 sessionClaimRegistry。 */
  static isSessionClaimed(sid: string): boolean {
    return isSessionClaimed(sid);
  }

  /** 清除全部 claim 鎖（測試隔離用）。委派 sessionClaimRegistry。 */
  static clearAllClaims(): void {
    clearAllClaims();
  }

  // ---- 掃描迴圈 ---------------------------------------------------------------

  private _startScanTimer(): void {
    if (this._monitorTimer !== null) {
      clearInterval(this._monitorTimer);
    }
    // 設定頁「進階 → 監測掃描間隔」覆寫（clamp 1~30s）；改了下次 startMonitor 生效。
    const intervalMs = resolveScanIntervalMs();
    this._monitorTimer = setInterval(() => {
      void this._scanOnce();
    }, intervalMs);
    // 立即跑第一次
    void this._scanOnce();
  }

  /**
   * 掃描迴圈入口。
   * 對應 Python PresenterScanMixin._scan_once()。
   * 世代 token：async 回呼回來先比對 gen，不符就 return。
   */
  private async _scanOnce(): Promise<void> {
    if (!this._monitorActive) return;
    if (this._scanInFlight) return;
    if (!this._projectPath) return;

    this._scanInFlight = true;
    const gen = this._monitorGen; // 快照當下世代

    try {
      const events = await this._worktimeSource.collectPunchEvents(
        this._projectPath,
        this._monitorStartMs,
        this._monitoredSessionIds,
        this._tool,
      );

      // 世代 token 比對（對應 Python gen != self._monitor_gen → return）
      if (gen !== this._monitorGen || !this._monitorActive) {
        return; // 舊世代 / 已停 → 丟棄
      }

      this._onScanDone(events, gen);
    } catch {
      // scan 失敗：用空 events 繼續（對應 Python err is not None 分支）
      if (gen !== this._monitorGen || !this._monitorActive) return;
      this._onScanDone({ subagent_events: [], main: { ...this._mainState } }, gen);
    } finally {
      this._scanInFlight = false;
    }
  }

  /**
   * scan 完成後的編排（對應 Python _on_scan_done_impl）。
   * 由 _scanOnce 在 await 後、比對 gen 之後呼叫，因此這裡不再重複比對 gen。
   */
  private _onScanDone(events: PunchEvents, _gen: number): void {
    // 更新 run-state
    this._updateRunStateFromEvents(events);

    const subCount = (events.subagent_events || []).length;
    const mainEventCount = Number((events.main || {})['event_count'] || 0);
    const ts = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    const sessionTag = this._sessionId
      ? (isSessionLive(this._sessionId) ? '・session 進行中' : '・session 已結束')
      : '';
    this._view.showStatus(`${ts}　掃描中 — ${subCount + 1} 項目${mainEventCount > 0 ? ` (${mainEventCount} main events)` : ''}${sessionTag}`);

    // DB rows snapshot（對應 Python _apply_events 中的 punch_db_rows 更新）
    if ('punch_db_rows' in events && events.punch_db_rows !== null) {
      this._dbRowsSnapshot = events.punch_db_rows ?? null;
    }

    // 套用事件（打卡編排）
    this._applyEvents(events);

    // 推進掃描水位（plan §2.14a / D29）：在打卡編排後寫，確保本輪事件已被消化。
    this._advanceWatermark(events);

    // 掃 workflow 進度（純顯示，不涉打卡）：讀被監測 session 的 workflows 資料夾，
    // 指紋節流後推 card:workflowProgress。
    this._scanWorkflows();
  }

  /**
   * 掃描被監測 session 的 workflow 進度並推給 renderer（card:workflowProgress）。
   * 純顯示：讀 <projectFolder>/<sessionId>/workflows/wf_*.json，指紋節流避免每輪洗版。
   * I/O 容錯為先（找不到資料夾 / 壞檔皆視為空）。
   */
  private _scanWorkflows(): void {
    if (!this._monitorActive) return;
    if (!this._view.setWorkflowProgress) return; // stale-preload / 測試 mock 容錯
    if (!this._projectPath) return;

    let folderPath: string;
    try {
      const match = findProjectFolder(this._projectPath);
      if (!match.folder_path) return;
      folderPath = match.folder_path;
    } catch {
      return;
    }

    const workflows = [];
    for (const sid of this._monitoredSessionIds) {
      for (const w of readSessionWorkflows(folderPath, sid)) workflows.push(w);
    }
    // 合併後再排一次（running 優先、其餘新到舊），確保跨 session 順序一致。
    workflows.sort((a, b) => {
      const ar = a.status === 'running' ? 0 : 1;
      const br = b.status === 'running' ? 0 : 1;
      if (ar !== br) return ar - br;
      return (b.startTime ?? 0) - (a.startTime ?? 0);
    });

    const sig = workflowsSignature(workflows);
    if (sig === this._lastWorkflowSig) return;
    this._lastWorkflowSig = sig;
    this._view.setWorkflowProgress(workflows);
  }

  // ---- 打卡編排 ---------------------------------------------------------------

  /**
   * 套用 scan events：更新快照 → 算 can_punch → render 表格 → 排打卡 actions。
   * 對應 Python PresenterPunchMixin._apply_events()。
   */
  private _applyEvents(events: PunchEvents): void {
    const subagentEvents = events.subagent_events || [];
    const main = events.main || {};

    // 更新主對話 main 事件快照
    this._mainEvents = (events.main_events || []) as Record<string, unknown>[];
    this._lastSubagentEvents = subagentEvents as Record<string, unknown>[];
    this._mainState = {
      duration_hours: parseFloat(String(main['duration_hours'] || 0.0)) || 0.0,
      started_at: main['started_at'] ?? null,
      ended_at: main['ended_at'] ?? null,
      event_count: Number(main['event_count'] || 0),
      output_json_title: main['output_json_title'] ?? null,
      output_json_description: main['output_json_description'] ?? null,
    };

    // live overlay 快照
    this._liveOverlay = this._buildLiveOverlay(events);

    const canPunch = this._canPunch();

    // 先 render（含不可打卡時只顯示）
    this._renderPunchTableNow(canPunch);

    if (!canPunch) return;

    // 兩段式打卡編排
    this._punchTwoPhase(events);
  }

  /** 對應 Python _build_live_overlay（純函式）。委派 PunchTableBuilder。 */
  private _buildLiveOverlay(events: PunchEvents): Map<string, { hours: number; in_progress: boolean }> {
    return buildLiveOverlay(events);
  }

  /**
   * 是否可打卡：local-first（plan §3 / §2.9 / §6 批次 6c）——**唯一前提=有任務對象（taskId）**。
   * 打卡免登入：不再 gate assigneeId（assigneeId 後移，未登入/未解析時仍可寫本地 'loc:' subtask，
   * assigneeId 仍透傳給 PunchExecutor / repo（有則帶、無則略）。
   */
  private _canPunch(): boolean {
    return Boolean(this._taskId);
  }

  // ---- 兩段式打卡 -------------------------------------------------------------

  /**
   * 兩段式打卡編排。委派 punchOrchestrator.punchTwoPhase。
   * 對應 Python PresenterPunchMixin._punch_two_phase()。
   */
  private _punchTwoPhase(events: PunchEvents): void {
    punchTwoPhase(events, this._makeOrchestratorCtx());
  }

  /**
   * 組裝 PunchOrchestratorCtx（帶 this 各欄位參照 + renderAfterPunch 閉包）。
   * punchInFlight 以 Proxy 包裝，確保對 ctx.punchInFlight 的寫入
   * 能同步回寫至 this._punchInFlight（行為等價原 this 欄位直接讀寫）。
   */
  private _makeOrchestratorCtx(): PunchOrchestratorCtx {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get punchInFlight() { return self._punchInFlight; },
      set punchInFlight(v: boolean) { self._punchInFlight = v; },
      get monitorGen() { return self._monitorGen; },
      get punchService() { return self._punchService; },
      get punchExecutor() { return self._punchExecutor; },
      taskId: this._taskId,
      assigneeId: this._assigneeId,
      sessionId: this._sessionId,
      onPunchSettled: this._onPunchSettled,
      builder: this._makeBuilder(),
      renderAfterPunch: () => { this._renderPunchTableNow(this._canPunch()); },
    };
  }

  // ---- 表格列決策 + 指紋節流 --------------------------------------------------

  /**
   * 算列 → 指紋節流 → 交 View 畫。
   * 對應 Python _render_punch_table_now（含 _last_punch_fingerprint 節流）。
   */
  private _renderPunchTableNow(canPunch: boolean): void {
    const rows = this._buildPunchRows(canPunch);

    // 指紋節流（對應 Python 以 tuple 建 fingerprint）
    const fingerprint = JSON.stringify([
      canPunch,
      rows.length,
      rows.map(r => [
        r.name, r.started_at, r.ended_at, Math.round(r.hours * 10000) / 10000,
        r.status, r.show_end, r.type, r.description, r.subtask_id, r.error,
      ]),
    ]);

    if (fingerprint === this._lastPunchFingerprint) return; // 資料沒變 → 跳過重畫
    this._lastPunchFingerprint = fingerprint;

    this._view.renderPunchTable(rows, canPunch);
  }

  /**
   * 算表格列（對應 Python _build_punch_rows）。
   * 優先讀 _dbRowsSnapshot（DB 驅動）；無則 fallback event-based。
   */
  private _buildPunchRows(canPunch: boolean): PunchRow[] {
    if (this._ledger && this._taskId) {
      const dbRows = this._dbRowsSnapshot;
      if (dbRows !== null) {
        return this._buildPunchRowsFromDb(dbRows, canPunch);
      }
      // 即時查該 task 全部打卡（含已完成）。原本用 listOpen(sessionId) 只回 status='open'，
      //   打卡一結算就從即時表消失、要重開任務才看得到最新一筆；改用 listPunchesForTask
      //   （與重開任務同一資料源）→ 完成的打卡即時出現。
      const rows = this._ledger.listPunchesForTask(this._taskId);
      return this._buildPunchRowsFromDb(rows, canPunch);
    }
    return this._buildPunchRowsFromEvents(canPunch);
  }

  /** DB 驅動版（對應 Python build_punch_rows_from_db）。委派 PunchTableBuilder（傳入對應 this 欄位）。 */
  private _buildPunchRowsFromDb(dbRows: Record<string, unknown>[], canPunch: boolean): PunchRow[] {
    return buildPunchRowsFromDb(dbRows, canPunch, this._liveOverlay, this._punchService);
  }

  /** event-based fallback（對應 Python _build_punch_rows_from_events）。委派 PunchTableBuilder（傳入對應 this 欄位）。 */
  private _buildPunchRowsFromEvents(canPunch: boolean): PunchRow[] {
    return buildPunchRowsFromEvents(
      canPunch,
      this._mainEvents,
      this._mainState,
      this._lastSubagentEvents,
      this._punchService,
    );
  }

  // ---- 帳本預載 ---------------------------------------------------------------

  /**
   * 跨重啟去重：從帳本預載已 done / open key 灌進 PunchService。
   * 對應 Python _preload_ledger_into_service()。
   */
  private _preloadLedgerIntoService(): void {
    const ledger = this._ledger;
    if (!ledger || !this._sessionId) return;
    try {
      const done = ledger.preloadDoneKeys(this._sessionId);
      const opens = ledger.listOpen(this._sessionId);
      const openMap = new Map<string, string>();
      const openAnchors = new Map<string, OpenAnchor>();
      for (const o of opens) {
        if (o['punch_uid'] && o['subtask_id']) {
          openMap.set(String(o['punch_uid']), String(o['subtask_id']));
        }
        // 建 OpenAnchor：key=punch_uid，欄位對應 DB open 列
        if (o['punch_uid']) {
          openAnchors.set(String(o['punch_uid']), {
            subtask_id: String(o['subtask_id'] ?? ''),
            name: String(o['name'] ?? ''),
            started_at: o['started_at'] != null ? String(o['started_at']) : null,
            type: String(o['type'] ?? ''),
          });
        }
      }
      this._punchService.preload(done, openMap, openAnchors);
    } catch {
      // 帳本問題絕不可擋監測：靜默略過
    }
  }

  // ---- NameBuilder shim -------------------------------------------------------

  /**
   * 對應 Python builder（= self.view，PunchBuilderMixin 在 View）。
   * TS 版用 PunchBuilderMixin 實例（實作完整 NameBuilder 介面）。
   */
  private _makeBuilder(): PunchBuilderMixin {
    return new PunchBuilderMixin(this._sessionId);
  }

  // ---- 測試輔助 (expose internal state) ----------------------------------------

  /** 取得目前 _monitorGen（測試用）。 */
  get monitorGen(): number { return this._monitorGen; }

  /** 取得 _punchService（測試用）。 */
  get punchService(): PunchService { return this._punchService; }

  /** 取得 _punchInFlight（測試用）。 */
  get punchInFlight(): boolean { return this._punchInFlight; }

  /** 取得 _lastPunchFingerprint（測試用）。 */
  get lastPunchFingerprint(): string | null { return this._lastPunchFingerprint; }

  /** 強制寫入 dbRowsSnapshot（測試用）。 */
  setDbRowsSnapshot(rows: Record<string, unknown>[] | null): void {
    this._dbRowsSnapshot = rows;
  }

  /** 直接觸發 scanOnce（測試用，繞過 timer）。 */
  async triggerScanOnce(): Promise<void> {
    await this._scanOnce();
  }

  /** 直接呼叫 applyEvents（測試用）。 */
  applyEventsForTest(events: PunchEvents): void {
    this._applyEvents(events);
  }
}
