/**
 * types.ts — MonitorController 注入介面定義
 *
 * 對應 Python:
 *   - teamuq/app/monitor_view.py  (MonitorView 契約 + PunchRow / BindItem)
 *   - 注入式 I/O 介面：IWorktimeSource / IAppSyncClient / IPunchLedger
 *
 * 本刀重點是「編排邏輯」對，I/O 介面形狀務實設計，之後真實作對接。
 */

import type { WorkflowRunSummary } from '../../shared/ipcContracts';

// ---------------------------------------------------------------------------
// PunchRow（對應 Python monitor_view.PunchRow dataclass）
// ---------------------------------------------------------------------------

export interface PunchRow {
  name: string;
  started_at: unknown;       // 原始 ISO string（View 做 fmt_clock）
  ended_at: unknown;         // 原始 ISO string（show_end=false 時忽略）
  hours: number;
  status: string;
  show_end: boolean;
  type: string;
  /** 來源 CLI（'claude' | 'codex'）；DB 列帶入，monitor 推播路徑（in-memory）不含。 */
  cli?: string | null;
  description: string;
  subtask_id: string;
  error: string;
}

/** 建一個完整 PunchRow，帶預設值。 */
export function makePunchRow(fields: Pick<PunchRow, 'name' | 'started_at' | 'ended_at' | 'hours' | 'status'> & Partial<PunchRow>): PunchRow {
  return {
    show_end: true,
    type: '',
    description: '',
    subtask_id: '',
    error: '',
    ...fields,
  };
}

// ---------------------------------------------------------------------------
// BindItem（對應 Python monitor_view.BindItem dataclass）
// ---------------------------------------------------------------------------

export interface BindItem {
  label: string;
  session_id: string;
  busy: boolean;
  tooltip: string | null;
}

// ---------------------------------------------------------------------------
// IMonitorView — Presenter→UI callback 介面
// 對應 Python MonitorView Protocol（render_*/show_status/is_alive）。
// Electron 中「回呼」對應 IPC event 推 renderer，或在測試中接受 mock。
// ---------------------------------------------------------------------------

export interface IMonitorView {
  /** 更新監測狀態小字。對應 view.show_status() */
  showStatus(text: string): void;
  /** 重畫打卡表格（指紋節流後才呼叫）。對應 view.render_punch_table(rows, can_punch) */
  renderPunchTable(rows: PunchRow[], canPunch: boolean): void;
  /** 設定卡片運行狀態（none / idle / running / waiting / completed）。對應 view.set_run_state → App._poll_indicators */
  setRunState(state: 'none' | 'idle' | 'running' | 'waiting' | 'completed'): void;
  /** 推 workflow 進度給 renderer（card:workflowProgress）。可選：舊 view / 測試 mock 可不實作。 */
  setWorkflowProgress?(workflows: WorkflowRunSummary[]): void;
  /** 無可監測 session 畫面。對應 view.render_no_session() */
  renderNoSession(hint: string, skipped: string[]): void;
  /** 工具不支援監測時的畫面。對應 view.render_unsupported() */
  renderUnsupported(text: string): void;
}

// ---------------------------------------------------------------------------
// IWorktimeSource — worktime 資料來源注入介面
// 對應 Python _AggregateWorker 呼叫的 worktime.aggregate.collect_punch_events
// ---------------------------------------------------------------------------

export interface PunchEvents {
  subagent_events?: Record<string, unknown>[];
  main?: Record<string, unknown>;
  main_events?: Record<string, unknown>[];
  punch_db_rows?: Record<string, unknown>[] | null;
  [key: string]: unknown;
}

export interface IWorktimeSource {
  /** 收集打卡事件（對應 Python collect_punch_events）。
   *  projectPath: 專案路徑
   *  sinceMs: 基準時間戳（epoch ms）
   *  sessionIds: 被監測的 session id 集合
   *  tool: CLI 工具（'claude' | 'codex'；省略 → 'claude'）。決定掃哪個來源的 JSONL。
   */
  collectPunchEvents(
    projectPath: string,
    sinceMs: number,
    sessionIds: Set<string>,
    tool?: string
  ): Promise<PunchEvents>;
}

// ---------------------------------------------------------------------------
// IAppSyncClient — GraphQL 後端注入介面
// 對應 Python appsync.client.AppSyncClient + monitor_workers 打卡動作
// ---------------------------------------------------------------------------

export interface CreateSubtaskResult {
  id?: string | null;
  [key: string]: unknown;
}

export interface IAppSyncClient {
  /** 建立子任務（對應 _do_start / _do_oneshot）。*/
  createSubtask(opts: {
    taskId: unknown;
    assigneeId: unknown;
    name: string;
    description: string;
    startTime: unknown;
    endTime?: unknown;
    duration?: number;
    categoryName?: string;
    sessionId?: unknown;
    inputPrompt?: string;
  }): Promise<CreateSubtaskResult>;

  /** 更新子任務（對應 _do_end）。*/
  updateSubtask(opts: {
    subtaskId: string;
    endTime: unknown;
    duration: number;
    description?: string;
    /** 後端 newUpdateSubtask 需 taskId + assigneeId（補 resourceId）。 */
    taskId?: unknown;
    assigneeId?: unknown;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// IPunchLedger — 打卡帳本注入介面
// 對應 Python persistence.punch_ledger.PunchLedger
// ---------------------------------------------------------------------------

export interface LedgerRow {
  punch_uid: string;
  subtask_id?: string | null;
  [key: string]: unknown;
}

export interface IPunchLedger {
  /** 打卡開始（start phase）*/
  punchIn(opts: {
    punch_uid: string;
    session_id: string;
    task_id: unknown;
    name: string;
    type?: string;
    started_at?: unknown;
    cli?: string | null;
  }): void;

  /** 打卡結束（end phase）*/
  punchOut(opts: {
    punch_uid: string;
    subtask_id?: string | null;
    ended_at?: unknown;
    hours?: number;
    ok?: number;
    error?: string;
  }): void;

  /** oneshot 打卡（一次寫齊）*/
  recordOneshot(opts: {
    punch_uid: string;
    session_id: string;
    task_id: unknown;
    name: string;
    type?: string;
    started_at?: unknown;
    ended_at?: unknown;
    hours?: number;
    subtask_id?: string | null;
    ok?: number;
    error?: string;
    cli?: string | null;
  }): void;

  /** 預載「已 done」key 集合（跨重啟去重）*/
  preloadDoneKeys(sessionId: string): Set<string>;

  /** 列出「open」打卡（待 punch-out）*/
  listOpen(sessionId: string): LedgerRow[];

  /** 列出該 task 的全部打卡（含已完成 / 錯誤；監測表即時顯示用，與重開任務同一資料源）*/
  listPunchesForTask(taskId: unknown): Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// MonitorControllerOptions — startMonitor 注入參數
// ---------------------------------------------------------------------------

export interface MonitorControllerOptions {
  projectPath: string;
  taskId: unknown;
  assigneeId: unknown;
  sessionId: string;
  /** 監測基準時間（epoch ms），預設取 Date.now() */
  sinceMs?: number;
  /** 要掃描的真實 claude session uuid 集合（collectPunchEvents 過濾用）。
   *  省略 → 退回 [sessionId]（舊行為；合成 id 通常掃不到真 session）。
   *  codex：傳空陣列（定檔靠 cwd，不依 id 過濾）。 */
  monitoredSessionIds?: string[];
  /** CLI 工具（'claude' | 'codex'；省略 → 'claude'）。決定掃哪個來源。 */
  tool?: string;
}
