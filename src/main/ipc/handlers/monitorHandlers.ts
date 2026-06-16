import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  MONITOR_CHANNELS,
  MonitorStartSchema,
  MonitorStopSchema,
  MonitorRebindSchema,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerMonitorHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Monitor handlers
  // --------------------------------------------------------------------------

  ipcMain.handle(
    MONITOR_CHANNELS.START,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<{ started: boolean }>> => {
      try {
        const payload = MonitorStartSchema.parse(raw);
        const started = await backend.monitor.startMonitor({
          sessionId: payload.sessionId,
          taskId: payload.taskId,
          projectPath: payload.projectPath,
          milestoneId: payload.milestoneId,
          sinceMs: payload.sinceMs,
        });
        return ok({ started });
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    MONITOR_CHANNELS.STOP,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const payload = MonitorStopSchema.parse(raw);
        backend.monitor.stopMonitor(payload.sessionId);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    MONITOR_CHANNELS.REBIND,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = MonitorRebindSchema.parse(raw);
        return ok(
          backend.conversations.rebindSession(payload.sessionId, payload.claudeSessionId),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
