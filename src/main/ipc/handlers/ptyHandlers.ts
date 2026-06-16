import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  PTY_CHANNELS,
  PtySpawnSchema,
  PtyWriteSchema,
  PtyResizeSchema,
  PtyKillSchema,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerPtyHandlers({ ptyManager }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // PTY handlers（保留既有）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    PTY_CHANNELS.SPAWN,
    (event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const payload = PtySpawnSchema.parse(raw);
        ptyManager.spawn(payload.id, payload, event.sender);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    PTY_CHANNELS.WRITE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const payload = PtyWriteSchema.parse(raw);
        ptyManager.write(payload.id, payload.data);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    PTY_CHANNELS.RESIZE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const payload = PtyResizeSchema.parse(raw);
        ptyManager.resize(payload.id, payload.cols, payload.rows);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    PTY_CHANNELS.KILL,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const payload = PtyKillSchema.parse(raw);
        ptyManager.kill(payload.id);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );
}
