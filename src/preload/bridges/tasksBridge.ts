import { ipcRenderer } from "electron";
import {
  TASK_CHANNELS,
  TasksFindAllPayload,
  TasksUpdatePayload,
  TasksCreatePayload,
  TaskDto,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.tasks — 任務看板
// ---------------------------------------------------------------------------

export const tasks = {
  findAll(payload?: TasksFindAllPayload): Promise<IpcResult> {
    return ipcRenderer.invoke(TASK_CHANNELS.FIND_ALL, payload ?? {});
  },
  update(payload: TasksUpdatePayload): Promise<IpcResult> {
    return ipcRenderer.invoke(TASK_CHANNELS.UPDATE, payload);
  },
  create(payload: TasksCreatePayload): Promise<IpcResult<TaskDto>> {
    return ipcRenderer.invoke(TASK_CHANNELS.CREATE, payload);
  },
};
