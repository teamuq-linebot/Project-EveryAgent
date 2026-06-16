import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  INIT_PROGRESS_CHANNELS,
  InitProgressState,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";
import { initProgressService } from "../../services/initProgressService";

// init-progress-pipeline：splash 掛載時 invoke GET 補拉目前完整快照。
// 進度狀態走模組單例 initProgressService，不經 ctx.backend；簽名仍比照其他 handler 收 HandlerContext。
export function registerInitProgressHandlers(_ctx: HandlerContext): void {
  ipcMain.handle(
    INIT_PROGRESS_CHANNELS.GET,
    (_event: IpcMainInvokeEvent): IpcResult<InitProgressState> => {
      try {
        return ok<InitProgressState>(initProgressService.getState());
      } catch (e) {
        return err(e);
      }
    },
  );
}
