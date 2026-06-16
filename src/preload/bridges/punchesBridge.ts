import { ipcRenderer } from "electron";
import { PUNCH_CHANNELS, IpcResult } from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.punches — 打卡紀錄
// ---------------------------------------------------------------------------

export const punches = {
  listForTask(taskId: string): Promise<IpcResult> {
    return ipcRenderer.invoke(PUNCH_CHANNELS.LIST_FOR_TASK, { taskId });
  },
};
