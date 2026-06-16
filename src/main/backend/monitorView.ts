/**
 * backend/monitorView.ts — MainProcessMonitorView：IMonitorView → IPC 推送。
 *
 * 自 backend.ts 機械抽離（行為保留 move-only）。
 *
 * IMonitorView 實作：把 MonitorController 的 View 回呼轉成 IPC event 推給 renderer。
 * 對應 Python app_qt.py App._poll_indicators + view.render_* / show_status 的 IPC 版本。
 *
 * emit 為可注入 callback（測試時注入 mock；真機時注入 webContents.send.bind(wc)）。
 */

import type { IMonitorView } from "../monitor/types";
import type { PunchRow } from "../monitor/types";
import type {
  MonitorRenderPayload,
  MonitorStatusPayload,
  CardRunStatePayload,
  CardWorkflowProgressPayload,
  WorkflowRunSummary,
} from "../../shared/ipcContracts";
import { MONITOR_CHANNELS, CARD_CHANNELS } from "../../shared/ipcContracts";
import type { EmitFn } from "./types";

export class MainProcessMonitorView implements IMonitorView {
  constructor(
    private readonly _sessionId: string,
    private readonly _taskId: string,
    private _emit: EmitFn,
  ) {}

  /** 更新 emit（視窗建立後由 backend 注入真實 webContents.send）。*/
  setEmit(emit: EmitFn): void {
    this._emit = emit;
  }

  showStatus(text: string): void {
    const payload: MonitorStatusPayload = { sessionId: this._sessionId, text };
    this._emit(MONITOR_CHANNELS.STATUS, payload);
  }

  renderPunchTable(rows: PunchRow[], canPunch: boolean): void {
    const payload: MonitorRenderPayload = {
      sessionId: this._sessionId,
      rows,
      canPunch,
    };
    this._emit(MONITOR_CHANNELS.RENDER, payload);
  }

  setRunState(state: "none" | "idle" | "running" | "waiting" | "error" | "completed"): void {
    const payload: CardRunStatePayload = { taskId: this._taskId, state };
    this._emit(CARD_CHANNELS.RUN_STATE, payload);
  }

  setWorkflowProgress(workflows: WorkflowRunSummary[]): void {
    const payload: CardWorkflowProgressPayload = {
      taskId: this._taskId,
      sessionId: this._sessionId,
      workflows,
    };
    this._emit(CARD_CHANNELS.WORKFLOW_PROGRESS, payload);
  }

  renderNoSession(hint: string, skipped: string[]): void {
    // 轉 monitor:status（renderer 依 sessionId 路由）
    this._emit(MONITOR_CHANNELS.STATUS, {
      sessionId: this._sessionId,
      text: `${hint} (skipped: ${skipped.join(", ")})`,
    });
  }

  renderUnsupported(text: string): void {
    this._emit(MONITOR_CHANNELS.STATUS, { sessionId: this._sessionId, text });
  }
}
