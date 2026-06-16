import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  TASK_CHANNELS,
  TasksFindAllSchema,
  TasksUpdateSchema,
  TasksCreateSchema,
  TasksFindAllResult,
  TaskDto,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerTaskHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Task handlers
  // --------------------------------------------------------------------------

  ipcMain.handle(
    TASK_CHANNELS.FIND_ALL,
    // Phase 5（router+useTasks）：回本地讀的結構化任務列（TaskService → TaskDto[]，
    // 即 renderer 端「LocalTask」投影）。型別由 unknown 窄化為 TasksFindAllResult，
    // 與 useTasks 的 IpcResult<TasksFindAllResult> 邊界對齊（§2.6 / §9 Phase 5）。
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<TasksFindAllResult>> => {
      try {
        const payload = TasksFindAllSchema.parse(raw ?? {});
        const tasks = await backend.projects.findAllTasks(payload ?? {});
        return ok<TasksFindAllResult>(tasks);
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    TASK_CHANNELS.UPDATE,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<unknown>> => {
      try {
        const payload = TasksUpdateSchema.parse(raw);
        const result = await backend.projects.updateTask(
          payload.taskId,
          payload.status,
          {
            version: payload.version ?? undefined,
          },
        );
        return ok(result);
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    TASK_CHANNELS.CREATE,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<TaskDto>> => {
      try {
        const payload = TasksCreateSchema.parse(raw);
        const dto = await backend.projects.createTask(payload);
        return ok<TaskDto>(dto);
      } catch (e) {
        return err(e);
      }
    },
  );
}
