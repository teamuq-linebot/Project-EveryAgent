import { ipcRenderer } from "electron";
import {
  MONITOR_CHANNELS,
  CARD_CHANNELS,
  ALERT_CHANNELS,
  MonitorStartPayload,
  MonitorRenderPayload,
  MonitorStatusPayload,
  CardRunStatePayload,
  CardWorkflowProgressPayload,
  PromptAlertPayload,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.monitor — 打卡監測開關
// ---------------------------------------------------------------------------

export const monitor = {
  start(
    payload: MonitorStartPayload,
  ): Promise<IpcResult<{ started: boolean }>> {
    return ipcRenderer.invoke(MONITOR_CHANNELS.START, payload);
  },
  stop(sessionId: string): Promise<IpcResult> {
    return ipcRenderer.invoke(MONITOR_CHANNELS.STOP, { sessionId });
  },
  rebind(
    sessionId: string,
    claudeSessionId: string | null,
  ): Promise<
    IpcResult<{
      ok: boolean;
      claudeSessionId: string | null;
      launchCommand: string | null;
    }>
  > {
    return ipcRenderer.invoke(MONITOR_CHANNELS.REBIND, {
      sessionId,
      claudeSessionId,
    });
  },
};

export function onMonitorRender(
  cb: (payload: MonitorRenderPayload) => void,
): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: MonitorRenderPayload,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(MONITOR_CHANNELS.RENDER, handler);
  return () => {
    ipcRenderer.removeListener(MONITOR_CHANNELS.RENDER, handler);
  };
}

export function onMonitorStatus(
  cb: (payload: MonitorStatusPayload) => void,
): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: MonitorStatusPayload,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(MONITOR_CHANNELS.STATUS, handler);
  return () => {
    ipcRenderer.removeListener(MONITOR_CHANNELS.STATUS, handler);
  };
}

export function onCardRunState(
  cb: (payload: CardRunStatePayload) => void,
): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: CardRunStatePayload,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(CARD_CHANNELS.RUN_STATE, handler);
  return () => {
    ipcRenderer.removeListener(CARD_CHANNELS.RUN_STATE, handler);
  };
}

export function onCardWorkflowProgress(
  cb: (payload: CardWorkflowProgressPayload) => void,
): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: CardWorkflowProgressPayload,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(CARD_CHANNELS.WORKFLOW_PROGRESS, handler);
  return () => {
    ipcRenderer.removeListener(CARD_CHANNELS.WORKFLOW_PROGRESS, handler);
  };
}

export function onPromptAlert(
  cb: (payload: PromptAlertPayload) => void,
): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: PromptAlertPayload,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(ALERT_CHANNELS.PROMPT_ALERT, handler);
  return () => {
    ipcRenderer.removeListener(ALERT_CHANNELS.PROMPT_ALERT, handler);
  };
}
