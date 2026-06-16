import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  PUNCH_CHANNELS,
  PunchesListForTaskSchema,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerPunchHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Punch handlers
  // --------------------------------------------------------------------------

  ipcMain.handle(
    PUNCH_CHANNELS.LIST_FOR_TASK,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = PunchesListForTaskSchema.parse(raw);
        const rows = backend.monitor.listPunchesForTask(payload.taskId);
        return ok(rows);
      } catch (e) {
        return err(e);
      }
    },
  );
}
