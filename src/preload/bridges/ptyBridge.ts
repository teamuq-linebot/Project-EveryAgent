import { ipcRenderer } from "electron";
import {
  PTY_CHANNELS,
  PtySpawnPayload,
  PtyDataPayload,
  PtyExitPayload,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.pty — renderer → main (invoke)
// ---------------------------------------------------------------------------

export const pty = {
  spawn(payload: PtySpawnPayload): Promise<IpcResult> {
    return ipcRenderer.invoke(PTY_CHANNELS.SPAWN, payload);
  },
  write(id: string, data: string): Promise<IpcResult> {
    return ipcRenderer.invoke(PTY_CHANNELS.WRITE, { id, data });
  },
  resize(id: string, cols: number, rows: number): Promise<IpcResult> {
    return ipcRenderer.invoke(PTY_CHANNELS.RESIZE, { id, cols, rows });
  },
  kill(id: string): Promise<IpcResult> {
    return ipcRenderer.invoke(PTY_CHANNELS.KILL, { id });
  },
};

export function onPtyData(cb: (payload: PtyDataPayload) => void): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: PtyDataPayload,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(PTY_CHANNELS.DATA, handler);
  return () => {
    ipcRenderer.removeListener(PTY_CHANNELS.DATA, handler);
  };
}

/**
 * 訂閱 main → renderer 的 pty:exit 事件（PTY 子行程結束，含正常結束）。
 * CliBackendSection 用此偵測「一鍵安裝 / 登入指令跑完（尾端 `; exit` 使 shell 結束）」
 * → 自動收合內嵌終端機面板並重新偵測。回傳 cleanup 取消訂閱。
 */
export function onPtyExit(cb: (payload: PtyExitPayload) => void): () => void {
  const handler = (
    _event: Electron.IpcRendererEvent,
    payload: PtyExitPayload,
  ): void => {
    cb(payload);
  };
  ipcRenderer.on(PTY_CHANNELS.EXIT, handler);
  return () => {
    ipcRenderer.removeListener(PTY_CHANNELS.EXIT, handler);
  };
}
