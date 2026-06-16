import { ipcRenderer } from "electron";
import {
  DIALOG_CHANNELS,
  CLIPBOARD_CHANNELS,
  ADMIN_CHANNELS,
  AdminWorkspaceInfo,
  AdminScope,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.dialog — 原生對話框
// ---------------------------------------------------------------------------

export const dialogBridge = {
  openDirectory(): Promise<IpcResult<string | null>> {
    return ipcRenderer.invoke(DIALOG_CHANNELS.OPEN_DIRECTORY);
  },
};

// ---------------------------------------------------------------------------
// tuq.clipboard — 剪貼簿（renderer sandbox 禁 navigator.clipboard，必須走 IPC）
// ---------------------------------------------------------------------------

export const clipboardBridge = {
  writeText(text: string): Promise<IpcResult> {
    return ipcRenderer.invoke(CLIPBOARD_CHANNELS.WRITE_TEXT, { text });
  },
  readText(): Promise<IpcResult<{ text: string }>> {
    return ipcRenderer.invoke(CLIPBOARD_CHANNELS.READ_TEXT);
  },
};

// ---------------------------------------------------------------------------
// tuq.admin — 管理工作區 / 管理 session（plan §12 U6）
// ---------------------------------------------------------------------------

export const admin = {
  /**
   * 取得 ~/.teamuq 絕對路徑 + 該 scope 固定管理 session taskId + tab 顯示名。
   * scope='platform'（平台設定）/ 'project'（專案管理）→ 兩頁各開自己的固定 session。
   */
  getWorkspace(scope: AdminScope): Promise<IpcResult<AdminWorkspaceInfo>> {
    return ipcRenderer.invoke(ADMIN_CHANNELS.GET_WORKSPACE, scope);
  },
};
