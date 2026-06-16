import { ipcMain } from "electron";
import {
  ADMIN_CHANNELS,
  AdminWorkspaceInfo,
  IpcResult,
} from "../../../shared/ipcContracts";
import {
  adminWorkspacePath,
  ADMIN_SESSION_TASK_IDS,
  ADMIN_SESSION_LABELS,
  toAdminScope,
} from "../../services/adminWorkspace";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerAdminHandlers(_ctx: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Admin handlers（管理工作區 / 管理 session；plan §12 U6 / Part A，rev15）
  // 回傳 ~/.teamuq 絕對路徑 + 該 scope 固定 taskId + tab 顯示名，供平台設定 / 專案管理頁
  // 各開「自己的固定管理 session」（兩頁互為不同 session）。
  // --------------------------------------------------------------------------

  ipcMain.handle(
    ADMIN_CHANNELS.GET_WORKSPACE,
    (_evt, rawScope?: unknown): IpcResult<AdminWorkspaceInfo> => {
      try {
        const scope = toAdminScope(rawScope);
        return ok<AdminWorkspaceInfo>({
          path: adminWorkspacePath(),
          taskId: ADMIN_SESSION_TASK_IDS[scope],
          label: ADMIN_SESSION_LABELS[scope],
          scope,
        });
      } catch (e) {
        return err(e);
      }
    },
  );
}
