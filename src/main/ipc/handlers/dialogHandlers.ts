import { ipcMain, IpcMainInvokeEvent, dialog, BrowserWindow } from "electron";
import { DIALOG_CHANNELS, IpcResult } from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerDialogHandlers(_ctx: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Dialog handlers（原生資料夾選擇）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    DIALOG_CHANNELS.OPEN_DIRECTORY,
    async (event: IpcMainInvokeEvent): Promise<IpcResult<string | null>> => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(
          win ?? BrowserWindow.getFocusedWindow() ?? new BrowserWindow(),
          {
            properties: ["openDirectory"],
          },
        );
        if (result.canceled || result.filePaths.length === 0) {
          return ok(null);
        }
        return ok(result.filePaths[0]);
      } catch (e) {
        return err(e);
      }
    },
  );
}
