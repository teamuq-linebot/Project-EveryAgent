import { ipcMain, IpcMainInvokeEvent, clipboard } from "electron";
import {
  CLIPBOARD_CHANNELS,
  ClipboardWriteTextSchema,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerClipboardHandlers(_ctx: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Clipboard handlers（renderer sandbox → IPC → electron clipboard）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    CLIPBOARD_CHANNELS.WRITE_TEXT,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const payload = ClipboardWriteTextSchema.parse(raw);
        clipboard.writeText(payload.text);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    CLIPBOARD_CHANNELS.READ_TEXT,
    (_event: IpcMainInvokeEvent): IpcResult<{ text: string }> => {
      try {
        const text = clipboard.readText();
        return ok({ text });
      } catch (e) {
        return err(e);
      }
    },
  );
}
